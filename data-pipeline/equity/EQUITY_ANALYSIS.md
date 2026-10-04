# Equity Analysis — heat and canopy vs socio-economic disadvantage

**Cool Change · Iteration 3 · Epic 7 · Stories 7.1.1 and 7.1.2**
Owner: Yu (data). Content for the About page: Yipu. Chart: Sheng. Section design: Linda.
Data-exposure review and dual verification: Priyanshu.

Everything here is reproduced by one command:

```bash
python3 data-pipeline/08_build_equity_sa2.py
```

---

## 1. The question

Our problem statement says heat hits disadvantaged communities harder. Epic 7
tests that claim instead of asserting it, and reports the answer as measured,
including where it is weaker than the story we would like to tell.

## 2. What was done (7.1.1)

| Step | Detail |
|---|---|
| Unit of analysis | **SA2 (suburb), ASGS 2016.** 303 SA2s cover our 54,239 mesh blocks. |
| Heat and canopy per SA2 | **Population-weighted mean** of block values (weights = 2016 Census usual residents). The question is "who lives with the heat", so people count, not land area. |
| SEIFA | ABS SEIFA 2016, **SA2** Table 1, IRSD (Index of Relative Socio-economic Disadvantage). The ABS's own SA2 score, joined on the SA2 code. We do **not** average SA1 scores ourselves. |
| Decile | The ABS **national** decile of SA2s. 1 = most disadvantaged 10% of SA2s in Australia. |
| Inclusion | SA2 must have a published IRSD and ≥ 500 residents in our blocks → **295 SA2s, 4.34 million people** in the statistics. |
| Coverage | All 303 SA2s are written to `equity_sa2.csv`; the 8 excluded are flagged with `exclusion_reason`, not dropped. |

**Excluded SA2s (8):** Moorabbin Airport, Essendon Airport, West Melbourne,
Port Melbourne Industrial (no IRSD published by the ABS); Flemington
Racecourse, Braeside, Melbourne Airport, Mount Dandenong - Olinda (fewer than
500 residents in our blocks).

### No re-identification path

- Every output row is an SA2 (median ≈ 14,000 residents). No `mb_code16`,
  `sa1_code16` or any block-level value is written. A gate in the script
  fails the run if one appears.
- SEIFA is joined at SA2 level from the ABS SA2 table, never via blocks.
- The block-level correlation in §5 is computed in memory for comparison
  and only a single coefficient leaves the script.

## 3. Result (7.1.2) — reported as computed

n = 295 SA2s. x = IRSD score (higher = less disadvantaged). 95% intervals are
percentile bootstrap, 10,000 resamples.

| | Pearson r | 95% CI | r² | Spearman ρ | Slope per +100 IRSD |
|---|---|---|---|---|---|
| Heat (°C above baseline) | **−0.36** | −0.44 to −0.29 | 0.13 | −0.46 | −0.94 °C |
| Canopy (%) | **+0.46** | +0.40 to +0.52 | 0.21 | +0.59 | +5.3 pp |

### By SEIFA decile (population-weighted)

| Decile | SA2s | Residents | Heat (°C) | Canopy (%) |
|---|---|---|---|---|
| 1 (most disadvantaged) | 17 | 289,607 | **9.75** | **6.6** |
| 2 | 17 | 260,888 | 9.11 | 9.3 |
| 3 | 19 | 304,239 | 9.40 | 8.7 |
| 4 | 15 | 242,344 | 9.03 | 8.3 |
| 5 | 26 | 383,280 | 9.65 | 9.6 |
| 6 | 28 | 423,069 | 8.53 | 11.4 |
| 7 | 38 | 563,876 | 8.75 | 12.0 |
| 8 | 47 | 662,897 | 8.93 | 13.1 |
| 9 | 53 | 756,576 | 8.18 | 14.9 |
| 10 (least disadvantaged) | 35 | 457,888 | **7.33** | **20.3** |

Decile 1 vs decile 10: **2.4 °C hotter, about one third of the tree canopy.**

## 4. How to read it

1. **The relationship is real but moderate.** The heat interval sits well
   clear of zero, so it is not chance. But r² = 0.13: disadvantage accounts
   for roughly an eighth of the variation in suburb heat. Most of it is
   geography: the basalt plains in the west, distance from the bay, industrial
   land, and the age of an estate.
2. **The gap is large even though r is moderate.** r measures how tightly
   suburbs sit on a line, not how big the difference is. 2.4 °C is 1.4
   standard deviations of suburb heat (SD = 1.71 °C), and about 20 times the
   modelled effect of planting 10 trees on a single block in the Tree Simulator.
3. **It is not a smooth staircase.** Heat is roughly flat across deciles
   1–5 (9.0–9.75 °C) and falls mainly in deciles 9–10. Canopy rises more
   steadily. The accurate sentence is "the least disadvantaged suburbs are
   markedly cooler and greener", not "every step of disadvantage adds heat".
4. **Canopy shows the clearer gradient.** It is stronger than heat on every
   measure, and it is the lever the product is about.
5. **Areas, not people.** This is an area-level association (ecological). It
   does not say any individual disadvantaged person lives somewhere hotter,
   and it is not causal.

## 5. Sensitivity checks (reported alongside, never instead of, §3)

| Variant | n | Heat r | Canopy r |
|---|---|---|---|
| **Primary** (population-weighted, ≥ 500 residents) | 295 | −0.36 | +0.46 |
| Unweighted block mean | 295 | −0.38 | +0.46 |
| Residential blocks only | 293 | −0.36 | +0.46 |
| Only SA2s ≥ 80% inside our study area | 279 | −0.35 | +0.48 |
| Including small SA2s (any residents) | 299 | −0.36 | +0.44 |
| **Within SA4 region** (geography held constant) | 295 in 9 regions | **−0.17** | **+0.32** |
| Block-level reference (SA1 SEIFA, not an output) | 52,762 blocks | −0.25 | +0.28 |

What these say:

- **Robust to method choices.** Weighting, scope and fringe coverage barely
  move the result.
- **Geography carries much of the heat link.** Comparing suburbs only within
  their own region halves the heat correlation (−0.36 → −0.17). The canopy
  link survives better (+0.46 → +0.32). Disadvantaged suburbs are hotter
  partly *because of where they are*; inside a region, they are still
  noticeably less green.
- **Aggregation strengthens r.** The same relationship on individual blocks is
  −0.25 / +0.28. This is the usual ecological-correlation effect: averaging
  removes block-to-block noise. It is why the SA2 figure must not be
  described as a statement about individuals. It also supersedes the
  Iteration 1 block-level figure ("2.04 °C", r = +0.28): **use the SA2
  numbers above on the About page, not both.**

Within metro Melbourne quintiles (equal-sized groups, *not* ABS deciles):
9.39 → 9.05 → 8.75 → 8.58 → 7.72 °C, and canopy 8.0 → 10.5 → 12.4 → 13.8 →
18.1 %. Smoother, because each group holds ~59 SA2s.

## 6. Sanity check (7.1.2 DoD #2)

| Most disadvantaged | IRSD | Heat | Canopy | | Least disadvantaged | IRSD | Heat | Canopy |
|---|---|---|---|---|---|---|---|---|
| Broadmeadows | 782 | 9.26 | 8.6 | | Glen Iris - East | 1125 | 7.48 | 19.0 |
| Campbellfield - Coolaroo | 798 | 9.37 | 6.2 | | Ivanhoe East - Eaglemont | 1121 | 7.21 | 24.6 |
| Meadow Heights | 821 | 9.57 | 6.3 | | East Melbourne | 1120 | 7.78 | 16.8 |
| Doveton | 826 | 8.34 | 8.5 | | Beaumaris | 1117 | 6.93 | 19.8 |
| St Albans - South | 832 | 10.85 | 5.2 | | Research - North Warrandyte | 1117 | 4.97 | 38.5 |

Both ends match what anyone who knows Melbourne would expect.

**Exceptions explain the moderate r.** Advantaged but in the hottest quarter:
Beaconsfield - Officer (decile 9, 11.8 °C, 7.4% canopy), Point Cook - South
(decile 9, 11.2 °C, 3.0%), Gowanbrae (decile 9, 10.9 °C, 5.6%). These are
new estates where trees have not grown yet. Estate age and location matter
alongside income. No decile 1–2 SA2 falls in the coolest quarter.

## 7. Limitations

- **Spatial autocorrelation.** Neighbouring SA2s resemble each other, so the
  bootstrap intervals treat them as more independent than they are and are
  likely somewhat too narrow. The direction and rough size are not in doubt;
  the second decimal is.
- **Fringe SA2s are partly outside the study area.** 16 included SA2s have
  < 80% of their ABS population inside our blocks (e.g. Belgrave - Selby
  45%, Koo Wee Rup 40%). Their values describe the covered part only.
  Excluding them changes nothing material (§5).
- **National deciles are uneven in Melbourne.** Melbourne skews advantaged, so
  decile groups hold 15 to 53 SA2s. The chart must show n per decile.
- Inherited from D1: mid-morning surface temperature from 2018, as a
  deviation from a non-urban baseline. See `DATA_LIMITATIONS.md`.
- 2016 Census population and 2016 SEIFA, to match D1's 2016 mesh blocks.

## 8. Hand-off

### For Yipu — plain-language finding (draft, edit freely)

> **Does heat fall harder on disadvantaged suburbs?** We tested it rather than
> assumed it. Across 295 Melbourne suburbs, the most disadvantaged tenth are on
> average **2.4 °C hotter** than the least disadvantaged tenth, with about
> **a third of the tree canopy** (6.6% vs 20.3%).
>
> The link is real but moderate. Disadvantage explains only part of why a
> suburb is hot. Location matters more: the western plains and new outer
> estates run hot whatever their income. The clearest difference is in tree
> cover, which is exactly what planting can change.
>
> This compares areas, not individual households, and shows an association,
> not a cause.

Method note (one line): *Mesh-block heat and canopy averaged to suburb (SA2)
level, weighted by residents, and compared with the ABS SEIFA 2016 Index of
Relative Socio-economic Disadvantage. 295 suburbs with ≥ 500 residents.
Pearson r = −0.36 (heat), +0.46 (canopy).*

Citation: Australian Bureau of Statistics (2018), *Census of Population and
Housing: Socio-Economic Indexes for Areas (SEIFA), Australia, 2016*, cat.
2033.0.55.001, Statistical Area Level 2 Indexes, Table 1. CC BY 4.0.
Accessed 4 October 2026.

### For Sheng — chart

Data: `frontend/src/data/equitySeifa.json` (28 KB, import directly, no API
call needed).

```jsonc
{
  "meta":     { ... method strings for the caption ... },
  "headline": { "heat_pearson_r": -0.363, "uhi_gap_c": 2.42, "canopy_ratio_10_to_1": 3.07, ... },
  "byDecile": [ { "decile": 1, "nSa2": 17, "persons": 289607, "uhi": 9.75, "canopy": 6.61 }, ... ],
  "sa2":      [ { "name": "Broadmeadows", "irsd": 782, "decile": 1, "persons": 13263, "uhi": 9.26, "canopy": 8.56 }, ... ]
}
```

Suggested design (Linda to finalise):

1. **Two small charts side by side, same x-axis (decile 1–10).** Never one
   chart with two y-axes.
   - Heat: **dot chart.** The y-axis cannot start at 0 meaningfully, and bars
     on a truncated axis exaggerate the gap.
   - Canopy: bars from 0 are fine.
2. Hover/tap shows `nSa2` and `persons` for each decile, since groups are uneven.
3. The title states the finding, e.g. "The least disadvantaged suburbs are
   2.4 °C cooler with three times the tree cover".
4. A caption under the charts says it is area level, an association, and not
   causal.
5. Optional: a scatter of the 295 `sa2` points (IRSD vs heat) with suburb name
   on hover. It shows "a trend, with many exceptions" more honestly than any
   sentence.

### For Priyanshu — data-exposure review

The new outputs are SA2-only (see §2). Two **existing** items predate
Iteration 3 and sit outside this script; flagging them for a team decision:

1. `backend/src/db/migrations/002_create_schema.sql` defines a materialized view
   `equity_by_decile` that groups **mesh blocks** by SA1 decile. Epic 7 now
   uses the SA2 analysis, so this view is superseded. Nothing in the API reads
   it today; it can be dropped in a later migration.
2. `mesh_block.irsd_score` / `irsd_decile` (SA1 values on each block) are
   returned by the block detail endpoint and written to the front-end bundle
   by `04_build_frontend_bundle.py`. They are SA1 aggregates (~400 people)
   published openly by the ABS, so not a re-identification path in the
   strict sense, but they are the "mesh-block level" SEIFA the Iteration 3
   plan says to avoid. Decide whether to keep them in the detail panel.

## 9. Verification checklist (DoD: developer + tester)

| Check | How | Expected |
|---|---|---|
| Script runs clean | `python3 data-pipeline/08_build_equity_sa2.py` | `all gates passed` |
| Coverage (7.1.1 DoD 4) | rows in `equity_sa2.csv` | 303 (all metro SA2s), 295 with `included_in_analysis = True` |
| No block-level data (7.1.1 DoD 3) | header of `equity_sa2.csv` and keys in `equitySeifa.json` | no `mb_code16`, `sa1_code16` or block fields |
| Join at area level (7.1.1 DoD 2) | read `build()` | SEIFA merged onto the SA2 table from the ABS SA2 file |
| Numbers reproducible (7.1.2) | independent recompute in a notebook from `equity_sa2.csv` | Pearson r −0.363 / +0.458 on the 295 included rows |
| Sanity check (7.1.2 DoD 2) | §6 | known disadvantaged/advantaged suburbs sit at the expected ends |
| No selective reporting (7.1.2 DoD 4) | §3 and §5 | the primary result plus every sensitivity run is published; the script has no gate on result value or sign |

Developer: Yu ☐ · Tester: Priyanshu ☐
