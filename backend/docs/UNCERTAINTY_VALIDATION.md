# Optional GWR uncertainty validation — 2026-09-15

A separate schema-3 export now includes conditional, nominal pointwise 95%
coefficient and cooling intervals. All original baselines, estimates, statuses,
reasons and planting limits are unchanged. The original export remains supported.

## Identified artifacts

- Original release: `e18c8f7acd632a98b6aa4024bbed7fa6920361c7f906bc4ab53eef1959c4ad32`.
- Extended release: `5905ff7a173680ca545f4a1e18fd179eb497636d4c4bba54d120b547bfde8df6`.
- Model project: `coolchange-ml-lab/FIT5120_CoolChange_Mode`.
- New export: `data/uncertainty_v1/simulator_scenarios.json` (98,846,829 bytes).
- Transfer copy: `data/uncertainty_v1/simulator_scenarios.json.gz` (10,053,265 bytes).
  Decompress before running the JSON importer. `SHA256SUMS` accompanies both files.
- Model method and provenance: `docs/UNCERTAINTY.md` and `docs/UNCERTAINTY_VALIDATION.json`.

The large export is not copied into this backend repository. Its model-project
output directory is ignored by Git; code, tests and diagnostic documentation can
be reviewed and committed separately.

## Evidence

1. Refit all 54,239 blocks at the existing bandwidth of 400. Maximum absolute
   difference from the saved intercept/slope values: `2.6645352591003757e-14`.
2. Removed only the new fields from the extended export and compared every value
   with the original export: exact equality, including all 216,956 scenarios.
3. Python: 50 tests passed. New tests independently construct dense weighted
   regression covariance and the smoother matrix, compare the equal-weight case
   with statsmodels OLS, and check simulated coefficient dispersion and nominal
   coverage under known iid noise. Tests also cover invalid designs, source
   hash/newline checks, signed bounds and whole-tree screening. This is numerical
   validation under specified assumptions, not real-data coverage calibration.
4. Backend: 72 tests across 7 suites passed. Tests cover original schema-3
   compatibility, optional method metadata, nulls and zero-crossing bounds via
   HTTP, and rejection of incorrect arithmetic or overstated coverage claims.
5. Created an isolated local PostgreSQL database `coolchange_uncertainty_test`
   from a read-only copy of the existing baseline tables on Docker port 5433.
   Imported and verified the original release, then imported and verified the
   extended release. Both passed full SQL/export equality for 54,239 blocks and
   216,956 scenarios; real HTTP health/PostGIS, bootstrap, full list and four
   representative block responses; open-ended projections, fallback behaviour,
   missing SEIFA and unknown-block HTTP 404.
6. Current `coolchange` database was not switched. No AWS deployment, remote
   database update, commit or push was performed for this extension.

## Statistical result and limits

There are 37,222 indicative and 17,017 unavailable blocks. There are 109,897
non-null positive-addition scenario intervals; baseline and unavailable intervals
are null. No displayed interval in this screened export crosses zero. Synthetic
zero-crossing fixtures verify that negative lower bounds are retained. Display
screening already selects strong negative associations, so positive intervals do
not establish calibrated coverage or causality.

Residual variance is `0.8323003290117048`, using
`RSS / (n - 2 trace(S) + trace(S' S))`, with residual degrees of freedom
`53243.32400281455`. The global 8-neighbour, row-standardized residual Moran I is
`0.4167041023041687`; the two-sided permutation diagnostic gives `p=0.005`
(199 permutations, seed 42). This indicates residual spatial dependence and
conflicts with the iid approximation used by these standard errors. Intervals
may be too narrow; the diagnostic does not calibrate or repair them.

Both `coverage_validated` and `policy.validated_uncertainty_interval` remain false.
Use the display label and limitations in [the API contract](SIMULATOR_API.md#optional-uncertainty-v1-extension).
Do not call these validated 95% prediction intervals or planting-outcome guarantees.

Casey block `20631942810`, 10 B-profile trees at the assumed mature size and net
fraction 1: cooling `0.10237547530974396` °C, interval
`[0.08726916376756363, 0.11748178685192436]` °C. This is a conditional association
under the stated canopy scenario; site feasibility and growth are not estimated.

## Adoption

Deploy the updated backend, then import the new JSON into the intended database
and verify its release ID and example responses. No new migration or seed reload
is required for this optional JSONB extension when existing simulator tables and
matching baselines are already present. The frontend must add interval display
and apply the documented coefficient-bound transformation for custom tree counts.
