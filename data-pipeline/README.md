# Cool Change — data pipeline

Turns five public datasets into the CSVs the database loads. Owned by Yu
(D1–D4); D5 and street search added by Savio.

## Why this exists

The API is a **read layer**. It never aggregates, never fits a model and never
joins at request time. Everything expensive happens here, offline, and the
result is a static table the database serves.

## Raw data

Raw files are **not committed** — about 140 MB (D1–D4) plus another ~190 MB
for D5. They live outside the repo:

```
~/Documents/FIT5120/Iteration 1/data/raw/
```

Override with `COOLCHANGE_RAW=/path/to/raw`. To fetch them from the original
sources:

```bash
python3 data-pipeline/download_data.py --geometry
```

| Code | Dataset | Licence |
|---|---|---|
| D1 | Metropolitan Melbourne Urban Heat Islands and Urban Vegetation 2018 (DTP Victoria) — heat AND vegetation on the same mesh blocks | CC BY 4.0 |
| D2 | ACS Temperature extremes, days per year ≥ 35 °C, by global warming level | CC BY 4.0 |
| D3 | ABS 2016 Census Mesh Block Counts (cat. 2074.0) | CC BY 4.0 |
| D4 | ABS SEIFA 2016, SA1 indexes (cat. 2033.0.55.001) | CC BY 4.0 |
| D5 | VicMap Address (DataVic) — statewide address points, used for street-level search | CC BY 4.0 |

D5 is the slow one: ~4.2M rows statewide, no server-side filter to our study
area (see Traps below for why), roughly 20–40 minutes over ~2,000 sequential
requests. Fetches each address's real coordinate as well as its attributes
(needed to correctly place it against our 2016 boundaries — see Traps). It
checkpoints to a `.partial` file as it goes and resumes on re-run rather than
restarting — expect it to fail partway through at least once on a full run,
that's normal for a fetch this size, not a sign something's broken.

## Running it

```bash
pip3 install pandas numpy shapely xlrd requests psycopg2-binary
python3 data-pipeline/01_block_count_check.py         # why n = 54,239, not 55,603
python3 data-pipeline/02_build_mesh_block.py          # D1 + D3 + D4  -> 3 CSVs
python3 data-pipeline/03_build_projections.py         # D2 spatial join -> 1 CSV
python3 data-pipeline/07_reconcile_mesh_block.py      # D5 -> corrected 2016 mesh_block
python3 data-pipeline/05_build_street_mesh_block.py   # reconciled D5, collapsed -> 2 CSVs
```

`07_` needs `DATABASE_URL` set (same variable used below) and a GIST index on
`mesh_block_geometry` — it checks for one and refuses to run without it
rather than silently taking hours. `05_` reads `07_`'s output, not raw D5
directly — see Traps for why that matters.

Then load into the database:

```bash
cd backend && npm run db:up && npm run migrate
cd src/db/seeds && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f load_seeds.sql
```

## Outputs

| File | Rows | What |
|---|---|---|
| `mesh_block.csv` | 54,239 | the core table |
| `mesh_block_projection.csv` | 204,532 | per-block heat bands, 4 warming levels |
| `area_baseline.csv` | 744 | precomputed comparisons, ALL and RESIDENTIAL |
| `model_coefficient.csv` | 1 | the fitted canopy/heat relationship |
| `street.csv` | 65,015 | distinct streets, restricted to our study area |
| `street_mesh_block.csv` | 178,762 | which block(s) each street touches, with an address count per block |

## Validation

`02_build_mesh_block.py` refuses to write anything unless every gate passes:

- 54,239 rows, `mb_code16` unique, no nulls in heat or canopy
- exactly 1,477 blocks without SEIFA — **0 would mean nulls were silently filled**
- 4,345,097 persons and 1,779,634 dwellings
- Pearson r within 0.02 of the published −0.585
- OLS slope within 0.01 of the published −0.1274

`05_build_street_mesh_block.py` also refuses to write anything unless every
gate passes:

- 2,708,962 rows survive filtering the reconciled D5 down to our 54,239
  study-area blocks
- 52,071 distinct blocks covered (the other 2,168 are a documented,
  investigated gap, not a load failure — see Traps below)
- both output tables unique on their natural keys, `n_addresses` strictly
  positive, every value fits its target column width

`load_seeds.sql` re-asserts the same facts inside the load transaction, so a
bad load aborts instead of half-applying.

## Traps we already hit

- **D3 is latin-1**, not utf-8, and its last five rows are ABS footer text that
  parse as rows with a null code. Left in, they look like duplicate keys.
- **D3's footer also says small Dwelling and Person counts are randomly
  adjusted** by the ABS for confidentiality. Block-level population is
  approximate by design. This belongs in the limitations panel.
- **D4 uses `-` for suppressed values.** Read naively they become the string
  `"-"` and silently pass a not-null check.
- **Do not use D1's `Shape_Area`.** It arrives in square degrees because the
  extract requests `outSR=4326`. Use D3's `AREA_ALBERS_SQKM`.
- **Do not use the standalone "Vegetation Cover 2018" product.** Its geometry is
  mesh blocks subdivided by road casement polygons, so `MB_CODE16` is not
  unique and a naive join fans out rows. The vegetation fields are already
  inside the heat file.
- **Parsing the 34 MB polygon file is the slow step**, so `03_` caches a
  representative point per block in `.cache/` (gitignored).
- **D5's `mesh_block` field is sometimes serialised as a bare JSON number**,
  not a quoted string, despite VicMap declaring it a string field. Read
  naively it becomes `float64` and formats like `20328760000.0`, which would
  silently break every join to `mb_code16`. `pull_d5()` normalises it to a
  zero-padded string at fetch time.
- **Do not filter D5 server-side with a `mesh_block IN (...)` clause** to our
  54,239 blocks. A chunked version of this was tried first — it made
  ArcGIS's query planner slow enough that the full fetch projected to ~9
  hours. An unfiltered `where=1=1` scan is faster despite pulling ~4.2M rows
  instead of ~2.7M; filtering happens after `07_`'s reconciliation instead.
  The same URL-length limit shows up again with any OBJECTID `IN (...)`
  batch over ~a few hundred ids (ArcGIS Online's edge/CDN rejects the
  encoded GET with a bare 404) — `07_` and `06_vintage_match_check.py` both
  send these as POST, not GET, to avoid it.
- **Deep `resultOffset` pagination fails outright (HTTP 400) on D5 past
  roughly 1.1M rows** — a real ArcGIS limitation at this table size, not
  network flakiness, reproduced on two separate runs. `pull_d5()` pages by an
  OBJECTID cursor instead (`WHERE OBJECTID > last_seen`), which has no
  offset for the backend to choke on.
- **ArcGIS can return HTTP 200 with an error payload instead of a features
  list**, indistinguishable from "no more data" to a loop that only checks
  for an empty response. `pull_d5()` checks for an `"error"` key in every
  response and verifies the final row count against an authoritative total
  from `returnCountOnly` before accepting the file.
- **`road_type` is legitimately empty for some streets** (e.g. "Broadway",
  "The Boulevard" — the type is baked into the name or genuinely absent).
  Normalised to `''` rather than left NULL in `05_`, so the `UNIQUE`
  constraint on `street` actually catches duplicate streets on a reseed —
  Postgres treats every NULL as distinct from every other NULL.
- **`COPY`'s CSV format treats an empty field as NULL by default**, which
  silently undoes the `''`-not-NULL normalisation above at load time.
  `street`'s `\copy` in `load_seeds.sql` needs `FORCE_NOT_NULL (road_type)`,
  or the load fails against the `NOT NULL` constraint even though the CSV is
  correct.
- **VicMap's own `mesh_block` attribute tracks the CURRENT ASGS boundary
  edition, not 2016** — every table in this schema is frozen to 2016, and
  both editions use the same 11-digit code format, so a vintage mismatch
  never errors, it just silently produces a wrong join. Measured via a
  ~2,500-address sample (`06_vintage_match_check.py`) at 4.0% wrong
  statewide, up to 56.7% wrong in fast-growing corridors (Tarneit). Fixed by
  `07_reconcile_mesh_block.py`: a real point-in-polygon spatial join against
  our own 2016 `mesh_block_geometry`, replacing the attribute entirely —
  `05_` now reads the reconciled value, not VicMap's own claim. Do not
  re-introduce a direct read of raw D5's `mesh_block` column anywhere
  downstream of this fix.
- **Bulk-loading coordinates into Postgres via `psycopg2`'s
  `executemany()` is not actually batched** — it sends one INSERT per row,
  which was the real cost of `07_`'s spatial join (200,000 individual
  round-trips per chunk), not the join itself. Confirmed via `EXPLAIN
  ANALYZE` that the join was already using `mesh_block_geometry`'s GIST
  index correctly and running in sub-millisecond time per lookup before
  chasing this. Fixed with `COPY` (`cur.copy_expert()`) instead, same tool
  `load_seeds.sql` already uses for bulk loading.
- **Temp tables are never touched by autovacuum**, so a freshly-loaded
  staging table has zero row-count statistics until `ANALYZE` is run on it
  explicitly — without this the planner can badly misjudge a join's
  strategy. `07_` runs `ANALYZE` on its staging table after every chunk
  load, before the spatial join query.
- **2,168 of our 54,239 study-area blocks still have zero streets after the
  spatial-join fix** (down from 8,373 before it — the fix recovered 6,205
  blocks the old attribute method wrongly excluded). Investigated, not
  assumed: 1,868 are genuinely unbuilt (`persons = 0`, confirmed by query).
  ~299 cluster in Melbourne's rural/semi-rural fringe (Yarra Valley,
  Healesville, Flinders, and similar) and average 2.2 sq km vs the statewide
  0.066 sq km — consistent with a road running near/along a large rural
  parcel's boundary, placing an address's exact coordinate just inside the
  geometrically adjacent block from the one the census counted its
  residents under. One remaining case (a dense South Yarra block, tiny area
  but 709 persons — a single high-rise) has a plausible but explicitly
  unconfirmed explanation and was not investigated further. AC 1.3.3's "no
  results" handling covers a search landing on any of these blocks
  correctly either way. Belongs in the E8 limitations panel alongside the
  SEIFA/dwelling-randomisation notes above.

## Documents

The written documents — the block-count investigation, the data processing
plan, the API contract, the E8 data limitations — are **not in this repository**.
They are kept with the team's shared documentation and go to the unit staff from
there. Ask Yu for the current copies (D1–D4) or Savio (D5 / street search).

What *is* in the repo:

| Path | What |
|---|---|
| `../backend/src/db/migrations/002_create_schema.sql` | the schema, heavily commented |
| `../backend/src/db/migrations/004_create_street_mesh_block.sql` | the street/street_mesh_block schema |
| `../backend/src/db/queries.sql` | verified SQL behind each endpoint |
| `../api/` | the read-only API over that schema |