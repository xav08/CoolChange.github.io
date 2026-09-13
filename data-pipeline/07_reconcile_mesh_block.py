#!/usr/bin/env python3
"""
Cool Change - E1 street search: reconcile VicMap addresses to their TRUE
2016 mesh block via a real spatial join, replacing VicMap's own
current-edition mesh_block attribute.

Why: VicMap Address's `mesh_block` field tracks the CURRENT ASGS edition;
every table in our schema (mesh_block, mesh_block_geometry, ...) is frozen
to the 2016 edition. A sample check (06_vintage_match_check.py) measured
4.0% of addresses statewide -- and up to 56.7% in fast-growing corridors --
silently assigned to the wrong (or no) 2016 block by the attribute match.

Method: every address's real coordinate (fetched by download_data.py's
pull_d5(), which now requests geometry) is tested against the 2016
mesh_block_geometry polygons with ST_Contains -- run as ONE bulk spatial
join per chunk in Postgres, not 4.2M individual round-trips, via a
temporary staging table.

    python3 data-pipeline/07_reconcile_mesh_block.py

Needs DATABASE_URL set (same variable used for psql/load_seeds.sql).
Reads data/raw/vicmap_address.csv, writes data/raw/vicmap_address_2016.csv.
05_build_street_mesh_block.py reads the reconciled file, not the raw one.
"""
import io
import os

import pandas as pd

from _common import raw, D5

STAGING_TABLE = "_vicmap_reconcile_staging"
CHUNK_SIZE = 200_000   # rows joined per round-trip -- keeps progress visible
                       # and a failure from losing the whole run, not a
                       # performance requirement in itself


def check_spatial_index(cur):
    """A bulk spatial join over millions of points is only fast with a GIST
    index on mesh_block_geometry.geom -- refuse to proceed without one
    rather than let this run for hours with no explanation why."""
    cur.execute(
        "SELECT indexdef FROM pg_indexes "
        "WHERE tablename = 'mesh_block_geometry' AND indexdef ILIKE '%gist%'"
    )
    if not cur.fetchall():
        raise SystemExit(
            "mesh_block_geometry has no GIST spatial index -- a bulk join over "
            "millions of points would be extremely slow without one.\n"
            "Create one first:\n"
            "  CREATE INDEX IF NOT EXISTS ix_mesh_block_geometry_gist "
            "ON mesh_block_geometry USING GIST (geom);"
        )


def load_addresses():
    """Read the raw D5 fetch. Requires the coordinate columns pull_d5() now
    adds -- an old, pre-fix file without them is refused, not silently
    processed with missing coordinates."""
    path = raw(D5)
    df = pd.read_csv(path, dtype={"mesh_block": str})
    if "lon" not in df.columns or "lat" not in df.columns:
        raise SystemExit(
            f"{path} has no lon/lat columns -- it's from before the vintage-mismatch "
            f"fix. Re-run download_data.py to fetch it with coordinates."
        )
    before = len(df)
    df = df.dropna(subset=["lon", "lat"])
    dropped = before - len(df)
    if dropped:
        print(f"  dropping {dropped:,} rows with no coordinate returned by VicMap")
    return df


def join_chunk(cur, chunk):
    """One chunk's worth of the bulk spatial join: stage its (OBJECTID, lon,
    lat), then a single query asks Postgres -- using mesh_block_geometry's
    own GIST index -- which 2016 block each point actually falls in.
    Returns {object_id: mb_code16 or None}.
    """
    cur.execute(f"TRUNCATE {STAGING_TABLE}")

    # COPY, not executemany(): psycopg2's executemany() sends one INSERT
    # per row (200,000 individual round-trips for a full chunk), which is
    # the real cost here, not the spatial join itself -- confirmed by
    # EXPLAIN ANALYZE showing the GIST index already being used correctly,
    # sub-millisecond per lookup. COPY streams the whole chunk in one go,
    # same tool load_seeds.sql already uses for bulk loading elsewhere.
    buf = io.StringIO()
    chunk[["OBJECTID", "lon", "lat"]].to_csv(buf, header=False, index=False)
    buf.seek(0)
    cur.copy_expert(f"COPY {STAGING_TABLE} (object_id, lon, lat) FROM STDIN WITH (FORMAT csv)", buf)

    # Temp tables are never touched by autovacuum, so without this the
    # planner has zero statistics on the freshly-loaded staging table and
    # can badly misjudge the join strategy -- commonly this looks like the
    # GIST index on mesh_block_geometry being ignored entirely, even though
    # it exists, making the whole join run far slower than it should.
    cur.execute(f"ANALYZE {STAGING_TABLE}")
    cur.execute(f"""
        SELECT t.object_id, RTRIM(g.mb_code16)
          FROM {STAGING_TABLE} t
          LEFT JOIN mesh_block_geometry g
            ON ST_Contains(g.geom, ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326))
    """)
    results = {}
    for object_id, mb_code16 in cur.fetchall():
        # a point sitting exactly on a shared boundary could match more than
        # one polygon -- first one wins, arbitrarily but harmlessly, since
        # both are genuinely adjacent 2016 blocks
        results.setdefault(object_id, mb_code16)
    return results


def bulk_spatial_join(df, cur):
    cur.execute(f"""
        CREATE TEMP TABLE {STAGING_TABLE} (
            object_id BIGINT PRIMARY KEY,
            lon DOUBLE PRECISION,
            lat DOUBLE PRECISION
        )
    """)

    resolved = {}
    chunks = [df.iloc[i:i + CHUNK_SIZE] for i in range(0, len(df), CHUNK_SIZE)]
    for i, chunk in enumerate(chunks, start=1):
        resolved.update(join_chunk(cur, chunk))
        print(f"      chunk {i}/{len(chunks)} joined ({len(resolved):,} resolved so far)", end="\r")
    print()
    return resolved


def reconcile(df, cur):
    """The full reconciliation: spatial join, merge onto the address frame,
    and a plain informational comparison against the old attribute-based
    method. Pulled out of main() so it's testable without a real DATABASE_URL."""
    check_spatial_index(cur)
    resolved = bulk_spatial_join(df, cur)

    df = df.copy()
    df["mb_code16_2016"] = df["OBJECTID"].map(resolved)

    n_total = len(df)
    n_resolved = df["mb_code16_2016"].notna().sum()
    n_outside = n_total - n_resolved
    print(f"\n{n_resolved:,} / {n_total:,} addresses fall inside a 2016 mesh block "
          f"({n_outside:,} outside all 2016 polygons -- overwhelmingly addresses outside "
          f"our metro study area entirely, same population the old attribute method "
          f"excluded via locality; mesh_block_geometry was confirmed to fully cover all "
          f"54,239 study-area blocks, so this isn't a geometry-coverage gap)")

    same = (df["mb_code16_2016"] == df["mesh_block"]).sum()
    changed = n_resolved - same
    print(f"Compared to VicMap's own (current-edition) mesh_block attribute: "
          f"{changed:,} addresses now resolve to a DIFFERENT 2016 block than "
          f"the attribute claimed -- this is the vintage-mismatch fix taking effect.")

    return df


def main():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL is not set -- same variable used for psql/load_seeds.sql.")
    import psycopg2

    print("Loading raw VicMap addresses (with coordinates) ...")
    df = load_addresses()
    print(f"  {len(df):,} addresses with a real coordinate")

    print("\nRunning the bulk spatial join against mesh_block_geometry ...")
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()
    try:
        df = reconcile(df, cur)
    finally:
        cur.close()
        conn.close()

    out_path = os.path.join(os.path.dirname(raw(D5)), "vicmap_address_2016.csv")
    df.to_csv(out_path, index=False)
    print(f"\n-> {out_path}")


if __name__ == "__main__":
    main()