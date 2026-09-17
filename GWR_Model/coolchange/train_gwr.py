#!/usr/bin/env python3
"""Fit geographically weighted regression: uhi_mean ~ canopy_pct.

Adaptive bisquare kernel, k nearest neighbours. This is the Iteration 2 model:
a local slope per mesh block, not one Melbourne-wide coefficient.

  python -m coolchange.fetch_data
  python -m coolchange.train_gwr                  # all 54,239 blocks (a few minutes)
  python -m coolchange.train_gwr --lga "Casey (C)"   # fast pilot, matches the Clyde North story

Does not modify CoolChange. Writes:
  data/gwr_coefficients.csv   per-block intercept, slope, local R2, scenarios
  data/gwr_model.json         diagnostics vs global OLS and the published GWR
"""
from __future__ import annotations

import argparse
import json
import time

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors

from coolchange._config import DATA, GWR_COEF_CSV, GWR_MODEL_JSON, MESH_BLOCK_CSV, POINTS_CSV
from coolchange.coordinates import join_training_points, sha256_file
from coolchange.cooling_reliability import POLICY, screen_outputs, write_public_json
from coolchange.tree_planting import ASSUMPTIONS, ASSUMPTIONS_PATH, attach_planting

TARGET = "uhi_mean"
FEATURE = "canopy_pct"
PUB_OLS_SLOPE = -0.1274
PUB_OLS_R2 = 0.34
PUB_GWR_ADJ_R2 = 0.90
CANOPY_CEILING = POLICY["canopy_ceiling_pct"]
SCENARIO_DELTAS = (0, 5, 10, 15)
K_GRID = (100, 150, 200, 300, 400, 600, 800, 1200)
SEARCH_SAMPLE = 3000
MELB_LAT0 = -37.8136
MELB_LON0 = 144.9631
M_PER_DEG_LAT = 110_540.0


def project_metres(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Local equirectangular metres. Enough for neighbour search inside metro Melbourne."""
    m_per_deg_lon = 111_320.0 * np.cos(np.radians(MELB_LAT0))
    x = (lon - MELB_LON0) * m_per_deg_lon
    y = (lat - MELB_LAT0) * M_PER_DEG_LAT
    return np.column_stack([x, y])


def load_joined(lga: str | None) -> pd.DataFrame:
    if not MESH_BLOCK_CSV.exists():
        raise SystemExit(f"Missing {MESH_BLOCK_CSV}. Run: python -m coolchange.fetch_data")
    if not POINTS_CSV.exists():
        raise SystemExit(
            f"Missing {POINTS_CSV}. Run: python -m coolchange.fetch_data\n"
            "GWR needs one point per block; the API list does not include coordinates."
        )
    mb = pd.read_csv(MESH_BLOCK_CSV, dtype={"mb_code16": str})
    pts = pd.read_csv(POINTS_CSV, dtype={"mb_code16": str})
    df = join_training_points(mb, pts)
    if lga:
        df = df[df.lga_name == lga].copy()
        if df.empty:
            names = sorted(mb.lga_name.dropna().unique())
            raise SystemExit(f"No rows for lga={lga!r}. Known LGAs include: {names[:8]} ...")
    keep = ["mb_code16", "lga_name", "sa2_name", TARGET, FEATURE, "lon", "lat", "area_sqkm"]
    df = df[keep]
    if not np.isfinite(df.area_sqkm).all() or (df.area_sqkm <= 0).any():
        raise ValueError("Positive finite block areas are required for tree scenarios")
    if len(df) < 50:
        raise SystemExit(f"Only {len(df)} rows after join; not enough for GWR.")
    print(f"blocks: {len(df):,}   lga={lga or 'METRO'}")
    print(f"  points matched {len(df):,} / mesh_block {len(mb):,}")
    return df.reset_index(drop=True)


def bisquare_weights(dists: np.ndarray) -> np.ndarray:
    dmax = np.maximum(dists[:, -1], 1e-6)
    u = np.clip(dists / dmax[:, None], 0.0, 1.0)
    return (1.0 - u ** 2) ** 2


def local_wls(x_nb: np.ndarray, y_nb: np.ndarray, w: np.ndarray):
    """Intercept + one slope. Returns beta (2,), or NaNs if the system is degenerate."""
    sqrtw = np.sqrt(np.maximum(w, 0.0))
    X = np.column_stack([sqrtw, sqrtw * x_nb])
    yw = sqrtw * y_nb
    try:
        beta, _, rank, _ = np.linalg.lstsq(X, yw, rcond=None)
    except np.linalg.LinAlgError:
        return np.array([np.nan, np.nan])
    if rank < 2 or not np.all(np.isfinite(beta)):
        return np.array([np.nan, np.nan])
    return beta


def gwr_fit(xy: np.ndarray, x: np.ndarray, y: np.ndarray, k: int, include_self: bool):
    n = len(y)
    k_query = min(k + (0 if include_self else 1), n)
    nn = NearestNeighbors(n_neighbors=k_query, algorithm="kd_tree")
    nn.fit(xy)
    dists, idxs = nn.kneighbors(xy)
    if not include_self:
        dists = dists[:, 1:]
        idxs = idxs[:, 1:]
    w = bisquare_weights(dists)

    intercept = np.empty(n)
    slope = np.empty(n)
    yhat = np.empty(n)
    local_r2 = np.empty(n)

    for i in range(n):
        xi = x[idxs[i]]
        yi = y[idxs[i]]
        wi = w[i]
        beta = local_wls(xi, yi, wi)
        intercept[i] = beta[0]
        slope[i] = beta[1]
        yhat[i] = beta[0] + beta[1] * x[i]
        ybar = np.average(yi, weights=wi) if wi.sum() > 0 else yi.mean()
        ss_tot = np.sum(wi * (yi - ybar) ** 2)
        fitted = beta[0] + beta[1] * xi
        ss_res = np.sum(wi * (yi - fitted) ** 2)
        local_r2[i] = 1.0 - ss_res / ss_tot if ss_tot > 1e-12 else np.nan

    return intercept, slope, yhat, local_r2


def r2_score(y: np.ndarray, yhat: np.ndarray) -> float:
    ss_res = float(np.sum((y - yhat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    return 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")


def rmse(y: np.ndarray, yhat: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y - yhat) ** 2)))


def search_bandwidth(xy: np.ndarray, x: np.ndarray, y: np.ndarray) -> int:
    n = len(y)
    rng = np.random.default_rng(42)
    sample_n = min(SEARCH_SAMPLE, n)
    sample = rng.choice(n, size=sample_n, replace=False)
    xy_s, x_s, y_s = xy[sample], x[sample], y[sample]
    print(f"\nbandwidth search on {sample_n:,} blocks (leave-one-out CV):")
    best_k, best_rmse = None, np.inf
    for k in K_GRID:
        if k + 1 >= sample_n:
            continue
        _, _, yhat, _ = gwr_fit(xy_s, x_s, y_s, k=k, include_self=False)
        score = rmse(y_s, yhat)
        print(f"  k={k:<5}  LOO RMSE={score:.4f} °C")
        if score < best_rmse:
            best_rmse, best_k = score, k
    if best_k is None:
        best_k = min(400, max(100, n // 10))
    print(f"  selected k={best_k}")
    print("  note: leave-one-out RMSE usually prefers the smallest k. "
          "If local slopes look noisy, refit with --k 400.")
    return int(best_k)


def global_ols(x: np.ndarray, y: np.ndarray):
    X = np.column_stack([np.ones(len(x)), x])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    yhat = X @ beta
    return float(beta[0]), float(beta[1]), r2_score(y, yhat), rmse(y, yhat)


def apply_scenarios(uhi: np.ndarray, canopy: np.ndarray, slope: np.ndarray) -> dict[str, np.ndarray]:
    out = {}
    for delta in SCENARIO_DELTAS:
        new_canopy = np.maximum(canopy, np.minimum(canopy + delta, CANOPY_CEILING))
        out[f"uhi_plus{delta}"] = uhi + slope * (new_canopy - canopy)
        out[f"canopy_plus{delta}"] = new_canopy
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Fit GWR without changing CoolChange.")
    parser.add_argument("--lga", default="", help='Limit to one LGA, e.g. "Casey (C)".')
    parser.add_argument("--k", type=int, default=0, help="Neighbour count. 0 = search on a subsample.")
    parser.add_argument(
        "--pilot",
        action="store_true",
        help='Shortcut for --lga "Casey (C)".',
    )
    args = parser.parse_args()
    lga = "Casey (C)" if args.pilot else (args.lga.strip() or None)

    df = load_joined(lga)
    xy = project_metres(df.lon.to_numpy(), df.lat.to_numpy())
    x = df[FEATURE].to_numpy(dtype=float)
    y = df[TARGET].to_numpy(dtype=float)

    ols_int, ols_slope, ols_r2, ols_rmse = global_ols(x, y)
    print("\n--- global OLS (same spec as Iteration 1) ---")
    print(f"  uhi = {ols_int:.4f} + ({ols_slope:.4f})*canopy_pct")
    print(f"  R2={ols_r2:.4f}  RMSE={ols_rmse:.4f} °C")
    print(f"  published OLS slope {PUB_OLS_SLOPE}, R2 ~ {PUB_OLS_R2}")

    k = args.k if args.k > 0 else search_bandwidth(xy, x, y)
    k = min(k, len(df) - 1)
    print(f"\nfitting GWR  k={k}  kernel=adaptive bisquare ...")
    t0 = time.time()
    intercept, slope, yhat, local_r2 = gwr_fit(xy, x, y, k=k, include_self=True)
    if not all(np.isfinite(values).all() for values in (intercept, slope, yhat)):
        raise ValueError("Nonfinite fitted parameters or predictions; no output written")
    elapsed = time.time() - t0
    gwr_r2 = r2_score(y, yhat)
    gwr_rmse = rmse(y, yhat)
    print(f"  done in {elapsed:.1f}s")
    print(f"  quasi-global R2={gwr_r2:.4f}  RMSE={gwr_rmse:.4f} °C")
    print(f"  published GWR adj R2 ~ {PUB_GWR_ADJ_R2} (Sun et al. 2019; different n and software)")

    finite = np.isfinite(slope)
    print("\n--- local canopy slopes (°C per canopy point) ---")
    qs = np.nanpercentile(slope, [5, 25, 50, 75, 95])
    print(f"  p05={qs[0]:+.4f}  p25={qs[1]:+.4f}  median={qs[2]:+.4f}  "
          f"p75={qs[3]:+.4f}  p95={qs[4]:+.4f}")
    n_neg = int(np.sum(slope[finite] < 0))
    print(f"  negative slopes: {n_neg:,} / {int(finite.sum()):,}  "
          f"({100 * n_neg / max(int(finite.sum()), 1):.1f}%)")
    print(f"  local R2 median={np.nanmedian(local_r2):.3f}")

    scenarios = apply_scenarios(y, x, slope)
    out = df.copy()
    out["intercept"] = intercept
    out["slope"] = slope
    out["local_r2"] = local_r2
    out["uhi_hat"] = yhat
    out["n_neighbors"] = k
    out["slope_negative"] = slope < 0
    for col, arr in scenarios.items():
        out[col] = arr
    out, public_scenarios, screening = screen_outputs(
        out, xy, x, y, k, local_wls, bisquare_weights)
    attach_planting(out, public_scenarios)
    public_scenarios["inputs"] = {
        "planting_assumptions_sha256": sha256_file(ASSUMPTIONS_PATH),
        "points_sha256": sha256_file(POINTS_CSV),
        "mesh_block_sha256": sha256_file(MESH_BLOCK_CSV),
    }
    # Validate JSON before writing any of the new output artifacts.
    json.dumps(public_scenarios, allow_nan=False)
    out.to_csv(GWR_COEF_CSV, index=False)
    write_public_json(public_scenarios, DATA / "simulator_scenarios.json")
    (DATA / "cooling_reliability_report.json").write_text(
        json.dumps(screening, indent=2, allow_nan=False), encoding="utf-8")

    payload = {
        "model_type": "GWR",
        "scope": lga or "METRO",
        "target": TARGET,
        "feature": FEATURE,
        "kernel": "adaptive_bisquare",
        "n_neighbors": k,
        "n_blocks": int(len(df)),
        "output_schema_version": 3,
        "cooling_reliability": screening,
        "inputs": {
            "planting_assumptions_sha256": sha256_file(ASSUMPTIONS_PATH),
            "mesh_block_sha256": sha256_file(MESH_BLOCK_CSV),
            "points_sha256": sha256_file(POINTS_CSV),
            "bandwidth_selection": "explicit --k" if args.k > 0 else "subsample LOO CV",
        },
        "function": (
            "uhi_hat(block) = intercept[block] + slope[block] * canopy_pct. "
            "Raw association: uhi_new = uhi_mean + slope * (canopy_new - canopy_pct). "
            "Public scenario values are null when display screening fails; see cooling_reliability. "
            f"Percentage scenarios bounded by {CANOPY_CEILING}% mathematically; this is not planting capacity. "
            "Whole-tree requests beyond the percentage bound are rejected, not clipped."
        ),
        "global_ols": {
            "intercept": round(ols_int, 6),
            "slope": round(ols_slope, 6),
            "r2": round(ols_r2, 4),
            "rmse": round(ols_rmse, 4),
        },
        "gwr": {
            "quasi_global_r2": round(gwr_r2, 4),
            "rmse": round(gwr_rmse, 4),
            "slope_median": round(float(np.nanmedian(slope)), 6),
            "slope_p05": round(float(qs[0]), 6),
            "slope_p95": round(float(qs[4]), 6),
            "pct_negative_slopes": round(100 * n_neg / max(int(finite.sum()), 1), 2),
            "local_r2_median": round(float(np.nanmedian(local_r2)), 4),
            "fit_seconds": round(elapsed, 2),
        },
        "benchmark": {
            "sun_et_al_2019_ols_slope": PUB_OLS_SLOPE,
            "sun_et_al_2019_ols_r2": PUB_OLS_R2,
            "sun_et_al_2019_gwr_adj_r2": PUB_GWR_ADJ_R2,
            "note": (
                "OLS here should sit near slope -0.1274 / R2 0.34. "
                "GWR quasi-global R2 is not identical to their adjusted R2 "
                "(n=54,239 vs 55,603; see inputs.bandwidth_selection, not ESRI/GWmodel AICc)."
            ),
        },
        "planting": {
            "assumptions": ASSUMPTIONS,
            "percentage_bound_pct": CANOPY_CEILING,
            "scenario_deltas_pct": list(SCENARIO_DELTAS),
        },
        "note": (
            "Association, not a planting experiment. "
            "Do not treat ACS 2050 heat-day bands as this model's Y. "
            "A positive local slope is a data flag, not a reason to plant fewer trees."
        ),
    }
    GWR_MODEL_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {GWR_COEF_CSV}")
    print(f"wrote {GWR_MODEL_JSON}")
    print("CoolChange was not modified. Copy coefficients in only after you accept the diagnostics.")


if __name__ == "__main__":
    main()
