#!/usr/bin/env python3
"""Fit multivariate OLS: uhi_mean ~ canopy + grass + population density.

  python -m coolchange.fetch_data
  python -m coolchange.train_ols

Writes data/model.json. Does not modify CoolChange.
"""
from __future__ import annotations

import json

import pandas as pd
import statsmodels.api as sm
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from statsmodels.stats.outliers_influence import variance_inflation_factor

from coolchange._config import MESH_BLOCK_CSV, MODEL_JSON


FEATURES = ["canopy_pct", "grass_pct", "pop_density"]
TARGET = "uhi_mean"


def load_table() -> pd.DataFrame:
    if not MESH_BLOCK_CSV.exists():
        raise SystemExit(f"Missing {MESH_BLOCK_CSV}. Run: python -m coolchange.fetch_data")
    df = pd.read_csv(MESH_BLOCK_CSV, dtype={"mb_code16": str})
    df["pop_density"] = df["persons"] / df["area_sqkm"]
    out = df[FEATURES + [TARGET, "mb_code16"]].dropna()
    print(f"rows: {len(out):,}")
    print("Pearson r with uhi_mean:")
    for col in FEATURES:
        print(f"  {col:16s}  {out[col].corr(out[TARGET]):+.4f}")
    return out


def metrics(y_true, y_pred) -> dict:
    return {
        "r2": round(float(r2_score(y_true, y_pred)), 4),
        "rmse": round(float(mean_squared_error(y_true, y_pred) ** 0.5), 4),
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
    }


def fit(name: str, X: pd.DataFrame, y: pd.Series):
    Xc = sm.add_constant(X, has_constant="add")
    model = sm.OLS(y, Xc).fit()
    return model


def main() -> None:
    df = load_table()
    X = df[FEATURES]
    y = df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    print(f"\ntrain {len(X_train):,}   test {len(X_test):,}")

    multi = fit("multi", X_train, y_train)
    uni = fit("uni", X_train[["canopy_pct"]], y_train)

    Xte_m = sm.add_constant(X_test, has_constant="add")
    Xte_u = sm.add_constant(X_test[["canopy_pct"]], has_constant="add")
    multi_test = metrics(y_test, multi.predict(Xte_m))
    uni_test = metrics(y_test, uni.predict(Xte_u))

    print("\n--- multivariate (canopy + grass + pop_density) ---")
    print(multi.summary())
    print("test", multi_test)

    print("\nVIF:")
    Xtr = sm.add_constant(X_train, has_constant="add")
    for i, col in enumerate(Xtr.columns):
        print(f"  {col:16s}  {variance_inflation_factor(Xtr.values, i):.3f}")

    print("\n--- univariate (canopy only, CoolChange-style) ---")
    print(f"  intercept={uni.params['const']:.4f}  slope={uni.params['canopy_pct']:.4f}")
    print("test", uni_test)

    full = fit("full", X, y)
    payload = {
        "target": TARGET,
        "features": FEATURES,
        "n_blocks": int(len(df)),
        "function": (
            f"uhi_hat = {full.params['const']:.6f}"
            f" + ({full.params['canopy_pct']:.6f})*canopy_pct"
            f" + ({full.params['grass_pct']:.6f})*grass_pct"
            f" + ({full.params['pop_density']:.8f})*pop_density"
        ),
        "coefficients": {k: round(float(v), 8) for k, v in full.params.items()},
        "full_r_squared": round(float(full.rsquared), 4),
        "test": {"multivariate": multi_test, "univariate_canopy": uni_test},
        "note": (
            "Association, not a controlled experiment. "
            "Do not treat ACS 2050 heat-day bands as this model's Y."
        ),
    }
    MODEL_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nfunction:\n  {payload['function']}")
    print(f"wrote {MODEL_JSON}")


if __name__ == "__main__":
    main()
