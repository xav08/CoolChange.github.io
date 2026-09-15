#!/usr/bin/env python3
"""
Cool Change - E1 (street-level search, US1.3)
Filters D5 (VicMap Address) down to our study area, collapses address points
to street grain, and writes the seed CSVs the database loads.

    python3 data-pipeline/05_build_street_mesh_block.py

Writes to backend/src/db/seeds/:
    street.csv              distinct (road_name, road_type, locality_name)
    street_mesh_block.csv   which mesh block(s) each street touches, plus a
                             count of addresses (a confidence signal for the
                             frontend's disambiguation UI)

Every validation gate must pass or nothing is written.
"""
import os
import pandas as pd

from _common import load_d1, load_d5_reconciled, SEEDS, EXPECTED_BLOCKS, Checks

# VicMap's own field lengths (FeatureServer/0 schema).
MAX_ROAD_NAME_LEN = 45
MAX_ROAD_TYPE_LEN = 15
MAX_LOCALITY_LEN = 46

# Pinned from the spatially-corrected run (07_reconcile_mesh_block.py's
# output, not VicMap's own attribute) -- see e1-street-search-log's
# vintage-mismatch finding. Re-derive if D5, D1, or mesh_block_geometry
# changes -- don't just bump these to whatever the next run produces.
EXPECTED_MATCHED_ROWS = 2_708_962       # +353,098 vs the old attribute method
EXPECTED_BLOCKS_WITH_STREETS = 52_071   # +6,205 blocks recovered vs the old method


def build():
    print("Loading sources ...")
    d1, d5 = load_d1(), load_d5_reconciled()
    print(f"  D1 mesh blocks (study area)      : {len(d1):,} rows")
    print(f"  D5 address points (statewide, spatially-corrected): {len(d5):,} rows")

    valid_codes = set(d1.MB_CODE16)

    print("\nFiltering + cleaning ...")
    df = d5[d5.mesh_block.isin(valid_codes)].copy()
    print(f"  kept {len(df):,} rows with mesh_block in our {len(valid_codes):,} study-area blocks "
          f"({len(d5) - len(df):,} dropped: statewide-but-outside-area, or null mesh_block)")

    df["road_name"] = df.road_name.str.strip()
    df["locality_name"] = df.locality_name.str.strip()
    # Null road_type is legitimate (e.g. "Broadway", "The Boulevard" -- the
    # type is baked into the name or genuinely absent), but Postgres treats
    # every NULL in a UNIQUE constraint as distinct from every other NULL,
    # which would let duplicate streets through ON CONFLICT on a rerun.
    # Normalise to '' so the constraint actually catches duplicates.
    df["road_type"] = df.road_type.fillna("").str.strip()

    print("\nCollapsing to street grain ...")
    grouped = (df.groupby(["road_name", "road_type", "locality_name", "mesh_block"], as_index=False)
                 .size()
                 .rename(columns={"size": "n_addresses"}))
    print(f"  {len(grouped):,} distinct (street, block) combinations")

    streets = grouped[["road_name", "road_type", "locality_name"]].drop_duplicates().reset_index(drop=True)
    streets.insert(0, "street_id", streets.index + 1)
    print(f"  {len(streets):,} distinct streets")

    smb = grouped.merge(streets, on=["road_name", "road_type", "locality_name"], how="left", validate="m:1")
    smb = smb[["street_id", "mesh_block", "n_addresses"]].rename(columns={"mesh_block": "mb_code16"})

    # ---------------------------------------------------------------- gates
    print("\nValidation gates:")
    c = Checks()
    c.expect_true("no nulls in road_name / locality_name after cleaning",
                  not df[["road_name", "locality_name"]].isna().any().any())
    if EXPECTED_MATCHED_ROWS is None:
        print(f"  [no pinned expectation yet] rows after filtering to our study-area "
              f"blocks: {len(df):,} -- pin this as EXPECTED_MATCHED_ROWS once confirmed correct")
    else:
        c.expect("rows after filtering to our study-area blocks", len(df), EXPECTED_MATCHED_ROWS)
    if EXPECTED_BLOCKS_WITH_STREETS is None:
        print(f"  [no pinned expectation yet] distinct blocks with >=1 street: "
              f"{grouped.mesh_block.nunique():,} -- pin this as EXPECTED_BLOCKS_WITH_STREETS once confirmed correct")
    else:
        c.expect("distinct blocks with >=1 street", grouped.mesh_block.nunique(), EXPECTED_BLOCKS_WITH_STREETS)
    c.expect_true("street.csv unique on (road_name, road_type, locality_name)",
                  not streets.duplicated(["road_name", "road_type", "locality_name"]).any())
    c.expect_true("street_mesh_block.csv unique on (street_id, mb_code16)",
                  not smb.duplicated(["street_id", "mb_code16"]).any())
    c.expect_true("n_addresses strictly positive", bool((smb.n_addresses > 0).all()))
    c.expect_true("every mb_code16 in street_mesh_block is one of our study-area blocks",
                  bool(smb.mb_code16.isin(valid_codes).all()))
    c.expect_true(f"road_name fits varchar({MAX_ROAD_NAME_LEN})",
                  bool((streets.road_name.str.len() <= MAX_ROAD_NAME_LEN).all()))
    c.expect_true(f"road_type fits varchar({MAX_ROAD_TYPE_LEN})",
                  bool((streets.road_type.str.len() <= MAX_ROAD_TYPE_LEN).all()))
    c.expect_true(f"locality_name fits varchar({MAX_LOCALITY_LEN})",
                  bool((streets.locality_name.str.len() <= MAX_LOCALITY_LEN).all()))
    c.finish()

    os.makedirs(SEEDS, exist_ok=True)
    p1 = os.path.join(SEEDS, "street.csv")
    streets.to_csv(p1, index=False)
    print(f"\n  -> {p1}  ({os.path.getsize(p1)/1e6:.1f} MB)")

    p2 = os.path.join(SEEDS, "street_mesh_block.csv")
    smb.to_csv(p2, index=False)
    print(f"  -> {p2}  ({os.path.getsize(p2)/1e6:.1f} MB)")

    # This is a documented, expected finding (2016-vintage mesh block splits
    # in outer growth corridors -- see e1-street-search-log), not a bug.
    # AC 1.3.3's "no results" handling covers a resident in one of these
    # blocks correctly at the API level.
    missing = EXPECTED_BLOCKS - grouped.mesh_block.nunique()
    if missing:
        print(f"\n  {missing:,} of our {EXPECTED_BLOCKS:,} study-area blocks have zero streets. "
              f"The vintage-mismatch gap this used to describe (8,373 blocks, growth corridors "
              f"like Cranbourne East/Doreen/Tarneit) was fixed by the spatial-join reconciliation "
              f"in 07_reconcile_mesh_block.py -- this smaller remainder likely reflects genuinely "
              f"addressless land (parks, industrial, reserves), but that hasn't been directly "
              f"confirmed against this corrected data yet. AC 1.3.3 covers this at the API level "
              f"either way.")

    return streets, smb


if __name__ == "__main__":
    build()
    print("\nDone.")