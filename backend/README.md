# CoolChange backend

Story 0.3 read-only API on the `backend` branch. Schema, seed CSVs and reference SQL come from Yu (`data-analysis`); this branch owns the HTTP contract.

Screened tree-canopy model data can be imported offline and read through the new
`simulator` fields in bootstrap and mesh-block detail responses. See
[the simulator contract](docs/SIMULATOR_API.md) for import steps, fields and frontend rules.

Team: FOXES EAT IT. Stack: **Node.js 20 + Express + PostgreSQL/PostGIS**. Listen on **port 3000**. ALB health check is **`GET /health`**.

---

## How to run the server

From the `backend/` folder:

```bash
nvm use          # Node 20 (.nvmrc)
npm install
cp .env.example .env
npm run db:up    # start local PostGIS (Docker)
npm run migrate  # PostGIS + domain tables
npm run seed     # load Yu's mesh-block CSVs (needs psql)
npm run dev      # http://localhost:3000
```

Checks:

| URL | What it tells you |
|-----|-------------------|
| http://localhost:3000/health | process is up (ALB uses this path) |
| http://localhost:3000/health/db | Postgres is reachable and PostGIS is installed |
| http://localhost:3000/api/v1 | lists read-only endpoints |
| http://localhost:3000/api/v1/bootstrap | colour scale, model, metro projection bands |

Production-style start (no reload): `npm start`.

Stop the database: `npm run db:down`.

### Without Docker (Homebrew Postgres)

Docker Desktop is the default. If it is not installed, a local Homebrew Postgres also works for this scaffold (PostGIS will be skipped until you use the Compose image):

```bash
brew services start postgresql@16
createdb coolchange   # skip if it already exists
```

In `.env`, use port 5432 and your macOS user (no password):

```
DATABASE_URL=postgres://localhost:5432/coolchange
DATABASE_SSL=false
```

Then `npm run migrate` and `npm run dev` as above.

### Tests

```bash
npm test
```

`/health` and `/api` do not need the database. `/health/db` does.

---

## How to connect the database

Local development uses Docker Compose, not a cloud RDS instance.

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it.
2. From `backend/`, run `npm run db:up` (wraps `docker compose up -d`).
3. Wait until the `db` service is healthy (`npm run db:logs` if it hangs).
4. Copy `.env.example` to `.env`. The default URL is:

```
postgres://coolchange:coolchange@localhost:5433/coolchange
```

| Piece | Value |
|-------|--------|
| Host | `localhost` |
| Port | `5433` (mapped from container `5432` so Homebrew Postgres on 5432 is left alone) |
| Database | `coolchange` |
| User / password | `coolchange` / `coolchange` |
| SSL | off (`DATABASE_SSL=false`) |

GUI clients (TablePlus, DBeaver, psql) use the same URL. Example:

```bash
psql postgres://coolchange:coolchange@localhost:5433/coolchange
```

When Savio has cloud RDS ready, point `DATABASE_URL` at that instance and set `DATABASE_SSL=true`. Do not commit `.env`.

Migrations include PostGIS (001), domain tables (002), and versioned simulator data (005).
Apply pending migrations before starting the API. Import the simulator export after seeding.

---

## Folder structure

```
CoolChange/
├── README.md                 # team / project stub (repo root)
├── .gitignore
└── backend/                  # this service (Story 0.3)
    ├── README.md             # this file
    ├── package.json
    ├── .env.example          # copy to .env (not committed)
    ├── .nvmrc                # Node 20
    ├── docker-compose.yml    # local PostGIS
    ├── src/
    │   ├── index.js          # Express entry: CORS, routes, listen
    │   ├── config/index.js   # PORT, DATABASE_URL, DATABASE_SSL
    │   ├── db/
    │   │   ├── pool.js
    │   │   ├── migrate.js
    │   │   ├── seed.js
    │   │   ├── sql.js             # named queries (from Yu's queries.sql)
    │   │   ├── queries.sql        # reference SQL, not executed by Node
    │   │   ├── migrations/        # 001 PostGIS, 002 domain schema
    │   │   └── seeds/             # Yu's CSVs + load_seeds.sql
    │   ├── routes/
    │   │   ├── health.js
    │   │   ├── api.js             # GET /api index
    │   │   └── v1.js              # /api/v1/* read-only API
    │   ├── services/              # row → JSON contract
    │   └── http/errors.js
    └── tests/
```

Git: `main` → `development` → `backend`. Keep backend work on this branch until it merges into `development`.

---

## Commands

| Command | What it does |
|---------|----------------|
| `npm run db:up` | Start local PostGIS |
| `npm run db:down` | Stop local PostGIS (volume kept) |
| `npm run db:logs` | Follow database logs |
| `npm run migrate` | Apply pending SQL migrations |
| `npm run seed` | Load mesh-block CSVs via psql |
| `npm run simulator:import -- <file> [--dry-run]` | Validate or import the model's simulator export |
| `npm run dev` | API with reload |
| `npm start` | API without reload |
| `npm test` | Jest |

---

## Environment variables

| Variable | Meaning | Default |
|----------|---------|---------|
| `PORT` | API port | `3000` |
| `NODE_ENV` | `development` / `production` | `development` |
| `DATABASE_URL` | Postgres connection string | local Docker URL above |
| `DATABASE_SSL` | `true` for RDS | `false` |

## 2050 suburb projections

`GET /api/v1/map/projections` returns `scale`, `bands`, and `suburbs` for all
four warming levels (1.2, 1.5, 2.0, 3.0). It is independent of the observed map
endpoint, so a projection failure returns `503 PROJECTION_UNAVAILABLE` without
preventing the current map from loading. No migration or seed reload is needed.

Each suburb uses the most frequent mesh-block band; ties choose the higher
lower bound, then higher upper bound (open-ended first). Missing suburb/level
values use a valid original donor at that level, preferring the longest shared
boundary, then geographic distance and suburb code. If no bordering donor
exists, the nearest valid suburb is used. Donors never borrow from other donors.
`source_sa2_code16` retains provenance for auditing; it is not shown in the UI.
With no valid donor at a level, bounds stay null and the UI says `not available`.

The successful response is cached until API restart, including the global
minimum/maximum of all non-null lower and upper bounds and all distinct source
classes. Failed reads are not cached. NULL upper bounds mean an open-ended band,
not zero or an inferred cap. The frontend uses one solid colour per band, drawn
from this fixed domain, across every suburb and warming level.

The sun view displays climate projections at suburb scale. The tree view
restores the existing map and saved planting simulation. Added canopy does not
alter hot-day counts: the dataset contains no canopy-to-hot-days model. The
3.0°C level is labeled as a scenario, not a dated prediction.
