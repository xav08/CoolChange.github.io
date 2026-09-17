# Recorded model artifacts

Source code, tests, assumptions, coordinate anchors and small reports belong in
Git. Large fitted outputs and copies of backend seed CSVs are ignored locally.
Ignoring them does not delete the files already on your computer.

## Restore the exact shared release

The prepared bundle is named `coolchange-gwr-5905ff7a1736.tar.gz`. It contains
the original and uncertainty exports, matching coefficients, all recorded data
snapshots, and planting assumptions. Its companion `.sha256` file records the
archive checksum. Local delivery copies live in `GWR_Model/releases/` and
are intentionally excluded from Git.

The bundle has **not been uploaded automatically**. The maintainer should attach
it and its `.sha256` file to a GitHub Release or share them through the team's S3
storage, then record that location in the PR. A source-code clone alone does not
include these outputs. Do not substitute another model's JSON or coefficients.

Download both files into an empty working folder and check the archive before
extracting. On macOS use `shasum -a 256 -c coolchange-gwr-5905ff7a1736.tar.gz.sha256`;
on Linux use `sha256sum -c` with the same file. On Windows PowerShell compare
`Get-FileHash coolchange-gwr-5905ff7a1736.tar.gz -Algorithm SHA256` with the
companion checksum. Then extract into a **fresh** `GWR_Model/` checkout:

```bash
tar -xzf /path/to/coolchange-gwr-5905ff7a1736.tar.gz -C /path/to/CoolChange/GWR_Model
```

Replace the example paths with your downloaded archive and checkout locations.
Extraction replaces matching files, so preserve any local experiments first.
From `GWR_Model/`, with the Python dependencies installed:

```bash
python -B -m coolchange.verify_artifacts
```

This checks every path and SHA-256 in `config/artifact_manifest.json`, including
the input snapshots and both exports. The backend importer derives the release ID
from the JSON bytes; editing or reserializing JSON changes that release ID.

| Export | SHA-256 / release ID |
| --- | --- |
| Base | `e18c8f7acd632a98b6aa4024bbed7fa6920361c7f906bc4ab53eef1959c4ad32` |
| With uncertainty | `5905ff7a173680ca545f4a1e18fd179eb497636d4c4bba54d120b547bfde8df6` |

Only the newer JSON is needed to import this release into a compatible backend.
The base JSON, coefficients and snapshots are also supplied so the modelling
workflow and base-data audit can be reproduced. The backend database is not
changed by restoring or verifying this bundle.

## Work from source instead

The main repository already versions `mesh_block.csv`,
`mesh_block_projection.csv` and `model_coefficient.csv` under
`backend/src/db/seeds/`. `python -m coolchange.fetch_data` copies them to the
ignored local model data directory, then validates/rebuilds coordinates.
Follow the [README](../README.md) to train and create a new uncertainty directory.

The manifest identifies the existing release, not arbitrary future training runs.
For a new release, review and update its manifest, validation reports, checksums
and delivery bundle together. Do not claim the old hashes for regenerated files.
