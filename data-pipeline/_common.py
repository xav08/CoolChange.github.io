"""Shared paths and loaders for the Cool Change data pipeline."""
import os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# Raw data lives OUTSIDE the repo (about 140 MB). Override with COOLCHANGE_RAW.
RAW = os.environ.get(
    "COOLCHANGE_RAW",
    os.path.join(os.path.dirname(REPO), "Iteration 1", "data", "raw"),
)
SEEDS = os.path.join(REPO, "backend", "src", "db", "seeds")
CACHE = os.path.join(HERE, ".cache")

D1 = "meshblocks_attributes.csv"
D2 = "acs_days_over_35.geojson"
D3 = "2016_census_mesh_block_counts.csv"
D4 = "seifa_2016_sa1_indexes.xls"
D5 = "vicmap_address.csv"
GEOM = "meshblocks.geojson"

EXPECTED_BLOCKS = 54239


def raw(name):
    p = os.path.join(RAW, name)
    if not os.path.exists(p):
        raise SystemExit(
            f"Missing raw file: {p}\n"
            f"Run download_data.py first, or set COOLCHANGE_RAW to the folder holding it."
        )
    return p


def load_d1():
    """Heat + vegetation, one row per mesh block."""
    return pd.read_csv(raw(D1), dtype={
        "MB_CODE16": str, "SA1_MAIN16": str, "SA2_MAIN16": str, "SA3_CODE16": str})


def load_d3():
    """ABS census mesh block counts.

    Two traps in this file:
      * latin-1, not utf-8 - it contains a copyright byte.
      * The last few rows are ABS footer text ("Cells in this table have been
        randomly adjusted...", "(c) Commonwealth of Australia 2017") and blank
        lines, which parse as rows with a null MB code. Left in, they look like
        duplicate keys and break a 1:1 merge. We drop anything that is not an
        11-digit code.

    NOTE for the limitations panel: that footer says small Dwelling and Person
    counts are randomly adjusted by the ABS to protect confidentiality. Block
    level population counts are therefore approximate by design.
    """
    d3 = pd.read_csv(raw(D3), dtype={"MB_CODE_2016": str}, encoding="latin-1")
    before = len(d3)
    d3 = d3[d3.MB_CODE_2016.notna() & d3.MB_CODE_2016.str.fullmatch(r"\d{11}")].copy()
    dropped = before - len(d3)
    if dropped:
        print(f"  D3: dropped {dropped} footer/blank row(s)")
    if not d3.MB_CODE_2016.is_unique:
        raise SystemExit("D3 still has duplicate mesh block codes after cleaning.")
    return d3


def load_d4():
    """SEIFA 2016 SA1 indexes. Parsing the 54 MB .xls is slow, so cache it."""
    os.makedirs(CACHE, exist_ok=True)
    cached = os.path.join(CACHE, "seifa_sa1.csv")
    if os.path.exists(cached):
        return pd.read_csv(cached, dtype={"SA1_11": str})

    cols = ["SA1_7", "SA1_11", "IRSD", "IRSD_dec", "IRSAD", "IRSAD_dec",
            "IER", "IER_dec", "IEO", "IEO_dec", "URP"]
    s = pd.read_excel(raw(D4), sheet_name="Table 1", header=None, skiprows=6, names=cols)
    s = s[pd.to_numeric(s.SA1_11, errors="coerce").notna()].copy()
    s["SA1_11"] = s.SA1_11.astype("int64").astype(str)
    # '-' marks a value the ABS suppressed; make it a real NaN.
    for c in cols[2:]:
        s[c] = pd.to_numeric(s[c], errors="coerce")
    s = s[["SA1_11", "IRSD", "IRSD_dec"]]
    s.to_csv(cached, index=False)
    return s


def load_d5():
    """VicMap Address, one row per street address point (statewide, unfiltered).

    mesh_block is written as a clean zero-padded string by download_data.py,
    but read it back with an explicit dtype anyway -- CSV carries no type
    information, so pandas would otherwise infer float64 again purely from
    what the column looks like, same trap as MB_CODE16 in D1.
    """
    return pd.read_csv(raw(D5), dtype={"mesh_block": str})


class Checks:
    """Collects pass/fail gates so the script can refuse to write bad seeds."""

    def __init__(self):
        self.failed = []

    def expect(self, label, actual, expected, tol=0):
        ok = abs(actual - expected) <= tol if isinstance(expected, (int, float)) \
            else actual == expected
        print(f"  [{'ok ' if ok else 'FAIL'}] {label}: {actual} (expected {expected})")
        if not ok:
            self.failed.append(label)
        return ok

    def expect_true(self, label, ok):
        print(f"  [{'ok ' if ok else 'FAIL'}] {label}")
        if not ok:
            self.failed.append(label)
        return ok

    def finish(self):
        if self.failed:
            raise SystemExit(
                f"\n{len(self.failed)} validation gate(s) failed: {self.failed}\n"
                f"No seed files were written. Fix the input data before continuing."
            )
        print("  all gates passed")