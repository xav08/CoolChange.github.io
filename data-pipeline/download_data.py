#!/usr/bin/env python3
"""
Cool Change — download every dataset the project uses.

Run this ON YOUR OWN MACHINE (it needs internet).

    pip install requests pandas
    python download_data.py                # everything except the big geometry file
    python download_data.py --geometry     # also pull mesh block polygons (~10-20 min)

Everything lands in ./data/raw/. Re-running skips files that already exist.
"""

import argparse, json, os, sys, time
import requests

RAW = os.path.join("data", "raw")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"}

D1 = ("https://plan-gis.mapshare.vic.gov.au/arcgis/rest/services/"
      "CoolingGreening/CoolingGreening/MapServer/55/query")
D2 = ("https://services-ap1.arcgis.com/Xoz8Es66HpfM8jP9/arcgis/rest/services/"
      "temperature_hazardvariables__proj_gwls__classified_aus__mm/FeatureServer/1/query")
D5 = ("https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/arcgis/rest/services/"
      "Vicmap_Address/FeatureServer/0/query")

D1_FIELDS = ("OBJECTID,MB_CODE16,SA1_MAIN16,SA2_MAIN16,SA2_NAME16,SA3_CODE16,SA3_NAME16,"
             "LGA,UHI18_M,PERANYTREE,PERGRASS,PERSHRUB,PERANYVEG,PERSHRBTRE,"
             "PERTR03_10,PERTR10_15,PERTR15PL,Shape_Area")
D5_FIELDS = "OBJECTID,road_name,road_type,road_suffix,locality_name,mesh_block"
D5_PAGE_SIZE = 2000                # VicMap FeatureServer's max record count (D1 uses 1000)

EXPECTED_D1_COUNT = 54239          # verified 20 Aug 2026
EXPECTED_D2_COUNT = 132
# No EXPECTED_D5_COUNT: VicMap Address updates weekly (unlike D1's static 2018
# snapshot), and this pull is deliberately unfiltered (see pull_d5()), so
# there's no fixed row count to check against here. The page loop terminating
# cleanly is the correctness gate for the download step; the real
# mesh_block-membership check happens in 05_build_street_mesh_block.py.

FILES = {                          # plain HTTP downloads
    "2016_census_mesh_block_counts.csv":
        "https://www.abs.gov.au/AUSSTATS/subscriber.nsf/log?openagent"
        "&2016 census mesh block counts.csv&2074.0&Data Cubes"
        "&1DED88080198D6C6CA2581520083D113&0&2016&04.07.2017&Latest",
    "seifa_2016_sa1_indexes.xls":
        "https://www.abs.gov.au/ausstats/subscriber.nsf/log?openagent"
        "&2033055001 - sa1 indexes.xls&2033.0.55.001&Data Cubes"
        "&40A0EFDE970A1511CA25825D000F8E8D&0&2016&27.03.2018&Latest",
    "UHI-and-HVI2018_Report_v1.pdf":
        "https://www.planning.vic.gov.au/__data/assets/pdf_file/0032/"
        "655826/UHI-and-HVI2018_Report_v1.pdf",
}


def out(name):
    return os.path.join(RAW, name)


def have(name, min_bytes=1024):
    p = out(name)
    return os.path.exists(p) and os.path.getsize(p) > min_bytes


def get(url, params=None, tries=4, timeout=120):
    """GET with retries. Returns the response or raises."""
    for attempt in range(tries):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=timeout)
            r.raise_for_status()
            return r
        except Exception as e:
            if attempt == tries - 1:
                raise
            wait = 2 ** attempt
            print(f"    retry in {wait}s ({e.__class__.__name__})")
            time.sleep(wait)


# ----------------------------------------------------------------- D1 attributes
def pull_d1_attributes():
    name = "meshblocks_attributes.csv"
    if have(name, 1_000_000):
        print(f"[skip] {name}")
        return
    print("[1/7] Mesh block attributes (heat + canopy) …")
    import pandas as pd
    rows, offset = [], 0
    while True:
        r = get(D1, params={
            "where": "1=1", "outFields": D1_FIELDS, "returnGeometry": "false",
            "orderByFields": "OBJECTID", "resultOffset": offset,
            "resultRecordCount": 1000, "f": "json",
        })
        feats = r.json().get("features", [])
        if not feats:
            break
        rows.extend(f["attributes"] for f in feats)
        offset += len(feats)
        print(f"      {offset:,}", end="\r")
        if len(feats) < 1000:
            break
    df = pd.DataFrame(rows)
    print(f"      {len(df):,} rows            ")

    ok = True
    if len(df) != EXPECTED_D1_COUNT:
        print(f"  !! expected {EXPECTED_D1_COUNT:,} rows, got {len(df):,}"); ok = False
    if df["UHI18_M"].isna().any() or df["PERANYTREE"].isna().any():
        print("  !! unexpected nulls in UHI18_M / PERANYTREE"); ok = False
    if df["MB_CODE16"].nunique() != len(df):
        print("  !! MB_CODE16 is not unique"); ok = False
    if ok:
        print("      checks passed")

    df.to_csv(out(name), index=False)
    try:
        df.to_parquet(out("meshblocks_attributes.parquet"))
    except Exception:
        pass          # pyarrow not installed — csv is enough
    print(f"      -> {out(name)}")


# ----------------------------------------------------------------- D1 geometry
def pull_d1_geometry():
    name = "meshblocks.geojson"
    if have(name, 10_000_000):
        print(f"[skip] {name}")
        return
    print("[2/7] Mesh block polygons — this is the slow one …")
    feats, offset = [], 0
    while True:
        r = get(D1, params={
            "where": "1=1", "outFields": "MB_CODE16", "returnGeometry": "true",
            "outSR": 4326,                    # WGS84 — reproject later for GWR
            "geometryPrecision": 6,
            "orderByFields": "OBJECTID", "resultOffset": offset,
            "resultRecordCount": 1000, "f": "geojson",
        }, timeout=300)
        page = r.json().get("features", [])
        if not page:
            break
        feats.extend(page)
        offset += len(page)
        print(f"      {offset:,} / {EXPECTED_D1_COUNT:,}", end="\r")
        if len(page) < 1000:
            break
    print(f"      {len(feats):,} polygons              ")
    with open(out(name), "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f)
    mb = os.path.getsize(out(name)) / 1e6
    print(f"      -> {out(name)}  ({mb:.0f} MB)")


# ----------------------------------------------------------------- D5
def _clean_mesh_block(v):
    """Normalise to a zero-padded 11-digit string, or None.

    ArcGIS sometimes serialises this string field as a bare JSON number.
    Also handles NaN (not just None) since a null in a float64 column
    surfaces as NaN.
    """
    if v is None or (isinstance(v, float) and v != v):   # v != v is the NaN check
        return None
    return str(int(v)).zfill(11)


def pull_d5():
    name = "vicmap_address.csv"
    if have(name, 1_000_000):
        print(f"[skip] {name}")
        return
    print("[4/7] Vicmap Address (street <-> mesh block) -- unfiltered, "
          "filtering to our 54,239 blocks happens in 05_build_street_mesh_block.py ...")
    import pandas as pd

    # Unfiltered scan + Python-side filtering in Phase 2, paged by OBJECTID
    # cursor (not resultOffset), with checkpointing to a .partial file so a
    # failure resumes instead of restarting. See the pipeline decision log
    # for why.
    count_r = get(D5, params={"where": "1=1", "returnCountOnly": "true", "f": "json"})
    count_payload = count_r.json()
    if "error" in count_payload:
        raise SystemExit(f"ArcGIS returned an error getting the total count: {count_payload['error']}")
    total = count_payload["count"]
    print(f"      service reports {total:,} total rows")

    partial = out(name) + ".partial"
    last_oid, n_so_far, header_written, saw_valid_mesh_block = 0, 0, False, False

    if os.path.exists(partial):
        existing = pd.read_csv(partial, dtype={"mesh_block": str})
        if len(existing):
            last_oid = int(existing["OBJECTID"].max())
            n_so_far = len(existing)
            header_written = True
            saw_valid_mesh_block = existing["mesh_block"].notna().any()
        print(f"      resuming: {n_so_far:,} rows already saved, continuing after OBJECTID {last_oid:,}")

    while True:
        r = get(D5, params={
            "where": f"OBJECTID > {last_oid}", "outFields": D5_FIELDS, "returnGeometry": "false",
            "orderByFields": "OBJECTID", "resultRecordCount": D5_PAGE_SIZE, "f": "json",
        })
        payload = r.json()
        if "error" in payload:
            raise SystemExit(
                f"ArcGIS returned an error after OBJECTID {last_oid:,} "
                f"({n_so_far:,} rows saved so far in {partial}): {payload['error']}\n"
                f"Progress up to this point is preserved in that file -- "
                f"just re-run to resume from here, don't delete it."
            )
        feats = payload.get("features", [])
        if not feats:
            break

        page_df = pd.DataFrame(f["attributes"] for f in feats)
        page_df["mesh_block"] = page_df["mesh_block"].map(_clean_mesh_block)
        if page_df["mesh_block"].notna().any():
            saw_valid_mesh_block = True

        page_df.to_csv(partial, mode="a", header=not header_written, index=False)
        header_written = True
        n_so_far += len(page_df)
        last_oid = int(page_df["OBJECTID"].max())
        print(f"      {n_so_far:,} / {total:,}", end="\r")
        if len(feats) < D5_PAGE_SIZE:
            break

    print(f"      {n_so_far:,} rows            ")

    if n_so_far != total:
        raise SystemExit(
            f"!! fetched {n_so_far:,} rows but the service reports {total:,} total -- "
            f"the fetch stopped early after OBJECTID {last_oid:,}.\n"
            f"Progress is saved in {partial} -- just re-run to resume from here, "
            f"don't delete it."
        )
    if not saw_valid_mesh_block:
        raise SystemExit(
            f"!! mesh_block field came back entirely missing/null across all {n_so_far:,} rows -- "
            f"check the field name is still lowercase 'mesh_block' on the service.\n"
            f"{partial} was NOT renamed to the final output -- inspect it before retrying."
        )
    print("      checks passed (unfiltered -- block-membership check happens in Phase 2)")

    os.replace(partial, out(name))
    print(f"      -> {out(name)}  ({os.path.getsize(out(name))/1e6:.0f} MB)")


# ----------------------------------------------------------------- D2
def pull_d2():
    name = "acs_days_over_35.geojson"
    if have(name):
        print(f"[skip] {name}")
        return
    print("[3/7] ACS projected days >= 35 C …")
    r = get(D2, params={
        "where": "1=1", "outFields": "*", "returnGeometry": "true",
        "outSR": 4326, "resultRecordCount": 2000, "f": "geojson",
    })
    gj = r.json()
    n = len(gj.get("features", []))
    print(f"      {n} features" + ("" if n == EXPECTED_D2_COUNT
                                   else f"  !! expected {EXPECTED_D2_COUNT}"))
    with open(out(name), "w") as f:
        json.dump(gj, f)
    print(f"      -> {out(name)}")


# ----------------------------------------------------------------- plain files
def pull_files():
    for i, (name, url) in enumerate(FILES.items(), start=5):
        if have(name, 100_000):
            print(f"[skip] {name}")
            continue
        print(f"[{i}/6] {name} …")
        try:
            r = get(url, timeout=300)
            with open(out(name), "wb") as f:
                f.write(r.content)
            print(f"      -> {out(name)}  ({len(r.content)/1e6:.1f} MB)")
        except Exception as e:
            print(f"  !! failed: {e}")
            print(f"     download by hand instead:\n     {url}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--geometry", action="store_true",
                    help="also download mesh block polygons (large, slow)")
    a = ap.parse_args()

    os.makedirs(RAW, exist_ok=True)
    pull_d1_attributes()
    if a.geometry:
        pull_d1_geometry()
    else:
        print("[2/7] skipping polygons — rerun with --geometry when you need the map")
    pull_d2()
    pull_d5()
    pull_files()

    print("\nDone. Contents of", RAW)
    for f in sorted(os.listdir(RAW)):
        print(f"  {os.path.getsize(os.path.join(RAW, f))/1e6:8.1f} MB  {f}")


if __name__ == "__main__":
    main()