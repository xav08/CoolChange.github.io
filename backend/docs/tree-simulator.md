# Interactive tree simulator

The selected mesh-block card contains a whole-tree slider, live canopy and surface-heat results, an approximate 95% model range, and Before/After map controls. All slider arithmetic runs in the browser. Selecting a block loads its model through the existing `GET /api/v1/meshblocks/:code` request.

## Data and interpretation

`simulator.interactive` contains unrounded `mesh_block` canopy, area and observed heat; profile B's mature crown area (50.3 m²); the screened GWR slope and coefficient bounds; an effective canopy ceiling; and model-source information. Existing exported fields and scenarios are preserved unchanged.

- Added canopy percentage points = trees × crown area / block area × 100.
- Modelled heat = observed heat + slope × added canopy percentage points.
- Heat bounds = observed heat + each coefficient bound × added canopy percentage points.
- Whole-tree limit = floor((ceiling − baseline canopy) / 100 × area / crown area).
- Heat is the 2018 surface-temperature deviation from non-urban land. These are mature-tree scenarios under baseline climate conditions, not present weather or 2050 temperatures.
- The nominal 95% range concerns the conditional mean association. Coverage is unvalidated; it excludes spatial error correlation, observation noise, tree growth/survival uncertainty, and the extra uncertainty of borrowing a neighbour's model. It is not a prediction interval or causal guarantee. Negative cooling bounds are retained. No interval is shown for zero added trees.

For an unavailable fit, the API first finds a touching block with a usable negative slope and a canopy range containing the selected baseline. If none qualifies, it chooses the nearest usable block by centroid distance in metres. Ties use the mesh-block code. The coefficient and its uncertainty come from that donor; baseline and area stay with the selected block. The ceiling is the minimum of the selected block's local maximum, the donor's local maximum and 100%. This prevents extrapolation beyond either range. Source identifiers are shown in the help tooltip. An unavailable donor or no room for a whole tree leaves the slider disabled.

## Model source and import

The default source is [the S3 simulator export](https://coolchange-model-transfer-yipu-20260914.s3.ap-southeast-4.amazonaws.com/simulator_scenarios.json). Full exports in `backend/src/db/GWR/` are ignored by Git. The backend imports the S3 JSON into PostgreSQL; it does not download it for each request or slider movement. The active release records the source URL and a SHA-256 identifier of the downloaded bytes.

Run from `backend` with `DATABASE_URL` targeting the intended database:

```powershell
$env:AWS_PROFILE = "coolchange"
npm run simulator:import
npm run simulator:verify
```

### Laptop sign-in for the private S3 object

Install [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) (2.32.0 or newer), then sign in with your existing AWS console account:

```powershell
aws login --profile coolchange --region ap-southeast-4
$env:AWS_PROFILE = "coolchange"
npm run simulator:import -- --dry-run
npm run simulator:import
```

The default model URL uses the AWS SDK's authenticated S3 GetObject request. It reads the selected AWS profile and temporary login cache from your Windows user folder (`%USERPROFILE%\.aws`), outside the project. It does not store your console password or require a permanent access key. Renew the login when the temporary session expires. The API continues serving the imported model from PostgreSQL after the login expires; AWS access is only needed for the next model import or source verification.

AWS requires `SignInLocalDevelopmentAccess` for this sign-in flow and `s3:GetObject` for `arn:aws:s3:::coolchange-model-transfer-yipu-20260914/simulator_scenarios.json`. If login reports missing permission, ask the account administrator to enable local-development sign-in; the application does not alter IAM or bucket permissions. See [AWS local-development sign-in](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).

The importer validates original scenario arithmetic and the optional uncertainty fields, checks database baselines at their stored precision, and atomically activates the complete release. Old releases remain available. The verification command is restricted to the local Docker database on port 5433.

An explicit HTTPS URL or local JSON path may be passed after `--` for a controlled import. Other HTTPS URLs, including temporary signed download links, use ordinary HTTPS; query strings and URL credentials are omitted from stored source metadata. `--dry-run` downloads and validates without accessing the database. Downloads require HTTPS, have a two-minute timeout and a 150 MB limit; failed downloads leave the active database release untouched. Re-run the import when the S3 object is updated.

`DATABASE_URL` selects the database for the API and importer. Without it, both use local PostgreSQL at `localhost:5433/coolchange`. Set `DATABASE_URL` and `DATABASE_SSL=true` in the deployment environment to use the cloud database; the S3 URL does not change the database connection. Run the importer against that deployment database before using the simulator there.

## Saved scenarios and comparison

All blocks with added trees in the current suburb are retained, with no three-block limit. They are saved in local storage under `coolchange-planting-v2` with suburb identifiers and survive refresh and reselecting the same suburb. Successfully loading another suburb clears the previous additions, including through street search. A failed request does not clear them. Returning to the overview alone retains the saved suburb until a different one is selected. Old v1 records are no longer read because they lack suburb identifiers.

The collapsible added-tree list shows block codes and tree counts. Selecting an entry opens and centres that block. Each entry has a Reset button; Reset all clears every addition and restores baseline colours.

Before/After toggles every retained block on the existing heat scale, preserving the tree counts. Changes automatically switch to After. Selecting a block reconciles stored models with the current release; models from a different release are discarded. Data stays on the user's browser and is not saved to the server.

## Verification

`npm test` in `frontend` covers arithmetic, whole-tree limits, suburb changes, persistence validation and intervals that include warming. It uses Node 22.18+ for TypeScript stripping. `npm test -- --runInBand` in `backend` covers API behaviour, source fallback, precision and invalid uncertainty data. `npm run build` and `npm run lint` in `frontend` check compilation and code quality.
