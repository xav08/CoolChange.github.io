#!/usr/bin/env python3
"""Compare alternative heat~canopy models on the same mesh blocks.

Predictive fit is not enough: the simulator needs a plausible answer to
"if this block gains 10 percentage points of canopy, does it cool?"

  python -m coolchange.fetch_data
  python -m coolchange.compare_models

Does not modify CoolChange. Writes data/model_comparison.json.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.model_selection import train_test_split
from sklearn.neighbors import NearestNeighbors

from coolchange import train_gwr as gwr
from coolchange._config import COMPARE_JSON, MESH_BLOCK_CSV, POINTS_CSV
from coolchange.coordinates import join_training_points, sha256_file

DELTA = 10.0
CEILING = 100.0  # Percentage bound, not an assessment of plantable space.
GWR_K = 400
RNG = 42


def load() -> pd.DataFrame:
    mb = pd.read_csv(MESH_BLOCK_CSV, dtype={"mb_code16": str})
    pts = pd.read_csv(POINTS_CSV, dtype={"mb_code16": str})
    df = join_training_points(mb, pts)
    df["pop_density"] = df.persons / df.area_sqkm
    xy = gwr.project_metres(df.lon.to_numpy(), df.lat.to_numpy())
    df["x_m"] = xy[:, 0]
    df["y_m"] = xy[:, 1]
    return df.reset_index(drop=True)


def metrics(y, yhat) -> dict:
    y = np.asarray(y, float)
    yhat = np.asarray(yhat, float)
    return {
        "r2": round(gwr.r2_score(y, yhat), 4),
        "rmse": round(gwr.rmse(y, yhat), 4),
    }


def plant_stats(delta_uhi: np.ndarray) -> dict:
    d = np.asarray(delta_uhi, float)
    d = d[np.isfinite(d)]
    return {
        "median_delta_uhi_plus10": round(float(np.median(d)), 4),
        "pct_cools": round(float(np.mean(d < 0) * 100), 2),
        "pct_heats": round(float(np.mean(d > 0) * 100), 2),
    }


def bump_canopy(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    out["canopy_pct"] = np.minimum(out["canopy_pct"] + DELTA, CEILING)
    return out


def ols_predict(model: LinearRegression, X: pd.DataFrame):
    return model.predict(X)


def fit_linear(train: pd.DataFrame, cols: list[str]):
    m = LinearRegression()
    m.fit(train[cols], train.uhi_mean)
    return m


def gwr_oos(train: pd.DataFrame, test: pd.DataFrame, k: int = GWR_K):
    xy_tr = train[["x_m", "y_m"]].to_numpy()
    x_tr = train.canopy_pct.to_numpy(float)
    y_tr = train.uhi_mean.to_numpy(float)
    xy_te = test[["x_m", "y_m"]].to_numpy()
    x_te = test.canopy_pct.to_numpy(float)
    k_query = min(k, len(train))
    nn = NearestNeighbors(n_neighbors=k_query, algorithm="kd_tree").fit(xy_tr)
    dists, idxs = nn.kneighbors(xy_te)
    w = gwr.bisquare_weights(dists)
    intercept = np.empty(len(test))
    slope = np.empty(len(test))
    for i in range(len(test)):
        beta = gwr.local_wls(x_tr[idxs[i]], y_tr[idxs[i]], w[i])
        intercept[i] = beta[0]
        slope[i] = beta[1]
    yhat = intercept + slope * x_te
    new_c = np.minimum(x_te + DELTA, CEILING)
    delta = slope * (new_c - x_te)
    return yhat, delta, slope


def lga_ols_predict(train: pd.DataFrame, test: pd.DataFrame):
    xcol = ["canopy_pct"]
    global_m = LinearRegression().fit(train[xcol], train.uhi_mean)
    by_lga = {}
    for name, part in train.groupby("lga_name"):
        if len(part) < 40:
            continue
        by_lga[name] = LinearRegression().fit(part[xcol], part.uhi_mean)

    yhat = global_m.predict(test[xcol])
    slopes = np.full(len(test), float(global_m.coef_[0]))
    for name, idx in test.groupby("lga_name").indices.items():
        m = by_lga.get(name, global_m)
        yhat[idx] = m.predict(test.iloc[idx][xcol])
        slopes[idx] = float(m.coef_[0])
    new_c = np.minimum(test.canopy_pct.to_numpy() + DELTA, CEILING)
    delta = slopes * (new_c - test.canopy_pct.to_numpy())
    return yhat, delta, slopes


def eval_split(name: str, train: pd.DataFrame, test: pd.DataFrame) -> dict:
    y = test.uhi_mean.to_numpy(float)
    rows = []

    # 1. global OLS canopy
    m = fit_linear(train, ["canopy_pct"])
    yhat = m.predict(test[["canopy_pct"]])
    delta = m.predict(bump_canopy(test)[["canopy_pct"]]) - yhat
    rows.append({"id": "ols_canopy", "label": "Global OLS (canopy only, Iteration 1)", **metrics(y, yhat), **plant_stats(delta), "canopy_coef": round(float(m.coef_[0]), 5)})

    # 2. multivariate OLS
    cols_m = ["canopy_pct", "grass_pct", "pop_density"]
    m = fit_linear(train, cols_m)
    yhat = m.predict(test[cols_m])
    delta = m.predict(bump_canopy(test)[cols_m]) - yhat
    rows.append({"id": "ols_multi", "label": "Multivariate OLS (canopy + grass + density)", **metrics(y, yhat), **plant_stats(delta), "canopy_coef": round(float(m.coef_[0]), 5)})

    # 3. vegetation structure
    cols_v = ["tree_03_10_pct", "tree_10_15_pct", "tree_15plus_pct", "grass_pct", "shrub_pct"]
    m = fit_linear(train, cols_v)
    # Simulator intervention: add 10 points to total canopy via the 3-10m band
    # (cannot uniquely split "more trees" across height classes). Report predictive
    # fit only plus a canopy-total OLS-style plant using sum of tree bands.
    yhat = m.predict(test[cols_v])
    bumped = test.copy()
    bumped["tree_03_10_pct"] = np.minimum(bumped["tree_03_10_pct"] + DELTA, CEILING)
    delta = m.predict(bumped[cols_v]) - yhat
    coefs = {c: round(float(v), 5) for c, v in zip(cols_v, m.coef_)}
    rows.append({"id": "ols_veg_bands", "label": "OLS on tree-height bands + grass + shrub", **metrics(y, yhat), **plant_stats(delta), "coefs": coefs})

    # 4. spatial trend OLS
    cols_s = ["canopy_pct", "x_m", "y_m"]
    m = fit_linear(train, cols_s)
    yhat = m.predict(test[cols_s])
    delta = m.predict(bump_canopy(test)[cols_s]) - yhat
    rows.append({"id": "ols_spatial_trend", "label": "OLS canopy + projected coordinates", **metrics(y, yhat), **plant_stats(delta), "canopy_coef": round(float(m.coef_[0]), 5)})

    # 5. LGA-stratified OLS
    yhat, delta, slopes = lga_ols_predict(train, test)
    rows.append({"id": "ols_lga", "label": "OLS per LGA (fallback to global if unseen)", **metrics(y, yhat), **plant_stats(delta), "median_lga_slope": round(float(np.median(slopes)), 5)})

    # 6. GWR k=400, neighbours from train only
    yhat, delta, slopes = gwr_oos(train, test, k=GWR_K)
    rows.append({"id": "gwr_k400", "label": "GWR adaptive bisquare k=400", **metrics(y, yhat), **plant_stats(delta), "median_slope": round(float(np.nanmedian(slopes)), 5), "pct_negative_slope": round(float(np.mean(slopes < 0) * 100), 2)})

    # 7. GWR with OLS fallback on non-negative local slope
    yhat_g, delta_g, slopes_g = yhat, delta, slopes
    m_ols = fit_linear(train, ["canopy_pct"])
    ols_slope = float(m_ols.coef_[0])
    new_c = np.minimum(test.canopy_pct.to_numpy() + DELTA, CEILING)
    dc = new_c - test.canopy_pct.to_numpy()
    slope_use = np.where(slopes_g < 0, slopes_g, ols_slope)
    delta_fb = slope_use * dc
    rows.append({"id": "gwr_k400_ols_fallback", "label": "GWR k=400, OLS fallback if slope ≥ 0", **metrics(y, yhat_g), **plant_stats(delta_fb), "median_slope_used": round(float(np.median(slope_use)), 5)})

    # 8. ridge on the same veg + space features
    cols_r = ["canopy_pct", "grass_pct", "shrub_pct", "pop_density", "x_m", "y_m"]
    ridge = Ridge(alpha=1.0).fit(train[cols_r], train.uhi_mean)
    yhat = ridge.predict(test[cols_r])
    delta = ridge.predict(bump_canopy(test)[cols_r]) - yhat
    rows.append({"id": "ridge_spatial", "label": "Ridge (canopy, grass, shrub, density, coordinates)", **metrics(y, yhat), **plant_stats(delta), "canopy_coef": round(float(ridge.coef_[0]), 5)})

    # 9. histogram gradient boosting
    hgb = HistGradientBoostingRegressor(max_depth=6, learning_rate=0.08, max_iter=200, random_state=RNG)
    hgb.fit(train[cols_r], train.uhi_mean)
    yhat = hgb.predict(test[cols_r])
    delta = hgb.predict(bump_canopy(test)[cols_r]) - yhat
    rows.append({"id": "hgb_spatial", "label": "Gradient boosting (same features as ridge)", **metrics(y, yhat), **plant_stats(delta)})

    # 10. random forest, leaves kept large so it can generalise a bit
    rf = RandomForestRegressor(
        n_estimators=80, min_samples_leaf=40, max_features="sqrt", n_jobs=-1, random_state=RNG
    )
    rf.fit(train[cols_r], train.uhi_mean)
    yhat = rf.predict(test[cols_r])
    delta = rf.predict(bump_canopy(test)[cols_r]) - yhat
    rows.append({"id": "rf_spatial", "label": "Random forest (same features as ridge)", **metrics(y, yhat), **plant_stats(delta)})

    print(f"\n=== {name}  n_train={len(train):,}  n_test={len(test):,} ===")
    print(f"{'id':<24} {'R2':>7} {'RMSE':>7} {'ΔUHI+10':>9} {'%cool':>7} {'%heat':>7}")
    for row in rows:
        print(f"{row['id']:<24} {row['r2']:7.4f} {row['rmse']:7.4f} {row['median_delta_uhi_plus10']:9.4f} {row['pct_cools']:6.1f}% {row['pct_heats']:6.1f}%")
    return {"split": name, "n_train": int(len(train)), "n_test": int(len(test)), "models": rows}


def main() -> None:
    df = load()
    print(f"blocks {len(df):,}")

    train, test = train_test_split(df, test_size=0.2, random_state=RNG)
    random_split = eval_split("random_80_20", train.reset_index(drop=True), test.reset_index(drop=True))

    casey = df[df.lga_name == "Casey (C)"]
    rest = df[df.lga_name != "Casey (C)"]
    spatial = eval_split("holdout_casey", rest.reset_index(drop=True), casey.reset_index(drop=True))

    payload = {
        "target": "uhi_mean",
        "intervention": "canopy_pct + 10, clipped at 100 (percentage bound only), other features held constant",
        "gwr_k": GWR_K,
        "inputs": {
            "mesh_block_sha256": sha256_file(MESH_BLOCK_CSV),
            "points_sha256": sha256_file(POINTS_CSV),
        },
        "splits": [random_split, spatial],
        "not_run": [
            {
                "id": "mgwr",
                "why": "Multiscale GWR needs a separate bandwidth per covariate and is slow at n=54k. Same simulator contract as GWR; try only if k=400 GWR is accepted first.",
            },
            {
                "id": "spatial_lag_sar",
                "why": "A spatial lag of UHI predicts neighbours' heat, not the effect of planting in this block. Poor fit for a tap-to-add-trees control.",
            },
            {
                "id": "llm_finetune",
                "why": "Wrong task class. Already rejected in the AI design experiment.",
            },
        ],
        "reading_guide": (
            "Prefer a model that (1) cools when canopy rises on held-out blocks, "
            "(2) beats global OLS on a spatial holdout, (3) yields a coefficient "
            "or a stable counterfactual the UI can show. High R2 alone is not enough."
        ),
    }
    COMPARE_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {COMPARE_JSON}")


if __name__ == "__main__":
    main()
