#!/usr/bin/env python3
"""Prepare a local training table.

Default: copy CoolChange seed CSVs (same rows the API serves).
GWR also needs one point per block. Those are not in the API list, so this
script validates a provenance-backed point cache or
downloads full-precision polygons from the same ArcGIS layer CoolChange uses.

  python -m coolchange.fetch_data
  python -m coolchange.fetch_data --from-api          # list + bootstrap only
  python -m coolchange.fetch_data --api-sample 50     # demo: 50 full block payloads
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from datetime import datetime, timezone

import numpy as np
from pyproj import Geod

from coolchange.coordinates import polygon_centroid, sha256_file, validate_points
from coolchange.uncertainty import verify_input_hash

import pandas as pd
import requests

from coolchange._config import (
    API,
    DATA,
    MESH_BLOCK_CSV,
    POINTS_CSV,
    PROJECTION_CSV,
    SEEDS,
)

D1_QUERY = (
    "https://plan-gis.mapshare.vic.gov.au/arcgis/rest/services/"
    "CoolingGreening/CoolingGreening/MapServer/55/query"
)
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    )
}


def copy_seeds() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    needed = ["mesh_block.csv", "mesh_block_projection.csv", "model_coefficient.csv"]
    missing = [name for name in needed if not (SEEDS / name).exists()]
    if missing:
        sys.exit(
            f"Seed files not found in {SEEDS}: {missing}\n"
            "Set COOLCHANGE_SEEDS in .env, or start from CoolChange's "
            "backend/src/db/seeds folder."
        )
    for name in needed:
        dest = DATA / name
        shutil.copy2(SEEDS / name, dest)
        size_mb = dest.stat().st_size / 1e6
        print(f"  copied {name}  ({size_mb:.1f} MB)")


def copy_or_build_points(force: bool = False) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    provenance = DATA / "coordinate_provenance.json"
    if not force and POINTS_CSV.exists() and provenance.exists():
        manifest = json.loads(provenance.read_text(encoding="utf-8"))
        try:
            # Git can convert CSV line endings without changing measurements.
            # Reuse only when exact or newline-only hashes prove the same inputs.
            verify_input_hash(POINTS_CSV, manifest.get("points_sha256"))
            verify_input_hash(MESH_BLOCK_CSV, manifest.get("mesh_block_sha256"))
        except ValueError:
            pass
        else:
            points = pd.read_csv(POINTS_CSV, dtype={"mb_code16": str})
            expected = pd.read_csv(MESH_BLOCK_CSV, dtype={"mb_code16": str})
            validate_points(points, expected.mb_code16)
            print(f"  verified coordinates already present: {len(points):,}")
            return
    # Old point caches lack geometry provenance and may contain unstable centroids.
    # Rebuild every point, not only coordinates outside the bounding box.
    pull_points_from_arcgis()


def request_json(params: dict) -> dict:
    for attempt in range(4):
        try:
            response = requests.get(D1_QUERY, params=params, headers=UA, timeout=30)
            response.raise_for_status()
            payload = response.json()
            if "error" in payload:
                raise ValueError(f"ArcGIS error: {payload['error']}")
            return payload
        except (requests.RequestException, ValueError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("Unreachable")


def pull_points_from_arcgis() -> None:
    """Download complete GeoJSON without coordinate rounding, with resumable pages."""
    cache = DATA / "coordinate_source"
    cache.mkdir(parents=True, exist_ok=True)
    params = {
        "where": "1=1", "outFields": "MB_CODE16,UHI18_M,PERANYTREE,OBJECTID",
        "returnGeometry": "true", "outSR": 4326,
        "orderByFields": "OBJECTID", "resultRecordCount": 1000, "f": "geojson",
    }
    # A frozen object-ID list makes incomplete, duplicate or changed pagination fail.
    ids_path = cache / "object_ids.json"
    if not ids_path.exists():
        payload = request_json({"where": "1=1", "returnIdsOnly": "true", "f": "json"})
        ids_path.write_text(json.dumps(payload), encoding="utf-8")
    source_ids = json.loads(ids_path.read_text(encoding="utf-8"))["objectIds"]
    if not source_ids or len(source_ids) != len(set(source_ids)):
        raise ValueError("Invalid source object-ID list")
    rows, source_values, seen_ids, page_hashes, repairs = [], [], [], [], []
    offset = 0
    while offset < len(source_ids):
        page_path = cache / f"page_{offset:06d}.json"
        if page_path.exists():
            payload = json.loads(page_path.read_text(encoding="utf-8"))
        else:
            payload = request_json({**params, "resultOffset": offset})
            if not payload.get("features"):
                raise ValueError(f"Empty page at offset {offset}; source incomplete")
            temp = page_path.with_suffix(".tmp")
            temp.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
            temp.replace(page_path)
        features = payload.get("features") or []
        if not features:
            raise ValueError(f"Empty cached page at {offset}")
        for feature in features:
            props = feature["properties"]
            code = str(props["MB_CODE16"]).strip()
            feature_repairs = []
            try:
                lon, lat = polygon_centroid(feature["geometry"], repairs=feature_repairs)
            except ValueError as exc:
                raise ValueError(f"Invalid geometry for {code}: {exc}") from exc
            repairs.extend({"mb_code16": code, **entry} for entry in feature_repairs)
            rows.append((code, lon, lat))
            source_values.append((code, props["UHI18_M"], props["PERANYTREE"]))
            seen_ids.append(props["OBJECTID"])
        page_hashes.append({"file": page_path.name, "sha256": sha256_file(page_path)})
        offset += len(features)
        print(f"  geometry processed: {offset:,} / {len(source_ids):,}", flush=True)
    if len(seen_ids) != len(set(seen_ids)) or set(seen_ids) != set(source_ids):
        raise ValueError("Source pagination has duplicate or missing object IDs")
    df = pd.DataFrame(rows, columns=["mb_code16", "lon", "lat"])
    blocks = pd.read_csv(MESH_BLOCK_CSV, dtype={"mb_code16": str})
    validate_points(df, blocks.mb_code16)
    source = pd.DataFrame(source_values, columns=["mb_code16", "uhi_mean", "canopy_pct"])
    paired = blocks.merge(source, on="mb_code16", suffixes=("_local", "_source"), validate="one_to_one")
    errors = {}
    for field in ("uhi_mean", "canopy_pct"):
        difference = (paired[f"{field}_local"] - paired[f"{field}_source"]).abs()
        errors[field] = float(difference.max())
        if not np.isfinite(difference).all() or not np.allclose(
            # The existing seed table rounds these fields to four decimals.
            paired[f"{field}_local"], paired[f"{field}_source"], atol=5.1e-5, rtol=0
        ):
            raise ValueError(f"Source {field} differs from local training data: {errors[field]}")
    # Preserve source/training-table order for deterministic neighbour lookup.
    df = df.set_index("mb_code16").loc[blocks.mb_code16].reset_index()
    manifest = {
        "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": D1_QUERY, "query": params, "n_blocks": len(df),
        "method": "Full GeoJSON -> EPSG:3111 -> area-weighted centroid of all parts and holes -> EPSG:4326",
        "coordinate_role": "GWR distance anchor; centroid need not lie inside polygon",
        "model_field_max_abs_difference_from_source": errors,
        "model_field_comparison_tolerance": "0.000051 absolute, accounting for four-decimal seed rounding",
        "geometry_repairs": repairs,
        "geometry_repair_tolerance": {"max_relative_area_change": 1e-6, "max_centroid_shift_m": .01},
        "source_pages": page_hashes, "object_ids_sha256": sha256_file(ids_path),
        "mesh_block_sha256": sha256_file(MESH_BLOCK_CSV),
    }
    if POINTS_CSV.exists():
        old = pd.read_csv(POINTS_CSV, dtype={"mb_code16": str})
        changes = old.merge(df, on="mb_code16", suffixes=("_old", "_new"), validate="one_to_one")
        old_ok = changes.lon_old.between(143, 147) & changes.lat_old.between(-39.5, -36.5)
        changes["old_outside_bounds"] = ~old_ok
        changes["shift_metres"] = np.nan
        geod = Geod(ellps="WGS84")
        valid = changes.loc[old_ok]
        _, _, shifts = geod.inv(valid.lon_old.to_numpy(), valid.lat_old.to_numpy(), valid.lon_new.to_numpy(), valid.lat_new.to_numpy())
        changes.loc[old_ok, "shift_metres"] = shifts
        changes.to_csv(DATA / "coordinate_changes.csv", index=False)
        manifest["changes"] = {
            "old_outside_bounds": int((~old_ok).sum()),
            "valid_old_shift_over_10m": int((shifts > 10).sum()),
            "valid_old_shift_over_100m": int((shifts > 100).sum()),
            "valid_old_shift_over_1000m": int((shifts > 1000).sum()),
            "valid_old_median_shift_m": float(np.median(shifts)),
            "valid_old_max_shift_m": float(np.max(shifts)),
        }
    temp = POINTS_CSV.with_suffix(".tmp")
    df.to_csv(temp, index=False, float_format="%.10f")
    temp.replace(POINTS_CSV)
    manifest["points_sha256"] = sha256_file(POINTS_CSV)
    (DATA / "coordinate_provenance.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"  wrote {POINTS_CSV} ({len(df):,} validated rows)")


def fetch_api_list() -> pd.DataFrame:
    url = f"{API}/api/v1/meshblocks"
    print(f"GET {url}")
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    payload = r.json()
    if isinstance(payload, dict) and "fields" in payload and "rows" in payload:
        df = pd.DataFrame(payload["rows"], columns=payload["fields"])
    elif isinstance(payload, list):
        df = pd.DataFrame(payload)
    else:
        df = pd.DataFrame(payload.get("data", payload.get("rows", [])))
    print(f"  {len(df):,} rows, columns={list(df.columns)}")
    print("  note: this list is not enough for multivariate OLS "
          "(no persons / grass / area).")
    DATA.mkdir(parents=True, exist_ok=True)
    df.to_csv(DATA / "api_meshblocks_list.csv", index=False)
    return df


def fetch_bootstrap() -> dict:
    url = f"{API}/api/v1/bootstrap"
    print(f"GET {url}")
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    payload = r.json()
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "api_bootstrap.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    model = payload.get("model", payload)
    print(f"  live model: {model}")
    return payload


def fetch_api_sample(n: int, list_df: pd.DataFrame | None) -> None:
    if list_df is None or "mb_code16" not in list_df.columns:
        list_df = fetch_api_list()
    codes = list_df["mb_code16"].astype(str).sample(n=min(n, len(list_df)), random_state=42)
    rows = []
    for code in codes:
        url = f"{API}/api/v1/meshblocks/{code}"
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        body = r.json()
        block = body.get("block", body)
        rows.append(block)
        print(f"  {code}")
    out = DATA / "api_meshblocks_sample.csv"
    pd.DataFrame(rows).to_csv(out, index=False)
    print(f"  wrote {out} ({len(rows)} rows) — sample only, not a training set")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare training data without changing CoolChange.")
    parser.add_argument(
        "--from-api",
        action="store_true",
        help="Pull the meshblock list + bootstrap from the running API.",
    )
    parser.add_argument(
        "--api-sample",
        type=int,
        default=0,
        metavar="N",
        help="Also fetch N full block payloads (demo only, do not use for full training).",
    )
    parser.add_argument(
        "--skip-points",
        action="store_true",
        help="Do not copy or download coordinates (OLS only).",
    )
    parser.add_argument("--rebuild-points", action="store_true", help="Rebuild all points from full source geometry.")
    parser.add_argument("--points-only", action="store_true", help="Use existing local training CSVs without copying seeds.")
    args = parser.parse_args()

    print(f"seeds: {SEEDS}")
    print(f"api:   {API}")
    print(f"out:   {DATA}\n")

    if not args.points_only:
        copy_seeds()
    print(f"\ntraining table ready: {MESH_BLOCK_CSV}")
    if PROJECTION_CSV.exists():
        print(f"projection table:     {PROJECTION_CSV}")

    if not args.skip_points:
        print("\nGWR coordinates:")
        copy_or_build_points(force=args.rebuild_points)

    if args.from_api or args.api_sample:
        try:
            fetch_bootstrap()
            list_df = fetch_api_list()
            if args.api_sample:
                fetch_api_sample(args.api_sample, list_df)
        except requests.RequestException as exc:
            sys.exit(
                f"API request failed: {exc}\n"
                "Start CoolChange with `cd backend && npm run dev`, "
                "or omit --from-api and train from the copied CSVs."
            )

    print("\nDone. Next: python -m coolchange.train_ols  or  python -m coolchange.train_gwr")


if __name__ == "__main__":
    main()
