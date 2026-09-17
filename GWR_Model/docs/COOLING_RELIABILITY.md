# Cooling Estimate Display Screening

English version of [the Chinese report](COOLING_RELIABILITY.md). Report date: 2026-09-12. Policy version: `cooling-screen-v2`.

Screening has been implemented in the model experiment repository, and all 54,239 blocks have been re-exported. The main application API and interface have not yet integrated these outputs.

## Results

| Check | Blocks |
|---|---:|
| Pass block-level screening; specific scenarios still require checking | 37,222 |
| Fail block-level screening | 17,017 |
| Nonnegative raw local slope | 4,238 |
| Local R² below 0.10 | 16,034 |
| Slopes do not remain negative across all 200/400/800 neighbourhoods | 6,056 |

Reasons overlap and must not be added together. Safeguards for low effective neighbour counts, limited canopy variation and invalid fits are implemented; none introduced additional block exclusions in this run. Median local R² was approximately 0.0196 for positive-slope blocks and 0.2070 for negative-slope blocks. These are descriptive statistics, not causal evidence about planting.

| Canopy-cover increase | Indicative estimates available | Unavailable |
|---|---:|---:|
| 0 percentage points | 54,239 observed baselines | 0 |
| 5 percentage points | 37,011 | 17,228 |
| 10 percentage points | 36,751 | 17,488 |
| 15 percentage points | 36,135 | 18,104 |

Even a block that passes screening may not support a larger canopy scenario because it exceeds the observed local range. No blocks were deleted, measurements altered, positive slopes made negative, or local coefficients replaced with a citywide average. Full-data GWR fit R² remains 0.8014, random-test R² is 0.7897, and Casey holdout R² is 0.2469. Screening changes display eligibility rather than improving model prediction accuracy.

## Provisional rules and rationale

The following thresholds are reviewable engineering display rules. They have not been calibrated against independent data and are not literature-established standards of reliability. The passing state, `indicative`, means only that a reference association estimate may be displayed.

1. The original local slope must be below zero. A nonnegative slope returns `nonnegative_slope`; it is not interpreted as planting-induced warming.
2. Local R² must be at least 0.10; otherwise return `weak_local_fit`. This suppresses estimates where canopy explains little of the variation in the weighted neighbourhood. Global R² is not used as block-level reliability.
3. Re-estimate slopes at half, equal to and twice the main neighbour count: 200, 400 and 800 in this run. Every slope must be negative. Any nonnegative or unestimable slope returns `unstable_direction`. This tests sensitivity of direction to neighbourhood size, not coefficient magnitude, spatial residuals or causality.
4. The main neighbourhood must have effective sample size `sum(w)^2 / sum(w^2)` of at least 30 and weighted canopy standard deviation of at least 1 percentage point; otherwise return `insufficient_local_support`. Effective sample size describes weight concentration here, not residual degrees of freedom for a statistical test.
5. Both current and scenario canopy cover must lie between the minimum and maximum canopy values among observations with positive weights in the main neighbourhood. Otherwise return `outside_local_canopy_range`. Boundary neighbours with zero weights do not extend the supported range.
6. Nonfinite parameters, degenerate local regressions and invalid support ranges cannot produce cooling numbers. Invalid numeric user input is rejected.

Holding all other rules fixed, local R² thresholds of 0.05, 0.10 and 0.20 admit 42,427, 37,222 and 25,762 blocks respectively. This demonstrates sensitivity to the threshold; it does not prove that 0.10 is optimal.

The fixed 80% ceiling has been removed. The 100% bound is purely mathematical, not a measure of planting space. Percentage scenarios are clipped at this bound; whole-tree requests that exceed it are rejected in full. Local observed canopy support still limits estimable scenarios. See the [planting assumptions report](PLANTING_ASSUMPTIONS.md) for crown-size sources, maturity timing and missing site-capacity data.

## Data interface

### Simulator JSON

`data/simulator_scenarios.json` contains `schema_version=3`, the policy, reason messages, input hashes, planting assumptions and `blocks`. Each block includes original observations, block-level status, four offline percentage scenarios and `tree_planting` parameters for whole-tree simulation.

Each percentage scenario contains `requested_delta_pp`, `applied_delta_pp`, `canopy_pct`, `status`, `reason_codes`, `predicted_uhi` and `cooling_c`. Positive `cooling_c` indicates an estimated reduction in °C. `predicted_uhi` is a surface-temperature deviation from a rural baseline, not absolute air temperature or future hot-day counts.

| Scenario status | Display behaviour |
|---|---|
| `baseline` | Display observed UHI and zero cooling; this is not an estimate of planting effects. |
| `no_change` | The percentage bound has been reached and actual canopy addition is zero; display the current value. |
| `indicative` | Display an indicative observational association, without claiming validated uncertainty intervals. |
| `unavailable` | Numeric estimates are JSON null; display the reason without a cooling number. |

Block-level status cannot replace scenario-level status. The observed baseline can still be displayed when a block has no planting estimate. The original observation map may remain visible when a scenario is unavailable, but it must not be presented as a simulated map. Do not replace null with zero, a global coefficient or a stale number.

Suggested message: `Local data do not support a reliable cooling estimate for this planting scenario.` Specific messages are stored under `reason_messages`. For `nonnegative_slope`, also explain: `This does not mean planting causes warming.`

### CSV compatibility

In `data/gwr_coefficients.csv`, `uhi_plusN` now contains screened values and is empty when unavailable. Added fields include `status_plusN`, `reasons_plusN`, `cooling_plusN`, `cooling_status`, `cooling_reason_codes`, `simulation_slope` and local diagnostics.

`raw_uhi_plusN`, the original `slope`, `intercept` and `uhi_hat` are retained for research checks and must not be used directly in the resident-facing interface. Empty CSV values must map to database/JSON NULL/null. Importers must handle the nullable scenario fields introduced with schema v2 and the planting parameters added in the current schema v3.

Arbitrary canopy increments must pass rules equivalent to `cooling_reliability.evaluate_scenario`. Do not interpolate across null values or multiply by `simulation_slope` while bypassing range checks. APIs should read offline outputs; fitting remains offline. Whole-tree scenarios must additionally follow the constraints in `tree_planting.simulate_trees`.

## Validation and limitations

The 27 coordinate and screening unit tests passed. Coverage includes positive and zero slopes, negative slopes with weak fits, unstable direction, local extrapolation, invalid input, null serialization, zero increments, canopy limits and degenerate fits. Deliberately corrupted exports confirmed that the audit rejects null-to-zero conversion, incorrect cooling numbers and inconsistent reasons. All 54,239 blocks and 216,956 percentage scenarios passed JSON/CSV consistency checks; raw-formula error was below 4e-15.

A further 14 planting tests bring the total to 41. Tests establish compliance with the implemented rules, not statistical reliability. Reference crown areas and model-supported tree-count limits have been added. Site-capacity data, local growth curves, formal uncertainty methods and further independent spatial validation are still required. No fabricated confidence intervals are exported, and neighbourhood sensitivity ranges are not labelled as 95% intervals.

Outputs from before screening are stored in `data/backups/before_reliability_screen/`, excluded from Git. Detailed counts are in `data/cooling_reliability_report.json`; block-level statuses are in the CSV and JSON exports.

## Method reference

[Esri's explanation of GWR](https://pro.arcgis.com/en/pro-app/3.6/tool-reference/spatial-statistics/how-geographicallyweightedregression-works.htm) describes how neighbourhood selection affects local models and discusses coefficient stability diagnostics. This project's R², effective-neighbour and canopy-standard-deviation thresholds are provisional project choices, not thresholds taken from that documentation. Its condition-number thresholds have not been repurposed here.
