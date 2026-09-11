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

from _common import load_d1, load_d5, SEEDS, EXPECTED_BLOCKS, Checks

# VicMap's own field lengths (FeatureServer/0 schema).
MAX_ROAD_NAME_LEN = 45
MAX_ROAD_TYPE_LEN = 15
MAX_LOCALITY_LEN = 46

# Pinned from profiling the full 4,223,173-row statewide fetch (see
# e1-street-search-log). Re-derive these if D5 or D1 is ever re-downloaded --
# don't just bump the numbers to whatever the next run happens to produce.
EXPECTED_MATCHED_ROWS = 2_355_864       # rows whose mesh_block is one of ours
EXPECTED_BLOCKS_WITH_STREETS = 45_866   # distinct blocks that appear at least once


def build():
    print("Loading sources ...")
    d1, d5 = load_d1(), load_d5()
    print(f"  D1 mesh blocks (study area) : {len(d1):,} rows")
    print(f"  D5 address points (statewide): {len(d5):,} rows")

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
    c.expect("rows after filtering to our study-area blocks", len(df), EXPECTED_MATCHED_ROWS, tol=EXPECTED_MATCHED_ROWS * 0.05)
    c.expect("distinct blocks with >=1 street", grouped.mesh_block.nunique(), EXPECTED_BLOCKS_WITH_STREETS, tol=1000)
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
        print(f"\n  {missing:,} of our {EXPECTED_BLOCKS:,} study-area blocks have zero streets -- "
              f"expected (2016 mesh block vintage vs current addresses in growth corridors "
              f"like Cranbourne East, Doreen, Tarneit). AC 1.3.3 covers this at the API level.")

    return streets, smb


if __name__ == "__main__":
    build()
    print("\nDone.")
