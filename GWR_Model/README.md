# CoolChange GWR modelling

Offline Python modelling for historical Melbourne surface heat and mature-canopy
scenarios. This folder contains data preparation, OLS/GWR fitting, display
screening, tree-count calculations, uncertainty estimation and tests. The adjacent
`backend/` imports exported JSON and serves the simulator API; it does not train
the model when a user adds a tree.

## Set up

Run from the main repository root using Python 3.12 (minimum 3.11):

```bash
cd GWR_Model
python -m venv .venv
```

Activate on macOS/Linux with `source .venv/bin/activate`; on Windows PowerShell
use `.\.venv\Scripts\Activate.ps1`. Then, from `GWR_Model/`:

```bash
python -m pip install -r requirements.txt
python -B -m unittest discover -s tests -v
```

The suite contains 55 tests. Unit tests do not require the large model exports,
AWS credentials, Docker, or a running API. Default paths locate the adjacent
backend seed folder automatically. Optional overrides are documented in
[.env.example](.env.example); copy it to `.env` if needed. Relative overrides
resolve from this folder, not the terminal's working directory.

## Restore the recorded release

Large exports and duplicate seed snapshots stay outside Git. Follow
[artifact delivery and checksums](docs/ARTIFACTS.md) to restore the data bundle,
then run from `GWR_Model/`:

```bash
python -B -m coolchange.verify_artifacts
python -B -m coolchange.simulate_trees --export data/uncertainty_v1/simulator_scenarios.json --block 20631942810 --trees 10 --profile B
python -B -m coolchange.audit_data
```

The explicit export path selects the version with uncertainty. Without `--export`,
the simulator uses the original `data/simulator_scenarios.json`.
The current-data audit checks 54,239 blocks and 216,956 percentage scenarios for
the base release, plus whole-tree boundaries. It writes to
`data/audit_runs/latest/`, preserving the recorded reports in `data/`.

Historical before/after comparison is optional. If the old files are available:

```bash
python -B -m coolchange.audit_data --history-dir data/backups/before_coordinate_repair
```

That directory must contain `mesh_block_points.csv` and `gwr_model.json` for the
same block IDs. Missing requested history fails; omitted history is explicitly
reported as `not_requested`, not as a passed historical check.

## Generate a new release

Use a separate checkout or preserve any existing outputs first: training replaces
the base model artifacts. From `GWR_Model/`, prepare local seed snapshots and
validate the versioned coordinates, then train:

```bash
python -B -m coolchange.fetch_data
python -B -m coolchange.train_gwr --k 400
python -B -m coolchange.compare_models
python -B -m coolchange.audit_data
python -B -m coolchange.gwr_uncertainty --output-dir data/uncertainty_new
```

`fetch_data` reuses coordinates when their provenance matches; otherwise it
fetches source geometry. `uncertainty_new` must not exist: select a fresh output
directory on each run. Retraining generates a new release; exact file hashes may
differ across software versions and must not be labelled as the recorded release.
The current dependency ranges are not an environment lockfile.

## Structure and reports

| Folder | Purpose |
| --- | --- |
| `coolchange/` | Python modules and command-line entry points |
| `tests/` | Geometry, screening, planting, uncertainty and portability tests |
| `config/` | Sourced planting assumptions and exact-release artifact manifest |
| `docs/` | Method descriptions and recorded validation results |
| `data/` | Versioned coordinates/reports and ignored local model outputs |
| `releases/` | Ignored delivery bundles for S3 or GitHub Release attachments |

- [Coordinates and data quality](docs/DATA_QUALITY_REPORT.md)
- [Cooling display screening](docs/COOLING_RELIABILITY.md)
- [Planting assumptions and sources](docs/PLANTING_ASSUMPTIONS.md)
- [Conditional uncertainty intervals](docs/UNCERTAINTY.md)
- [Recorded uncertainty diagnostics](docs/UNCERTAINTY_VALIDATION.json)

Results describe indicative surface cooling **at maturity**, not real-time air
temperature, a local 2050 temperature forecast, or guaranteed planting effects.
Site capacity remains unknown. The nominal pointwise 95% intervals are conditional
model-based intervals: coverage is not validated, and spatial error correlation
is excluded. See the uncertainty report for details.
