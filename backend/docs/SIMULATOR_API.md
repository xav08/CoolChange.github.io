# Screened tree-canopy simulator data

The backend reads the model repository's schema 3 export. It does not train a
model or calculate a new tree-count scenario at request time. Existing API
fields and the global OLS model remain available for existing consumers.

## Import a release

From `backend/`, install the existing dependencies and configure `DATABASE_URL`
for the intended database. Run migrations and the normal seed first:

```bash
npm ci
npm run migrate
npm run seed
npm run simulator:import -- /path/to/simulator_scenarios.json --dry-run
npm run simulator:import -- /path/to/simulator_scenarios.json
```

Quote paths containing spaces. Generate the input in the separate model
repository using its documented pipeline. The full export is an external build
artifact; do not copy the approximately 69 MB JSON into this repository or send
it to the browser. The three-block fixture under `tests/fixtures/` is for tests
only and will fail a full database coverage check.

`--dry-run` validates the file without opening a database connection. A real
import also requires exactly the same block codes, baseline UHI, baseline canopy
and area as `mesh_block`, comparing at its PostgreSQL REAL precision. The source
hashes in `inputs` are retained as provenance identifiers; this importer does not
have the original training files and cannot independently verify those hashes.

Migration `005_create_simulator.sql` adds `simulator_release`, `simulator_block`
and `simulator_active`. Number 005 avoids the geometry/street migrations on other
team branches. The importer inserts batches inside one transaction, verifies
coverage and switches the active pointer only after success. Failed imports roll
back; identical files are reusable. `release_id` is the SHA-256 of the complete
export file, including metadata and payloads. Previous releases are retained.

Run migration 005 before starting this backend version. With no active release,
the new field is `null`. Database failures are errors, not a simulated zero
cooling result. A missing block in an active release returns HTTP 503 with
`SIMULATOR_UNAVAILABLE`.

The existing full seed reload now clears simulator releases in the same
transaction. Re-import after a seed reload. If baseline data are updated through
another maintenance path, deactivate the simulator and import a matching export
before using it again. Existing legacy bootstrap values are cached by the
service, so restart after a baseline/config seed change.

## Read contract

`GET /api/v1/bootstrap` adds a top-level `simulator` object:

| Field | Meaning |
| --- | --- |
| `release_id` | Complete export SHA-256; compare with the block response |
| `schema_version` | `3` |
| `inputs` | Original points, mesh-block and planting-assumptions SHA-256 identifiers |
| `policy` | `cooling-screen-v2` thresholds and interpretation |
| `reason_messages` | All reason codes and display explanations |
| `planting_assumptions` | Reference profiles, mature crown areas, maturity caveats and source links |
| `notice` | Display interpretation |

Metadata are read afresh on every bootstrap request, including when the old
bootstrap fields come from cache. No `blocks` array is returned here.

`GET /api/v1/meshblocks/:mb_code16` adds a top-level `simulator` object alongside
`block`, `flags`, `comparisons`, `coolest_in_lga` and `projections`:

| Field | Type / meaning |
| --- | --- |
| `release_id`, `schema_version`, `inputs` | Same release identifiers as bootstrap |
| `mb_code16` | 11-digit string matching `block.mb_code16` |
| `observed_uhi`, `observed_canopy_pct` | Original unrounded model baseline |
| `status` | `indicative` or `unavailable` at block level |
| `reason_codes` | All applicable explanations |
| `tree_planting.area_m2` | Positive block area in square metres |
| `tree_planting.simulation_slope` | Screened negative coefficient, or `null` |
| `tree_planting.local_canopy_min_pct`, `local_canopy_max_pct` | Local model support |
| `tree_planting.default_limits_by_profile.A/B/C` | `max_trees_with_estimate` (integer or `null`) and `canopy_domain_max_trees` (integer) |
| `tree_planting.site_capacity_trees` | `null`: actual planting capacity has not been assessed |
| `tree_planting.site_capacity_status` | `not_assessed` |
| `scenarios` | Ordered baseline, +5, +10 and +15 canopy percentage-point scenarios |

Each scenario includes `requested_delta_pp`, `applied_delta_pp`, `canopy_pct`,
`status`, `reason_codes`, `predicted_uhi` and `cooling_c`. Status is `baseline`,
`no_change`, `indicative` or `unavailable`. For unavailable scenarios both
temperature-related numbers are `null`. A zero-addition baseline has zero cooling
even on an unavailable block. Never convert unavailable results to zero.

## Frontend integration rules

1. Load bootstrap and the selected block. If either `simulator` is `null`, show
   that simulator data are not loaded and disable estimates. If their
   `release_id` values differ, refresh both before evaluating a scenario. Do not
   mix assumptions from one release with coefficients from another.
2. Use the original simulator baseline for calculation; the existing `block`
   fields are rounded for display. Preserve calculation precision until rendering.
3. For integer tree counts, port the model's `tree_planting.py` rules and compare
   against its `tree_planting_examples.json`. This endpoint supplies parameters
   and percentage-point examples; it does not enumerate every tree count.
4. With default net contribution 1, compute added canopy area as tree count times
   the selected profile's mature canopy area (A 12.6, B 50.3, C 113.1 m²), then
   divide by block area and multiply by 100 for added canopy percentage points.
   Recalculate limits if the profile or net contribution changes.
5. Reject a whole-tree request exceeding the 100% canopy bound or a separately
   supplied site capacity. Do not clip it into a fractional tree. A screened
   block or a request outside local canopy support yields no numerical estimate;
   do not substitute the global OLS slope or interpolate across null scenarios.
6. For an eligible request, `cooling_c = -simulation_slope * delta_canopy_pp` and
   `predicted_uhi = observed_uhi - cooling_c`. Zero trees show the observed baseline.

For Casey block `20631942810`, 10 profile-B trees at net contribution 1 add
503 m² / 0.6359039190897597 canopy percentage points. Reference cooling is
0.10237547530974396 °C and predicted UHI is 15.575724524690257. The default B model
limit is 542 trees; 543 is outside the local model range. Physical capacity is
still unknown. Block `20046872000` is screened out, with null simulation slope
and null positive-addition cooling values.

Label results **At maturity**. UHI here is a historical land-surface temperature
deviation, not today's absolute air temperature or a guaranteed future
temperature. Model limits are not physical planting capacity, indicative
associations are not causal cooling guarantees, and no calibrated confidence
interval is supplied. Projection `days_lower` / `days_upper` are counts of hot
days and must not be combined arithmetically with `cooling_c`.

## Validation and remaining integration

Run `npm test -- --runInBand`. Tests cover legacy API compatibility, real export
fixtures, null handling, limits, release refresh, baseline matching and mocked
transaction rollback/idempotency. Before deployment, apply the migration and
import on a local/staging PostgreSQL database, then check bootstrap and both
example block endpoints. The Jest database mocks do not execute PostgreSQL SQL.
Frontend wiring and deployment are separate remaining steps.

Local Docker validation was completed on 2026-09-13; see
[the validation report](LOCAL_DATABASE_VALIDATION.md) for the checked release,
results, remaining scope and reproduction commands. To recheck an imported
release against its full source export using real SQL and HTTP:

```bash
npm run simulator:verify -- /absolute/path/to/simulator_scenarios.json
```

This read-only verifier defaults to the local Docker database on port 5433,
regardless of a different database URL in `.env`, and closes its temporary HTTP
server after verification. An explicitly exported `DATABASE_URL` must target
`localhost:5433/coolchange` or `127.0.0.1:5433/coolchange`.
