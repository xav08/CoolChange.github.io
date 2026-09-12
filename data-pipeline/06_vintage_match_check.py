#!/usr/bin/env python3
"""
Cool Change - E1 street search: vintage-mismatch check (one-off diagnostic)

VicMap Address's `mesh_block` field tracks the CURRENT ASGS edition; every
table in our schema (mesh_block, mesh_block_geometry, ...) is frozen to the
2016 edition. Codes in both editions are 11 digits starting with 2, so a
vintage mismatch never raises an error -- it just silently produces a wrong
join. This script measures how often that actually happens, using a real
sample, rather than assuming either way.

Method: for a sample of addresses 05_build_street_mesh_block.py already
assigned to a 2016 block via the attribute match, fetch each address's real
coordinate from VicMap and test it against our own 2016 mesh_block_geometry
polygons with an actual point-in-polygon query. If the claimed block and the
spatial answer disagree, that's a genuine vintage mismatch, not a guess.

Two sample pools, not one blended number:
  - ~1,000 addresses, uniform random across every matched row (statewide baseline)
  - ~300 addresses each from the growth corridors already flagged in the
    05_ zero-street-blocks finding (Cranbourne East, Doreen, Tarneit,
    Mernda, Melton South) -- exactly where a real post-2016 boundary change
    is most likely to have happened

    python3 data-pipeline/06_vintage_match_check.py

Needs DATABASE_URL set (same variable already used for psql/load_seeds.sql).
Read-only against mesh_block_geometry -- does not touch any seed CSV or
write to the database. Needs network access to VicMap's FeatureServer.
"""
import os

import pandas as pd
import requests

from _common import load_d1, load_d5

GROWTH_CORRIDORS = ["CRANBOURNE EAST", "DOREEN", "TARNEIT", "MERNDA", "MELTON SOUTH"]
STATEWIDE_SAMPLE_SIZE = 1000
CORRIDOR_SAMPLE_SIZE = 300
SAMPLE_SEED = 20260911          # fixed, so a rerun samples the same addresses
BATCH_SIZE = 200                # OBJECTIDs per VicMap request, same reasoning as pull_d5()

VICMAP_URL = ("https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/arcgis/rest/services/"
              "Vicmap_Address/FeatureServer/0/query")


def load_matched_addresses():
    """Re-derive 05_'s own filter (mesh_block in our 54,239 study-area
    codes) rather than reading its CSV output -- street.csv/
    street_mesh_block.csv are already collapsed to street grain and no
    longer carry individual OBJECTIDs, which this check needs."""
    d1 = load_d1()
    d5 = load_d5()
    valid_codes = set(d1.MB_CODE16)
    return d5[d5.mesh_block.isin(valid_codes)].copy()


def build_sample(matched):
    """Statewide random pool + a fixed-size pool per flagged growth
    corridor. A corridor with fewer matched rows than CORRIDOR_SAMPLE_SIZE
    just takes everything it has -- printed as a note, not an error."""
    statewide = matched.sample(
        n=min(STATEWIDE_SAMPLE_SIZE, len(matched)), random_state=SAMPLE_SEED
    ).assign(pool="STATEWIDE")

    corridor_frames = []
    for corridor in GROWTH_CORRIDORS:
        subset = matched[matched.locality_name == corridor]
        n = min(CORRIDOR_SAMPLE_SIZE, len(subset))
        if n < CORRIDOR_SAMPLE_SIZE:
            print(f"  note: {corridor} has only {len(subset):,} matched addresses, "
                  f"sampling all of them (wanted {CORRIDOR_SAMPLE_SIZE})")
        if n == 0:
            print(f"  note: {corridor} has zero matched addresses, skipping this pool")
            continue
        corridor_frames.append(subset.sample(n=n, random_state=SAMPLE_SEED).assign(pool=corridor))

    return pd.concat([statewide] + corridor_frames, ignore_index=True)


def fetch_coordinates(object_ids):
    """Re-fetch just these OBJECTIDs from VicMap, this time WITH geometry,
    requested directly in outSR=4326 so it lines up with
    mesh_block_geometry's SRID -- no reprojection needed on our side.

    Uses POST, not GET: a 200-OBJECTID `IN (...)` clause makes the encoded
    GET query string long enough that ArcGIS Online's edge/CDN rejects it
    with a bare 404 (same failure hit and fixed in download_data.py's
    pull_d5() for the same reason). OBJECTID lookups themselves are fast/
    indexed, so this doesn't carry pull_d5()'s earlier IN-list *speed*
    problem -- only the URL-length issue applies here.
    """
    points = {}
    batches = [object_ids[i:i + BATCH_SIZE] for i in range(0, len(object_ids), BATCH_SIZE)]
    for i, batch in enumerate(batches, start=1):
        where = "OBJECTID IN (" + ",".join(str(oid) for oid in batch) + ")"
        r = requests.post(VICMAP_URL, data={
            "where": where, "outFields": "OBJECTID", "returnGeometry": "true",
            "outSR": "4326", "f": "json",
        }, timeout=60)
        r.raise_for_status()
        payload = r.json()
        if "error" in payload:
            raise SystemExit(f"VicMap error on batch {i}/{len(batches)}: {payload['error']}")
        for feat in payload.get("features", []):
            geom = feat.get("geometry")
            if geom:
                points[feat["attributes"]["OBJECTID"]] = (geom["x"], geom["y"])  # (lon, lat)
        print(f"      fetched batch {i}/{len(batches)}", end="\r")
    print()
    return points


def check_against_geometry(sample, points, db_connect):
    """For each sampled address, ask Postgres which 2016 block its REAL
    point actually falls in, and compare to what the attribute match
    assigned it. Three outcomes:
      MATCH    - spatial answer agrees with the attribute-based assignment
      MISMATCH - the point actually falls in a DIFFERENT 2016 block
      OUTSIDE  - the point falls in none of our 2016 polygons at all (a
                 more severe case than MISMATCH -- there's no correct 2016
                 answer for this point, not just a wrong one)
    db_connect is an injected connection factory so this can be tested with
    a fake one, without a real Postgres instance.
    """
    conn = db_connect()
    cur = conn.cursor()
    rows = []
    try:
        for _, row in sample.iterrows():
            point = points.get(row.OBJECTID)
            if point is None:
                continue  # VicMap returned no geometry for this one -- skip, don't guess
            lon, lat = point
            cur.execute(
                "SELECT RTRIM(mb_code16) FROM mesh_block_geometry "
                "WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326)) LIMIT 1",
                (lon, lat),
            )
            found = cur.fetchone()
            actual_code = found[0] if found else None
            claimed_code = row.mesh_block
            if actual_code is None:
                outcome = "OUTSIDE"
            elif actual_code == claimed_code:
                outcome = "MATCH"
            else:
                outcome = "MISMATCH"
            rows.append({
                "pool": row.pool, "object_id": row.OBJECTID,
                "road_name": row.road_name, "locality_name": row.locality_name,
                "claimed_mb_code16": claimed_code, "actual_mb_code16": actual_code,
                "outcome": outcome,
            })
    finally:
        cur.close()
        conn.close()
    return pd.DataFrame(rows)


def summarize(results):
    print("\nResults by pool:")
    for pool, group in results.groupby("pool"):
        n = len(group)
        n_match = (group.outcome == "MATCH").sum()
        n_mismatch = (group.outcome == "MISMATCH").sum()
        n_outside = (group.outcome == "OUTSIDE").sum()
        wrong_rate = (n_mismatch + n_outside) / n * 100 if n else 0
        print(f"  {pool:20s} n={n:4d}  match={n_match:4d}  "
              f"mismatch={n_mismatch:3d}  outside_2016={n_outside:3d}  wrong={wrong_rate:.1f}%")

    n = len(results)
    n_wrong = ((results.outcome == "MISMATCH") | (results.outcome == "OUTSIDE")).sum()
    rate = n_wrong / n * 100 if n else 0
    print(f"\nOverall: {n_wrong}/{n} addresses assigned to the wrong (or no) 2016 block ({rate:.2f}%)")
    if n_wrong == 0 and n:
        print(f"Zero wrong assignments in {n} samples -- by the rule of three, this bounds "
              f"the true rate to roughly below {300 / n:.2f}% with ~95% confidence.")


def main():
    print("Loading matched addresses (re-deriving 05_'s own filter) ...")
    matched = load_matched_addresses()
    print(f"  {len(matched):,} addresses currently assigned to a study-area block")

    print("\nBuilding sample ...")
    sample = build_sample(matched)
    print(f"  {len(sample):,} addresses sampled across {sample.pool.nunique()} pools")

    print("\nFetching real coordinates from VicMap for the sample ...")
    points = fetch_coordinates(sample.OBJECTID.tolist())
    print(f"  {len(points):,} / {len(sample):,} coordinates returned")

    print("\nChecking each sampled point against our 2016 mesh_block_geometry ...")
    import psycopg2
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL is not set -- same variable used for psql/load_seeds.sql.")
    results = check_against_geometry(sample, points, lambda: psycopg2.connect(db_url))

    out_path = os.path.join(os.path.dirname(__file__), "vintage_match_check_results.csv")
    results.to_csv(out_path, index=False)
    print(f"\nFull per-address results written to {out_path}")

    summarize(results)


if __name__ == "__main__":
    main()