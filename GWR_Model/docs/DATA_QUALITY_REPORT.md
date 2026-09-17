# CoolChange Coordinate Repair and Data Quality Report

English version of [the Chinese report](DATA_QUALITY_REPORT.md). Report date: 2026-09-12.

Coordinates have been rebuilt for all 54,239 mesh blocks. GWR was retrained with the original `k=400`, and all model comparison experiments were rerun. The source tables for temperature, canopy, population, SEIFA and future projections were not modified.

Subsequent update: [cooling display screening](COOLING_RELIABILITY.md) has been implemented. The model statistics below describe the raw associations; delivered scenario values now contain either a number or null according to the display rules. The 4,238 positive slopes remain in the research data, while their planting-related cooling estimates are suppressed. No formal confidence intervals or forced OLS replacement have been introduced.

## Data issues repaired

The previous implementation rounded boundary coordinates to four decimal places, then applied the shoelace formula directly to relatively large longitude and latitude values. This caused substantial numerical cancellation for small polygons and could degenerate narrow boundaries. For multipart geometry, it selected one component by vertex count instead of calculating the centroid of the complete block, and it ignored holes.

The current implementation downloads the official complete GeoJSON, calculates an area-weighted centroid for the full Polygon/MultiPolygon in the EPSG:3111 metre-based projection, includes holes, and transforms the result to EPSG:4326. Source pages and SHA-256 hashes are recorded for review.

| Check | Result |
|---|---:|
| Old coordinates clearly outside the Melbourne bounds | 9, repaired |
| Other old coordinates displaced by more than 10 m | 1,302 |
| Other old coordinates displaced by more than 100 m | 368 |
| Other old coordinates displaced by more than 1 km | 25 |
| Maximum displacement among the other old coordinates | 7,131.99 m |
| Median displacement among the other old coordinates | 2.07 m |
| Missing, out-of-bounds or duplicate rows in the new coordinates | 0 for each check |
| Mesh-block IDs and coverage | 54,239 unique IDs, matching the training table exactly |

The displacement thresholds overlap and must not be added together. The nine clearly out-of-bounds old points are excluded from the distance distribution. The old table contained 14 rows with duplicated coordinate pairs; the new table contains none. Displacement reflects the combined effects of precision, projection and full-geometry handling, so it cannot all be attributed to a single defect.

One official boundary, mesh block `20479371000`, contained a minor self-intersection. Repair with `shapely.make_valid` changed its area by a relative 4.41e-8 and moved its centroid by approximately 0.000022 m. This repair is explicitly logged. The code accepts repairs only when the relative area change is at most 1e-6 and centroid movement is at most 0.01 m; otherwise it stops.

The local `uhi_mean` and `canopy_pct` fields were checked against the official values for every matching block. Both maximum differences were 0.00005, consistent with the original CSV's four-decimal precision. No differences beyond that rounding range were found.

## Retraining results

| GWR metric | Before repair | After repair |
|---|---:|---:|
| Full-data fit R² | 0.8016 | 0.8014 |
| Full-data fit RMSE, °C | 0.9035 | 0.9039 |
| Random 80/20 test R² | 0.7892 | 0.7897 |
| Random test RMSE, °C | 0.9416 | 0.9405 |
| Casey spatial holdout R² | 0.2524 | 0.2469 |
| Casey spatial holdout RMSE, °C | 1.9175 | 1.9246 |
| Blocks with positive slopes in the full-data model | 4,252 | 4,238 |

Fit metrics are not independent test metrics. Correcting coordinates does not guarantee an increase in R². Overall GWR performance changed little, and performance on the Casey holdout remains comparatively weak. The original measurements, model specification, neighbour count and random seed were unchanged. A positive slope cannot be interpreted directly as evidence that planting causes warming; this model describes spatial associations in observational data.

Precomputed canopy increments are 0, 5, 10 and 15 percentage points. All scenarios were checked row by row against the formula, with maximum floating-point error below 4e-15. Zero-increment scenarios preserve the original value. Model and comparison outputs record input-file hashes.

## Data issues requiring further attention

| Issue | Observed condition | Impact and next step |
|---|---|---|
| Missing SEIFA | 1,477 blocks lack both `irsd_score` and `irsd_decile`, including 34 Residential blocks | The current GWR does not use these fields, so all blocks are retained. Equity analysis should show missing coverage rather than fill it with zero. Check the ABS source table and SA1 join. |
| Missing future projections | Each warming level, 1.2, 1.5, 2.0 and 3.0, lacks 3,106 blocks; the current projection table has 204,532 rows | The future-projection spatial join has not been rerun. Source coverage and join implementation remain possible explanations. Display no data and investigate separately. |
| Positive local slopes | 4,238 blocks, approximately 7.81% | Their cooling numbers are now suppressed with reasons. Raw slopes are unchanged; the OLS fallback from the comparison experiment is not used in public estimates. See the cooling report. |
| Uncertainty | No block-specific confidence or prediction intervals | Global R² or global slope quantiles cannot serve as a block's error range. |
| Planting parameters | A/B/C mature-canopy references and sources have been added; the fixed 80% ceiling was removed; integer simulation limits follow local canopy support | Actual site capacity, overlap and local growth curves remain unknown. See the [planting assumptions report](PLANTING_ASSUMPTIONS.md). |

Missing SEIFA occurs mainly in categories including Industrial (670) and Parkland (414), but this does not establish that every missing value is expected. The affected blocks contain a total of 13,870 residents in the current population table. This is an aggregate area population, not individual records.

The following values should not automatically be classified as bad data:

- The projection table has 45,606 rows with an empty `days_upper`. All have the label `15+`, representing an open upper bound that must be preserved.
- A total of 9,164 blocks have zero residents. The dataset includes parks, industrial land and transport areas; zero population alone is not a reason to remove them.
- The maximum difference between summed vegetation components and total vegetation is approximately 0.0001 percentage points, consistent with separately rounding the fields to four decimals.
- A negative UHI means a surface temperature below the rural baseline; it must not be clipped to zero.

All percentage fields are within 0–100, all areas are positive, and no numeric infinities were found. These checks establish numerical and join consistency, not the complete validity of historical measurements or future projection assumptions.

## Reproduction and files

See the [README](../README.md) for commands. The nine coordinate/join regression tests and the full model-output audit passed. The original `.venv` no longer had a usable base Python installation, so this run used a separate `.venv-repair` without deleting the old environment. Subsequent screening and planting work brings the total test count to 41.

- [Model results](../data/gwr_model.json)
- [Model comparisons](../data/model_comparison.json)
- [Complete audit statistics](../data/data_quality_report.json)
- [Per-block issue flags](../data/data_quality_flags.csv)
- [Per-block coordinate changes](../data/coordinate_changes.csv)
- [Source provenance and geometry repair records](../data/coordinate_provenance.json)

The original coordinates, GWR coefficients, diagnostics and comparison outputs are backed up in `data/backups/before_coordinate_repair/`. Raw geometry pages are in `data/coordinate_source/`. Both directories and virtual environments are excluded from Git. The current-data audit runs without these historical backups after restoring the model artifacts. To include historical comparison, pass `--history-dir data/backups/before_coordinate_repair`. Current audit results go to `data/audit_runs/latest/`; the reports linked above are recorded historical results.

These centroids are used only for GWR distance calculations. A concave or multipart polygon's centroid may lie outside its boundary, so it cannot directly replace an interior representative point for address lookup or future-projection joins.

## Sources

- [Victorian official Urban Heat 2018 layer](https://plan-gis.mapshare.vic.gov.au/arcgis/rest/services/CoolingGreening/CoolingGreening/MapServer/55): original geometry for coordinate rebuilding and source-field verification.
- [Esri Map Service Query documentation](https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/): GeoJSON queries and pagination.
- [Shapely centroid documentation](https://shapely.readthedocs.io/en/stable/reference/shapely.centroid.html): area-weighted centroids for multipolygons.
