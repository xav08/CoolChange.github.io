# GWR conditional uncertainty intervals

This optional postprocessing step adds nominal pointwise 95% intervals to an
existing schema-3 simulator export. It preserves all existing point estimates,
statuses, limits and source data. No new observations are required. It refits the
same estimator with its existing 400-neighbour adaptive bisquare kernel to recover
coefficient covariance; it does not select a new model or bandwidth.

## Reproduce

Run from `GWR_Model/` with Python 3.11+ (recommended 3.12). First restore the matching base artifacts using [the artifact guide](ARTIFACTS.md), or generate a new base model as described in the [README](../README.md).

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m coolchange.gwr_uncertainty --output-dir data/uncertainty_new
python -m coolchange.simulate_trees --export data/uncertainty_new/simulator_scenarios.json --block 20631942810 --trees 10 --profile B
```

The output directory must not already exist; choose another new name if `uncertainty_new` exists. To inspect the restored release without regenerating it, use `--export data/uncertainty_v1/simulator_scenarios.json` with `simulate_trees`. The source export defaults to
`data/simulator_scenarios.json`; use `--source-export` only for a corresponding
original export. Inputs, model specification, IDs and refitted coefficients are
checked before producing the new release. CSV newline-only changes from Git are
accepted only when canonicalizing line endings reproduces the exact stored hash;
actual file hashes and the normalization used are recorded. Changed data fail.

Files in the new directory:

- `simulator_scenarios.json`: separate deployable release; original file unchanged.
- `gwr_coefficient_uncertainty.csv`: raw local slope, standard error, bounds and
  intercept standard error for research, including screened-out blocks. These raw
  coefficients must not bypass the simulator's display screening.
- `validation_report.json`: fit diagnostics, input provenance, software versions,
  interval counts, spatial-residual diagnostic and export SHA-256.
- `tree_planting_example.json`: reference response for a 10-tree Casey scenario.

## Calculation

For local design X and spatial kernel W, define `B = (X' W X)^(-1) X' W`.
The implementation uses an SVD pseudoinverse after checking full rank.
With independent errors of common variance sigma², coefficient covariance is
`sigma² B B'`. The spatial weights are smoothing weights, not inverse error
variances; using `sigma² (X' W X)^(-1)` alone would be incorrect here.

Build each smoother row as `S[i,:] = [1, canopy_i] B_i`. Sum its diagonal and
squared entries without allocating a full n-by-n smoother matrix. Estimate
`sigma² = RSS / (n - 2 trace(S) + trace(S' S))`. This corresponds to the residual
variance option `sigma2_v1=False` in the
[official mgwr implementation](https://mgwr.readthedocs.io/en/latest/_modules/mgwr/gwr.html).
This project computes its own existing kernel; it does not claim to have run mgwr.

A slope interval is `beta ± 1.9599639845400534 * SE(beta)`.
For fixed positive canopy addition d (percentage points), cooling is `-beta*d`,
so its interval is `[-beta_upper*d, -beta_lower*d]` in °C. Do not add observation
noise: this is a conditional mean contrast, not a future-temperature prediction.
The observed baseline is held fixed. Standard errors and endpoints are retained
at full precision, and negative lower bounds are not clipped.

## Interpretation and limitations

Label the result “Approximate 95% model-based interval (coverage not validated)”.
The nominal level is conditional on an iid, common-variance error approximation,
fixed bandwidth/design and negligible local smoothing bias. It is pointwise,
not a simultaneous statement over 54,239 blocks or a post-selection guarantee.
Both `coverage_validated` and `policy.validated_uncertainty_interval` remain false.

The real-data 8-neighbour residual Moran I diagnostic found spatial dependence
(see the generated report). Consequently these iid bands can be too narrow.
The permutation diagnostic is not a coverage calibration. Spatially robust or
spatial-block resampling intervals with held-out calibration are a separate next
methodological step if validated coverage is needed. No claim of actual 95%
coverage is justified by the formula or by the arithmetic tests.

The intervals also exclude uncertainty from canopy/temperature measurement,
bandwidth and display screening selection, tree growth/survival, overlap, site
capacity and the causal effect of planting. Unavailable blocks/scenarios remain
unavailable; baseline/no-change intervals are null. A zero-crossing interval
indicates the sign is unresolved within this approximate model. A positive band
is still an association, not proof of planting benefits.

## Backend and frontend handoff

Use the matching backend uncertainty extension before importing this new JSON.
The importer performs full baseline and coverage checks and atomically activates
the new release; JSONB storage means no new migration is necessary. Do not run
seed merely to update this release. Keep the old export for rollback/re-import.
The backend returns method metadata in bootstrap and block responses, coefficient
uncertainty in `tree_planting`, and scenario `cooling_interval` objects. The frontend
must use matching release IDs and the same tree-count screening rules, then
propagate the coefficient bounds using the formula above.
