# Local database validation — 2026-09-13

The simulator backend was verified against real PostgreSQL and HTTP in the
local Docker database. Frontend integration and deployment are still pending.

## Environment and model release

- Branch: `backend`.
- Docker container: `coolchange-db`, PostgreSQL 16.4, PostGIS 3.4.3.
- Target: `localhost:5433/coolchange`.
- The existing Homebrew database on port 5432 was not modified.
- `backend/.env` was not changed: it still targets port 5432. Migration/import
  commands used explicit environment overrides; the verifier defaults to 5433.
- Full export: `/Users/type/Monash_Code/coolchange-ml-lab/FIT5120_CoolChange_Mode/data/simulator_scenarios.json`.
- Schema: 3; screening policy: `cooling-screen-v2`; planting assumptions: `planting-v1`.
- Release SHA-256: `e18c8f7acd632a98b6aa4024bbed7fa6920361c7f906bc4ab53eef1959c4ad32`.

The full model file remains in the model repository; it was not copied into
the web repository. The three-block test fixture was used only to confirm that
an incomplete import is rejected, never as a replacement for the full dataset.

## Verified results

| Check | Result |
| --- | --- |
| Migrations | 001, 002 and 005 applied; repeat run skipped all three |
| Base mesh blocks | 54,239 |
| Area baselines | 744 |
| Block projections | 204,532 |
| Metro projections / app configuration / legacy OLS | 4 / 6 / 1 |
| Seed assertions | All passed, including population and expected missing SEIFA |
| Full model import | 54,239 blocks; one active release |
| Database versus export | All baseline IDs/values/areas matched at PostgreSQL REAL precision; every stored model payload matched the source |
| Scenarios compared | 216,956 |
| Block-level indicative / unavailable | 37,222 / 17,017 |
| HTTP health and bootstrap | Database connected; PostGIS present; exact simulator metadata and release ID |
| HTTP meshblock list | 54,239 rows |
| HTTP block details | Four selected blocks covered exact baseline/scenario payloads, unavailable results and out-of-range scenarios |
| Missing data behavior | SEIFA stayed null; absent block projections used explicitly labelled metro fallback; unknown block returned 404 |
| Repeat full import | No duplicate release or block records; active release unchanged |
| Incomplete import rollback | Rejected both before and after full import; existing data and active release preserved |
| Existing automated tests | 6 suites, 51 tests passed after the fix below |

The real HTTP checks used a temporary loopback server connected to the Docker
database, without mocked SQL. They did not run the browser frontend. Full
payload equality was checked for every database block; HTTP responses were
checked for representative cases, not all 54,239 detail URLs.

## Issue found and fixed

For a block with a published `15+` band at warming level 2.0, the database's
`days_upper = null` was incorrectly replaced with the metro upper bound 15 by
`COALESCE`. The API returned an inconsistent interval with both bounds at 15.

`src/db/sql.js` and the companion `queries.sql` now use the metro upper bound
only when the entire block projection row is absent. A published open upper
bound stays null. The real-database verifier includes regression checks for
both open-ended bands and missing-row fallback.

## Reproduce the read-only checks

From `backend/`, with Docker running and the release already imported:

```bash
npm run simulator:verify -- /Users/type/Monash_Code/coolchange-ml-lab/FIT5120_CoolChange_Mode/data/simulator_scenarios.json
npm test -- --runInBand
```

The verifier rejects database targets other than local port 5433 and uses
read-only database sessions. It does not migrate, seed or import. It starts a
temporary HTTP server on an automatically assigned loopback port and closes it
after the checks. The original import and repeat/rollback checks were separate
validation steps.

To run an API instance against this verified Docker data on a separate port:

```bash
DATABASE_URL=postgres://coolchange:coolchange@localhost:5433/coolchange DATABASE_SSL=false PORT=3002 npm start
```

Then inspect `/health/db`, `/api/v1/bootstrap`,
`/api/v1/meshblocks/20631942810` and `/api/v1/meshblocks/20046872000` on
`http://localhost:3002`. A normal `npm start` without the database override still
uses the existing `.env` target on port 5432.

## Remaining scope

Wire the frontend to the new fields and validate integer-tree calculations
against the model's `tree_planting_examples.json`. The backend currently serves
parameters and percentage-point scenarios; this verification does not claim
that a tree-count calculation endpoint or browser interaction is complete.

Coordinate other branches' street/geometry migrations separately: this branch
contains 001, 002 and 005. Actual planting capacity remains unassessed and the
model does not supply calibrated uncertainty intervals.
