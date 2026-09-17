# Evidence for Crown Area, Tree-Count Limits and Maturity Timing

English version of [the Chinese report](PLANTING_ASSUMPTIONS.md). Report date: 2026-09-12.

Implemented in the model experiment repository with configuration version `planting-v1` and export schema v3. The main website has not yet integrated these outputs.

## Sources and how they are used

The Victorian Department of Transport and Planning's [Mid-Rise Code Guidelines, March 2026 edition](https://www.planning.vic.gov.au/__data/assets/pdf_file/0037/767836/Mid-Rise-Code-Guidelines.pdf), printed page 23, Table E2-6.2 (PDF page 22), provides these minimum mature dimensions and deep-soil reference values:

| Reference type | Crown diameter, m | Crown area, m² | Deep-soil area, m² | Minimum soil plan dimension, m |
|---|---:|---:|---:|---:|
| A | 4 | 12.6 | 12 | 2.5 |
| B | 8 | 50.3 | 49 | 4.5 |
| C | 12 | 113.1 | 121 | 6.5 |

The document concerns residential design under Clause 57. This project adopts only three reference sizes for simulation, not residential requirements as street-planting rules or species-average dimensions. Default B is the project's middle-size choice, not a learned parameter. Printed page 26 requires overlapping canopy to be counted once. Without tree positions or crown polygons, the default scenario explicitly assumes survival, no overlap between added and existing or other added crowns, and all credited canopy within the selected block.

The [City of Casey Summary Tree Guide](https://www.casey.vic.gov.au/policies-strategies/city-of-casey-summary-tree-guide) requires species to suit site conditions. It describes spacing of 6–20 m depending on tree size and clearances from driveways, footpaths and services. Total mesh-block area and grass percentage therefore cannot establish planting capacity: tree positions, land access, soil geometry and infrastructure constraints are missing. Deep-soil reference values are retained in the configuration, but the simulator does not invent capacity by dividing grass area by those values.

The [City of Cockburn street-tree list](https://www.cockburn.wa.gov.au/Environment-and-Waste/Street-Trees-and-Verges/Request-a-Street-Tree) describes approximate mature dimensions at 20–30 years. This Western Australian example does not calibrate growth in Melbourne or for the A/B/C profiles. The primary result label is **At maturity**. The 20–30-year range is supplementary context from another region, not a promise that the reference canopy will be reached by 2050 or a basis for annual growth interpolation.

## Implemented calculation

```text
block_area_m2 = area_sqkm × 1,000,000
new_canopy_area_m2 = integer_tree_count × reference_crown_area_per_tree × net_canopy_fraction
delta_canopy_pp = new_canopy_area_m2 / block_area_m2 × 100
predicted_uhi = observed_uhi + simulation_slope × delta_canopy_pp
cooling_c = observed_uhi - predicted_uhi
```

`net_canopy_fraction` defaults to 1. An explicit value greater than zero and at most one can describe assumptions about net contribution, such as overlap and survival; it is not an adjustment estimated from the data. Changing it also changes the model-supported count limit. A smaller fraction must not be used to claim that a physical site can accommodate more trees.

The fixed 80% ceiling has been removed. The 100% bound is mathematical only; estimates must still pass local screening and observed-range checks.

```text
model_supported_max_trees = floor((local_canopy_max - observed_canopy_pct)
                                 / 100 × block_area_m2 / net_crown_area_per_tree)
```

`max_trees_with_estimate` is provided only if the block passes screening and current canopy lies inside the local range; otherwise it is null. Zero trees can still display the observed baseline. `canopy_domain_max_trees` describes only the count permitted by the canopy range and cannot bypass screening. The model limit is not physical planting capacity, nor does it imply that the maximum-count estimate is the most trustworthy.

`site_capacity_trees` defaults to null and `site_capacity_status` to `not_assessed`. A separately assessed nonnegative integer capacity and its source may be supplied to impose a smaller limit. Such values are labelled `provided_not_verified`. Requests above supplied capacity or the 100% mathematical bound return unavailable in full rather than clipping a tree to a fractional crown. Requests outside local observed canopy support return the canopy scenario but null cooling estimates.

`predicted_uhi` is a surface heat-island deviation scenario anchored to historical observations, not absolute air temperature. The mature-canopy result remains an extrapolation of an observational association without causal calibration or validated confidence intervals.

## Deliverables and usage

- `config/planting_assumptions.json`: parameters, scope, source URLs and review date.
- `coolchange/tree_planting.py`: shared calculation and whole-tree constraints.
- `data/simulator_scenarios.json`: per-block `tree_planting` parameters, including area in square metres, an eligible slope, local canopy range and default A/B/C model limits. The top level includes the full assumptions and configuration hash.
- `coolchange/simulate_trees.py`: calculates directly from offline exports without online fitting. Changed input-data or configuration hashes require a new export.
- `data/tree_planting_examples.json`: real-block examples of supported, out-of-range and unavailable results.

Windows PowerShell commands for the environment used in this project:

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m coolchange.simulate_trees --block 20631942810 --trees 10 --profile B
# Optional separate capacity and source; these values demonstrate the interface only.
.\.venv\Scripts\python.exe -X utf8 -B -m coolchange.simulate_trees --block 20631942810 --trees 5 --site-capacity 5 --site-capacity-source "Example assessment only"
.\.venv\Scripts\python.exe -X utf8 -B -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -X utf8 -B -m coolchange.audit_data
```

On a new computer, create a virtual environment as described in the [README](../README.md) and use that environment's interpreter. Restore the model artifacts first. Historical backups are only required when explicitly requesting `--history-dir`; the default current-data audit does not need them.

For website integration, users select a reference crown size and an integer count. Label the slider as the model-supported range and separately show that actual planting capacity has not been assessed. Supported results show additional mature canopy, canopy-cover change, indicative surface cooling and the maturity label. Unavailable results clear the previous numbers and display reasons. Recalculate limits whenever reference size or net contribution changes; exported default limits are not valid for changed assumptions. The API should return the selected block's result rather than send the full export on page load.

Real-data example: Casey (C) block `20631942810` has area 79,100 m², observed canopy cover 1.563% and observed UHI 15.6781°C. Ten type B reference trees at the default net contribution add 503 m², increase canopy cover to approximately 2.199%, and produce indicative surface cooling of approximately 0.1024°C, with scenario UHI approximately 15.5757°C. The model-supported limit is 542 trees, **not an assessment that the site can accommodate 542 trees**; site capacity remains null. This is a calculation for one block and must not be generalized as a fixed 0.1°C cooling effect per ten trees.

## Data still missing

Actual planting locations and usable space, infrastructure clearances, available soil geometry, existing-crown overlap, species and ages, and local growth and survival curves have not been obtained. The evidence establishes reference assumptions and which limits can be calculated; it does not complete a street-level capacity assessment. These gaps remain explicitly unknown in the outputs.

Pre-change outputs are stored in `data/backups/before_planting_assumptions/`. All 41 unit tests passed. The full audit checks zero trees, the maximum supported integer count and one above it for all three profiles across 54,239 blocks; unavailable blocks are checked at zero and one tree. It also rechecks 216,956 percentage scenarios. Passing tests establishes rule compliance only. Actual capacity remains unknown for every block. GWR fit R² is 0.8014 and Casey holdout R² is 0.2469; adding evidence for assumptions did not improve model accuracy.
