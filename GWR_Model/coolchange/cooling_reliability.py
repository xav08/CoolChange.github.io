"""Provisional display screening, NOT confidence intervals or causal validation."""
import json
from collections import Counter

import numpy as np
from sklearn.neighbors import NearestNeighbors

POLICY = {
    "version": "cooling-screen-v2",
    "min_local_r2": 0.10,
    "min_effective_neighbors": 30.0,
    "min_weighted_canopy_sd_pp": 1.0,
    "bandwidth_multipliers": [0.5, 1.0, 2.0],
    "canopy_ceiling_pct": 100.0,
    "ceiling_meaning": "Mathematical percentage bound only; site planting capacity is unknown.",
    "validated_uncertainty_interval": False,
    "interpretation": "Provisional engineering display rules; passing is an indicative association, not validated reliability or causal cooling.",
}
MESSAGES = {
    "invalid_local_fit": "Local data do not support a numerical estimate.",
    "nonnegative_slope": "Local data do not show a negative canopy–heat association. This does not mean planting causes warming.",
    "weak_local_fit": "Canopy explains too little of the variation in nearby heat measurements to display this estimate.",
    "unstable_direction": "The estimated direction changes or cannot be estimated when the neighborhood size changes.",
    "insufficient_local_support": "There are too few effectively weighted observations or too little canopy variation.",
    "outside_local_canopy_range": "The requested canopy is outside the range observed in the fitted neighborhood.",
    "exceeds_percentage_bound": "The whole-tree request would exceed 100% canopy; reduce the tree count.",
    "exceeds_supplied_site_capacity": "The request exceeds the separately supplied site capacity.",
}


def local_diagnostics(x, w):
    """Kish effective n is a descriptive weight concentration, not residual df."""
    x, w = np.asarray(x, float), np.asarray(w, float)
    if not np.isfinite(x).all() or not np.isfinite(w).all() or (w < 0).any() or w.sum() <= 0:
        return (np.nan,) * 4
    active = w > 0
    mean = np.average(x, weights=w)
    sd = np.sqrt(np.average((x - mean) ** 2, weights=w))
    return float(w.sum()**2 / (w @ w)), float(sd), float(x[active].min()), float(x[active].max())


def classify_block(slope, local_r2, slopes, n_effective, canopy_sd):
    """Return all applicable reasons, so callers can explain every exclusion."""
    reasons = []
    if not np.isfinite([slope, local_r2, n_effective, canopy_sd]).all():
        reasons.append("invalid_local_fit")
    if np.isfinite(slope) and slope >= 0:
        reasons.append("nonnegative_slope")
    if np.isfinite(local_r2) and local_r2 < POLICY["min_local_r2"]:
        reasons.append("weak_local_fit")
    if len(slopes) < 2 or not np.isfinite(slopes).all() or not (np.asarray(slopes) < 0).all():
        reasons.append("unstable_direction")
    if (not np.isfinite([n_effective, canopy_sd]).all()
            or n_effective < POLICY["min_effective_neighbors"]
            or canopy_sd < POLICY["min_weighted_canopy_sd_pp"]):
        reasons.append("insufficient_local_support")
    return reasons


def evaluate_scenario(uhi, canopy, slope, reasons, support_min, support_max, delta):
    if not np.isfinite([uhi, canopy, delta]).all() or not 0 <= canopy <= 100 or delta < 0:
        raise ValueError("Finite observed UHI, canopy in 0..100 and nonnegative canopy delta required")
    # A ceiling limits additions; it must never remove existing canopy.
    new_canopy = max(canopy, min(canopy + delta, POLICY["canopy_ceiling_pct"]))
    actual_delta = new_canopy - canopy
    result = {"requested_delta_pp": float(delta), "canopy_pct": float(new_canopy),
              "applied_delta_pp": float(actual_delta), "status": "unavailable",
              "reason_codes": list(reasons), "predicted_uhi": None, "cooling_c": None}
    if delta == 0 or actual_delta == 0:
        result.update(status="baseline" if delta == 0 else "no_change", reason_codes=[],
                      predicted_uhi=float(uhi), cooling_c=0.0)
        return result
    if not np.isfinite([slope, support_min, support_max]).all() or support_min > support_max:
        if "invalid_local_fit" not in result["reason_codes"]:
            result["reason_codes"].append("invalid_local_fit")
    elif not support_min - 1e-9 <= canopy <= new_canopy <= support_max + 1e-9:
        result["reason_codes"].append("outside_local_canopy_range")
    if np.isfinite(slope) and slope >= 0 and "nonnegative_slope" not in result["reason_codes"]:
        result["reason_codes"].append("nonnegative_slope")
    if result["reason_codes"]:
        return result
    change = float(slope * actual_delta)
    if not np.isfinite(change) or not np.isfinite(uhi + change):
        result["reason_codes"].append("invalid_local_fit")
        return result
    result.update(status="indicative", predicted_uhi=float(uhi + change), cooling_c=-change)
    return result


def screen_outputs(frame, xy, canopy, uhi, k, fit_local, weights_fn):
    """Keep raw scientific values, but mask public scenario columns when screened."""
    n = len(frame)
    sizes = sorted(set(min(n, max(3, int(k * scale))) for scale in POLICY["bandwidth_multipliers"]))
    alternative = {}
    diagnostics = np.empty((n, 4))
    for size in sizes:
        neighbors = NearestNeighbors(n_neighbors=size, algorithm="kd_tree").fit(xy)
        dists, indices = neighbors.kneighbors(xy)
        weights = weights_fn(dists)
        slopes = np.empty(n)
        for i in range(n):
            x, y, w = canopy[indices[i]], uhi[indices[i]], weights[i]
            stats = local_diagnostics(x, w)
            slopes[i] = fit_local(x, y, w)[1] if stats[1] > 1e-8 else np.nan
            if size == k:
                diagnostics[i] = stats
        alternative[size] = slopes
        print(f"  reliability neighborhood checked: k={size}", flush=True)
        del dists, indices, weights
    if k not in alternative:
        raise ValueError("Base neighborhood must be included in sensitivity checks")
    if not np.allclose(alternative[k], frame.slope, atol=1e-10, rtol=0, equal_nan=True):
        raise ValueError("Reliability diagnostics do not match fitted coefficients")
    out = frame.copy()
    for index, name in enumerate(("effective_neighbors", "weighted_canopy_sd_pp", "local_canopy_min", "local_canopy_max")):
        out[name] = diagnostics[:, index]
    for size in sizes:
        out[f"diagnostic_slope_k{size}"] = alternative[size]
    reason_lists = [classify_block(row.slope, row.local_r2,
                    [alternative[size][i] for size in sizes], diagnostics[i, 0], diagnostics[i, 1])
                    for i, row in enumerate(frame.itertuples(index=False))]
    out["cooling_status"] = ["unavailable" if r else "indicative" for r in reason_lists]
    out["cooling_reason_codes"] = ["|".join(r) for r in reason_lists]
    out["simulation_slope"] = np.where(out.cooling_status == "indicative", out.slope, np.nan)
    scenario_keys = sorted(int(c.removeprefix("uhi_plus")) for c in frame if c.startswith("uhi_plus"))
    blocks = []
    for i, row in enumerate(frame.itertuples(index=False)):
        scenarios = [evaluate_scenario(row.uhi_mean, row.canopy_pct, row.slope, reason_lists[i],
                     diagnostics[i, 2], diagnostics[i, 3], delta) for delta in scenario_keys]
        blocks.append({"mb_code16": row.mb_code16, "observed_uhi": float(row.uhi_mean),
                       "observed_canopy_pct": float(row.canopy_pct), "status": out.cooling_status.iloc[i],
                       "reason_codes": reason_lists[i], "scenarios": scenarios})
    for j, delta in enumerate(scenario_keys):
        out[f"raw_uhi_plus{delta}"] = frame[f"uhi_plus{delta}"]
        out[f"uhi_plus{delta}"] = [b["scenarios"][j]["predicted_uhi"] for b in blocks]
        out[f"canopy_plus{delta}"] = [b["scenarios"][j]["canopy_pct"] for b in blocks]
        out[f"cooling_plus{delta}"] = [b["scenarios"][j]["cooling_c"] for b in blocks]
        out[f"status_plus{delta}"] = [b["scenarios"][j]["status"] for b in blocks]
        out[f"reasons_plus{delta}"] = ["|".join(b["scenarios"][j]["reason_codes"]) for b in blocks]
    summary = {"policy": POLICY, "neighborhood_sizes": sizes,
               "block_status_counts": dict(Counter(out.cooling_status)),
               "reason_counts_overlapping": dict(Counter(r for rs in reason_lists for r in rs)),
               "scenario_status_counts": {str(d): dict(Counter(out[f"status_plus{d}"])) for d in scenario_keys},
               "local_r2_threshold_sensitivity": {}}
    # Threshold sensitivity re-evaluates only the R2 rule; all other rules stay fixed.
    for threshold in (0.05, 0.10, 0.20):
        summary["local_r2_threshold_sensitivity"][str(threshold)] = int(sum(
            not [r for r in reasons if r != "weak_local_fit"] and row.local_r2 >= threshold
            for row, reasons in zip(frame.itertuples(index=False), reason_lists)))
    return out, {"schema_version": 2, "policy": POLICY, "reason_messages": MESSAGES,
                 "notice": "Indicative association only. Uncertainty intervals and planting assumptions are not yet validated.",
                 "blocks": blocks}, summary


def write_public_json(payload, path):
    # Reject NaN/Infinity: unavailable numeric values must be real JSON null.
    text = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    temp = path.with_suffix(".tmp")
    temp.write_text(text, encoding="utf-8")
    temp.replace(path)
