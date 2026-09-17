"""Read offline outputs and calculate a whole-tree scenario, without model fitting."""
import argparse
import json
from pathlib import Path

from coolchange._config import DATA, MESH_BLOCK_CSV, POINTS_CSV
from coolchange.coordinates import sha256_file
from coolchange.tree_planting import ASSUMPTIONS_PATH, simulate_trees
from coolchange.uncertainty import verify_input_hash


def load_export(path=None):
    payload = json.loads((path or DATA / "simulator_scenarios.json").read_text(encoding="utf-8"))
    if payload.get("schema_version") != 3:
        raise ValueError("Re-run python -m coolchange.train_gwr to produce schema v3 planting inputs")
    for key, path in (("mesh_block_sha256", MESH_BLOCK_CSV), ("points_sha256", POINTS_CSV),
                      ("planting_assumptions_sha256", ASSUMPTIONS_PATH)):
        verify_input_hash(path, payload["inputs"].get(key))
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, help="Optional separate uncertainty export")
    parser.add_argument("--block", required=True)
    parser.add_argument("--trees", required=True, type=int)
    parser.add_argument("--profile", choices=["A", "B", "C"], default="B")
    parser.add_argument("--net-canopy-fraction", type=float, default=1.)
    parser.add_argument("--site-capacity", type=int)
    parser.add_argument("--site-capacity-source")
    args = parser.parse_args()
    payload = load_export(args.export)
    block = next((b for b in payload["blocks"] if b["mb_code16"] == args.block), None)
    if block is None:
        parser.error("Block not found in exported model")
    try:
        result = simulate_trees(block, args.trees, args.profile, args.net_canopy_fraction,
                                args.site_capacity, args.site_capacity_source)
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
