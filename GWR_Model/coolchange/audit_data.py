"""Audit current data and fitted outputs without changing source measurements."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from coolchange._config import DATA, MESH_BLOCK_CSV, POINTS_CSV, GWR_COEF_CSV
from coolchange.coordinates import join_training_points, validate_ids
from coolchange.cooling_reliability import POLICY, evaluate_scenario
from coolchange.tree_planting import ASSUMPTIONS, ASSUMPTIONS_PATH, block_parameters, simulate_trees
from coolchange.uncertainty import verify_input_hash


def read_json(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def assert_exported_scenario(row, scenario, expected, delta):
    """Check both formats, including null semantics and readable failure context."""
    context = f"{row.mb_code16}, canopy +{delta} pp"
    assert scenario["status"] == expected["status"] == getattr(row, f"status_plus{delta}"), context
    csv_reasons = getattr(row, f"reasons_plus{delta}")
    csv_reasons = csv_reasons.split("|") if isinstance(csv_reasons, str) else []
    assert scenario["reason_codes"] == expected["reason_codes"] == csv_reasons, context
    for key in ("predicted_uhi", "cooling_c", "canopy_pct", "applied_delta_pp", "requested_delta_pp"):
        assert (scenario[key] is None if expected[key] is None else
                scenario[key] is not None and np.isclose(scenario[key], expected[key], rtol=0, atol=1e-9)), context
    for key, column in (("predicted_uhi", "uhi"), ("cooling_c", "cooling"), ("canopy_pct", "canopy")):
        csv_value = getattr(row, f"{column}_plus{delta}")
        assert (pd.isna(csv_value) if scenario[key] is None else
                np.isclose(csv_value, scenario[key], rtol=0, atol=1e-9)), context


def load_history(directory, expected_ids):
    """Historical comparison is opt-in; explicitly requested bad inputs must fail."""
    if directory is None:
        return None
    old = pd.read_csv(directory / "mesh_block_points.csv", dtype={"mb_code16": str})
    validate_ids(old, "historical coordinates")
    if set(old.mb_code16) != set(expected_ids):
        raise ValueError("Historical coordinates do not cover the current block IDs")
    model = json.loads((directory / "gwr_model.json").read_text(encoding="utf-8"))
    # Out-of-bounds historical points are deliberately retained for comparison.
    bad = ~(old.lon.between(143, 147) & old.lat.between(-39.5, -36.5))
    return {"bad_ids": old.loc[bad, "mb_code16"], "gwr": model["gwr"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history-dir", type=Path,
                        help="Optional old mesh_block_points.csv and gwr_model.json directory")
    parser.add_argument("--output-dir", type=Path, default=DATA / "audit_runs/latest",
                        help="Write current audit results here; preserve recorded reports in data/")
    args = parser.parse_args()
    blocks = pd.read_csv(MESH_BLOCK_CSV, dtype={"mb_code16": str})
    history = load_history(args.history_dir, blocks.mb_code16)
    points = pd.read_csv(POINTS_CSV, dtype={"mb_code16": str})
    joined = join_training_points(blocks, points)
    projection = pd.read_csv(DATA / "mesh_block_projection.csv", dtype={"mb_code16": str})
    coefficients = pd.read_csv(GWR_COEF_CSV, dtype={"mb_code16": str})
    model = read_json("gwr_model.json")
    comparison = read_json("model_comparison.json")
    provenance = read_json("coordinate_provenance.json")
    input_verification = {}
    for name, record in (("model", model["inputs"]), ("comparison", comparison["inputs"]),
                         ("coordinates", provenance)):
        input_verification[name] = {
            "points": verify_input_hash(POINTS_CSV, record["points_sha256"]),
            "mesh_block": verify_input_hash(MESH_BLOCK_CSV, record["mesh_block_sha256"]),
        }
    assert coefficients.mb_code16.is_unique
    assert set(coefficients.mb_code16) == set(blocks.mb_code16)
    coefficients = coefficients.set_index("mb_code16").loc[blocks.mb_code16].reset_index()
    assert np.allclose(coefficients[["lon", "lat"]], joined[["lon", "lat"]], rtol=0, atol=1e-10)
    assert not np.isinf(coefficients.select_dtypes("number")).any().any()
    assert np.isfinite(coefficients[["slope", "intercept", "uhi_hat", "local_r2"]]).all().all()
    slope_columns = [f"diagnostic_slope_k{k}" for k in model["cooling_reliability"]["neighborhood_sizes"]]
    eligible = ((coefficients.slope < 0) & (coefficients.local_r2 >= POLICY["min_local_r2"])
                & (coefficients.effective_neighbors >= POLICY["min_effective_neighbors"])
                & (coefficients.weighted_canopy_sd_pp >= POLICY["min_weighted_canopy_sd_pp"])
                & np.isfinite(coefficients[slope_columns]).all(axis=1)
                & (coefficients[slope_columns] < 0).all(axis=1))
    assert np.array_equal(eligible, coefficients.cooling_status == "indicative")
    assert coefficients.loc[~eligible, "simulation_slope"].isna().all()
    assert np.allclose(coefficients.loc[eligible, "simulation_slope"], coefficients.loc[eligible, "slope"])
    assert np.allclose(coefficients.uhi_mean, blocks.uhi_mean, rtol=0, atol=1e-10)
    errors = {}
    for delta in (0, 5, 10, 15):
        canopy = np.maximum(blocks.canopy_pct, np.minimum(blocks.canopy_pct + delta, POLICY["canopy_ceiling_pct"]))
        expected = blocks.uhi_mean + coefficients.slope * (canopy - blocks.canopy_pct)
        error = float(np.max(np.abs(expected - coefficients[f"raw_uhi_plus{delta}"])))
        assert error < 1e-10
        assert np.allclose(canopy, coefficients[f"canopy_plus{delta}"], rtol=0, atol=1e-10)
        errors[str(delta)] = error
        available = coefficients[f"status_plus{delta}"].isin(["baseline", "no_change", "indicative"])
        assert coefficients.loc[~available, f"uhi_plus{delta}"].isna().all()
        assert coefficients.loc[~available, f"cooling_plus{delta}"].isna().all()
        assert np.allclose(coefficients.loc[available, f"uhi_plus{delta}"], expected[available], atol=1e-10, rtol=0)
        assert (coefficients.loc[available, f"cooling_plus{delta}"] >= 0).all()
    assert np.allclose(coefficients.uhi_plus0, blocks.uhi_mean, rtol=0, atol=1e-10)
    public = read_json("simulator_scenarios.json")
    assert public["schema_version"] == model["output_schema_version"] == 3
    assert public["planting_assumptions"] == ASSUMPTIONS
    assert np.allclose(coefficients.area_sqkm, blocks.area_sqkm, rtol=0, atol=1e-12)
    for name, record in (("public", public), ("model", model)):
        input_verification.setdefault(name, {})["planting_assumptions"] = verify_input_hash(
            ASSUMPTIONS_PATH, record["inputs"]["planting_assumptions_sha256"])
    assert public["policy"] == POLICY
    input_verification["public"]["points"] = verify_input_hash(POINTS_CSV, public["inputs"]["points_sha256"])
    input_verification["public"]["mesh_block"] = verify_input_hash(MESH_BLOCK_CSV, public["inputs"]["mesh_block_sha256"])
    assert len(public["blocks"]) == len(blocks)
    for row, item in zip(coefficients.itertuples(index=False), public["blocks"]):
        assert item["mb_code16"] == row.mb_code16
        expected_parameters = block_parameters(row)
        assert np.isclose(item["tree_planting"]["area_m2"], row.area_sqkm * 1_000_000, rtol=0, atol=1e-6)
        assert item["tree_planting"]["default_limits_by_profile"] == expected_parameters["default_limits_by_profile"]
        assert item["tree_planting"]["site_capacity_trees"] is None
        for profile, limit in item["tree_planting"]["default_limits_by_profile"].items():
            count = limit["max_trees_with_estimate"]
            for n in ((0, 1) if count is None else (0, count, count + 1)):
                result = simulate_trees(item, n, profile)
                if n == 0:
                    assert result["status"] == "baseline" and result["cooling_c"] == 0
                elif count is None or n > count:
                    assert result["status"] == "unavailable" and result["cooling_c"] is None
                else:
                    assert result["status"] == "indicative"
                    expected_delta = n * ASSUMPTIONS["profiles"][profile]["mature_canopy_area_m2"] / (row.area_sqkm * 1_000_000) * 100
                    assert np.isclose(result["cooling_c"], -row.slope * expected_delta, rtol=0, atol=1e-8)
        reasons = row.cooling_reason_codes.split("|") if isinstance(row.cooling_reason_codes, str) else []
        assert item["status"] == row.cooling_status and item["reason_codes"] == reasons
        assert len(item["scenarios"]) == 4
        for delta, scenario in zip((0, 5, 10, 15), item["scenarios"]):
            expected = evaluate_scenario(row.uhi_mean, row.canopy_pct, row.slope, reasons,
                                        row.local_canopy_min, row.local_canopy_max, delta)
            assert_exported_scenario(row, scenario, expected, delta)
    assert not projection.duplicated(["mb_code16", "warming_level"]).any()
    assert set(projection.mb_code16) <= set(blocks.mb_code16)
    assert set(projection.warming_level) == {1.2, 1.5, 2.0, 3.0}
    missing_by_level = {}
    flags = blocks[["mb_code16", "lga_name", "sa2_name", "mb_category"]].copy()
    for level, rows in projection.groupby("warming_level"):
        missing = set(blocks.mb_code16) - set(rows.mb_code16)
        missing_by_level[str(level)] = len(missing)
        flags[f"missing_projection_{level}"] = blocks.mb_code16.isin(missing)
    flags["missing_seifa"] = blocks.irsd_score.isna() | blocks.irsd_decile.isna()
    flags["positive_gwr_slope"] = coefficients.slope > 0
    flags["cooling_estimate_screened_out"] = coefficients.cooling_status == "unavailable"
    if history is not None:
        flags["old_coordinate_outside_bounds"] = blocks.mb_code16.isin(history["bad_ids"])
    flags["source_geometry_repaired"] = blocks.mb_code16.isin([x["mb_code16"] for x in provenance["geometry_repairs"]])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    flags.loc[flags.iloc[:, 4:].any(axis=1)].to_csv(args.output_dir / "data_quality_flags.csv", index=False)
    numeric = blocks.select_dtypes("number")
    percent_columns = [c for c in blocks if c.endswith("_pct")]
    prediction = coefficients.uhi_hat.to_numpy()
    y = blocks.uhi_mean.to_numpy()
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "n_blocks": len(blocks),
        "input_file_verification": input_verification,
        "coordinate_changes": provenance.get("changes"),
        "historical_comparison": {
            "status": "checked" if history is not None else "not_requested",
            "source": str(args.history_dir) if history is not None else None,
            "note": "coordinate_changes are recorded provenance, not a rerun of the historical comparison",
        },
        "source_geometry_repairs": provenance["geometry_repairs"],
        "source_measurement_max_difference": provenance["model_field_max_abs_difference_from_source"],
        "coordinate_nulls": int(points[["lon", "lat"]].isna().sum().sum()),
        "duplicate_coordinate_rows": int(points.duplicated(["lon", "lat"], keep=False).sum()),
        "coordinate_range": points[["lon", "lat"]].agg(["min", "max"]).to_dict(),
        "numeric_infinite_cells": int(np.isinf(numeric.to_numpy()).sum()),
        "invalid_area_rows": int((blocks.area_sqkm <= 0).sum()),
        "invalid_percentage_rows": {c: int((~blocks[c].between(0, 100)).sum()) for c in percent_columns},
        "missing_values": blocks.isna().sum()[lambda x: x > 0].astype(int).to_dict(),
        "missing_seifa_categories": blocks.loc[flags.missing_seifa, "mb_category"].value_counts().to_dict(),
        "missing_seifa_residents": int(blocks.loc[flags.missing_seifa, "persons"].sum()),
        "projection_rows": len(projection),
        "projection_missing_by_level": missing_by_level,
        "projection_open_upper_labels": projection.loc[projection.days_upper.isna(), "days_label"].value_counts().to_dict(),
        "projection_note": "Missing projection rows require source/join audit; not inferred from GWR coordinates. Empty upper bound for 15+ is intentional, not zero.",
        "zero_resident_blocks": int((blocks.persons == 0).sum()),
        "vegetation_rounding_max_residual": float((blocks.any_veg_pct - blocks[["canopy_pct", "grass_pct", "shrub_pct"]].sum(axis=1)).abs().max()),
        "old_gwr": history["gwr"] if history is not None else None,
        "new_gwr": model["gwr"],
        "new_metrics_recomputed": {
            "r2": float(1 - np.sum((y-prediction)**2)/np.sum((y-y.mean())**2)),
            "rmse": float(np.sqrt(np.mean((y-prediction)**2))),
        },
        "positive_slope_blocks": int(flags.positive_gwr_slope.sum()),
        "cooling_screening": model["cooling_reliability"],
        "scenario_formula_max_error": errors,
        "comparison": [
            {"split": s["split"], "gwr": next(m for m in s["models"] if m["id"] == "gwr_k400")}
            for s in comparison["splits"]
        ],
        "planting_audit": {"blocks_checked": len(blocks), "profiles_per_block": 3,
                           "checks": "Zero, maximum supported integer count, and one over maximum; unavailable blocks tested at zero and one tree",
                           "site_capacity_unknown_blocks": len(blocks), "assumptions_version": ASSUMPTIONS["version"]},
        "current_assumptions": {"percentage_bound_pct": POLICY["canopy_ceiling_pct"], "gwr_k": 400,
                                  "uncertainty_intervals_implemented": False,
                                  "positive_slope_fallback_exported": False},
    }
    (args.output_dir / "data_quality_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
