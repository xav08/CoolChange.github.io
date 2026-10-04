#!/usr/bin/env python3
"""
Cool Change - Epic 7, Equity Analysis (Stories 7.1.1 and 7.1.2)

    python3 data-pipeline/08_build_equity_sa2.py

Tests the equity claim in our own problem statement instead of asserting it:
are heat and tree canopy distributed unevenly by socio-economic disadvantage?

  7.1.1  Aggregate mesh-block heat and canopy UP to SA2 (suburb) level, then
         join the ABS's own SA2-level SEIFA 2016 IRSD. The join happens at
         SA2 level only: no mesh-block or SA1 identifier survives into any
         output, so there is no path back to a block.
  7.1.2  Measure the relationship across all of metropolitan Melbourne and
         write it down exactly as computed.

Writes (all small, all committed):
    data-pipeline/equity/equity_sa2.csv        one row per SA2 (303)
    data-pipeline/equity/equity_by_decile.csv  one row per SEIFA decile (10)
    data-pipeline/equity/equity_stats.json     every statistic, incl. sensitivity runs
    frontend/src/data/equitySeifa.json         chart-ready bundle for the About page

HONEST-REPORTING RULE: the validation gates below check DATA INTEGRITY only
(row counts, totals, join coverage, no block-level fields). There is
deliberately no gate on the value or sign of any result. If the relationship
comes out weaker, flatter or reversed after a data change, the script still
writes it -- that is the point of Story 7.1.2.
"""
import json
import os
from datetime import date

import numpy as np
import pandas as pd

from _common import (load_d1, load_d3, load_d4, load_d4_sa2, REPO, HERE,
                     EXPECTED_BLOCKS, Checks)

OUT = os.path.join(HERE, "equity")
FRONTEND_JSON = os.path.join(REPO, "frontend", "src", "data", "equitySeifa.json")

# An SA2 enters the statistics only if at least this many residents live in
# our blocks. Below it the SA2 is an airport, racecourse or industrial strip:
# its heat says nothing about where people live, and its SEIFA score (where
# the ABS publishes one at all) rests on a handful of people. Excluded SA2s
# are still written to equity_sa2.csv, flagged, so coverage stays complete.
MIN_PERSONS = 500

N_BOOT = 10_000
SEED = 20261004

EXPECTED_SA2 = 303
EXPECTED_SA2_WITH_SEIFA = 299
EXPECTED_PERSONS = 4_345_097

# Anything that would let a row be traced to a block or SA1 must never appear.
FORBIDDEN_COLUMNS = {"mb_code16", "mb_code", "sa1_code16", "sa1", "MB_CODE16", "SA1_MAIN16"}


# ----------------------------------------------------------------- helpers
def wmean(values, weights):
    w = np.asarray(weights, float)
    return float(np.sum(np.asarray(values, float) * w) / w.sum()) if w.sum() > 0 else np.nan


def pearson(x, y):
    return float(np.corrcoef(x, y)[0, 1])


def spearman(x, y):
    return pearson(pd.Series(x).rank().values, pd.Series(y).rank().values)


def slope(x, y):
    return float(np.polyfit(x, y, 1)[0])


def boot_ci(x, y, fn, n=N_BOOT, seed=SEED):
    """Percentile bootstrap over SA2s. NOTE: SA2s are spatially autocorrelated,
    so treating them as independent makes this interval somewhat too narrow."""
    rng = np.random.default_rng(seed)
    x, y = np.asarray(x, float), np.asarray(y, float)
    idx = rng.integers(0, len(x), size=(n, len(x)))
    vals = np.array([fn(x[i], y[i]) for i in idx])
    return [round(float(v), 4) for v in np.percentile(vals, [2.5, 97.5])]


def describe(x, y):
    r = pearson(x, y)
    return {
        "pearson_r": round(r, 4),
        "pearson_r_ci95": boot_ci(x, y, pearson),
        "r_squared": round(r * r, 4),
        "spearman_rho": round(spearman(x, y), 4),
        "spearman_rho_ci95": boot_ci(x, y, spearman),
        "ols_slope_per_100_irsd": round(slope(x, y) * 100, 4),
        "ols_slope_per_100_irsd_ci95": [round(v * 100, 4) for v in boot_ci(x, y, slope)],
    }


def group_table(df, key):
    rows = []
    for k, g in df.groupby(key, observed=True):
        rows.append({
            key: int(k),
            "n_sa2": int(len(g)),
            "persons": int(g.persons.sum()),
            "irsd_score_mean": round(wmean(g.irsd_score, g.persons), 1),
            "uhi_mean": round(wmean(g.uhi_mean, g.persons), 2),
            "canopy_pct": round(wmean(g.canopy_pct, g.persons), 2),
        })
    return pd.DataFrame(rows)


# ------------------------------------------------------------------- build
def aggregate_to_sa2(blocks, value_cols, weight="persons"):
    """Population-weighted means per SA2 (people's exposure, not land area),
    plus an unweighted block mean kept as a sensitivity check."""
    b = blocks.copy()
    for c in value_cols:
        b[f"_w_{c}"] = b[c] * b[weight]
    agg = b.groupby(["sa2_code16", "sa2_name"]).agg(
        n_blocks=("mb_code16", "size"),
        persons=(weight, "sum"),
        **{f"_w_{c}": (f"_w_{c}", "sum") for c in value_cols},
        **{f"{c}_block_mean": (c, "mean") for c in value_cols},
    ).reset_index()
    for c in value_cols:
        agg[c] = np.where(agg.persons > 0, agg[f"_w_{c}"] / agg.persons.replace(0, np.nan), np.nan)
        agg = agg.drop(columns=f"_w_{c}")
    return agg


def build():
    c = Checks()
    print("Loading sources ...")
    d1, d3, d4sa2 = load_d1(), load_d3(), load_d4_sa2()
    d3 = d3.rename(columns=str)
    pcol = "Person" if "Person" in d3.columns else "persons"
    mcol = "MB_CODE_2016" if "MB_CODE_2016" in d3.columns else d3.columns[0]
    catcol = "MB_CATEGORY_NAME_2016" if "MB_CATEGORY_NAME_2016" in d3.columns else None

    blocks = d1.merge(d3, left_on="MB_CODE16", right_on=mcol, how="left", validate="1:1")
    blocks = pd.DataFrame({
        "mb_code16": blocks.MB_CODE16,
        "sa1_code16": blocks.SA1_MAIN16,
        "sa2_code16": blocks.SA2_MAIN16,
        "sa2_name": blocks.SA2_NAME16,
        "uhi_mean": blocks.UHI18_M.astype(float),
        "canopy_pct": blocks.PERANYTREE.astype(float),
        "persons": pd.to_numeric(blocks[pcol], errors="coerce").fillna(0).astype(int),
        "mb_category": blocks[catcol] if catcol else "Unknown",
    })
    print(f"  mesh blocks in : {len(blocks):,}")

    print("\nValidation gates (data integrity only -- never on the result)")
    c.expect("mesh blocks", len(blocks), EXPECTED_BLOCKS)
    c.expect("total persons", int(blocks.persons.sum()), EXPECTED_PERSONS)
    c.expect_true("every block has an SA2 code", blocks.sa2_code16.notna().all())

    # ---- 7.1.1 aggregate to SA2 -------------------------------------------
    sa2 = aggregate_to_sa2(blocks, ["uhi_mean", "canopy_pct"])
    c.expect("SA2s", len(sa2), EXPECTED_SA2)
    c.expect("blocks accounted for after aggregation", int(sa2.n_blocks.sum()), EXPECTED_BLOCKS)

    # Join the ABS's own SA2 SEIFA -- at SA2 level, never via blocks.
    sa2 = sa2.merge(d4sa2, left_on="sa2_code16", right_on="SA2_9", how="left", validate="1:1")
    matched = sa2.IRSD.notna()
    c.expect("SA2s with a published SEIFA IRSD", int(matched.sum()), EXPECTED_SA2_WITH_SEIFA)
    unmatched = sa2[~matched]
    c.expect_true(f"every SA2 without SEIFA is near-empty (max {int(unmatched.persons.max())} persons)",
                  bool((unmatched.persons < MIN_PERSONS).all()))
    name_mismatch = sa2[matched & (sa2.sa2_name.str.lower() != sa2.SA2_NAME.str.lower())]
    c.expect("SA2 name mismatches between D1 and SEIFA (join sanity)", len(name_mismatch), 0)

    sa2["coverage_of_abs_pop"] = (sa2.persons / sa2.URP).round(3)
    sa2["included_in_analysis"] = matched & (sa2.persons >= MIN_PERSONS)
    sa2["exclusion_reason"] = np.select(
        [~matched, sa2.persons < MIN_PERSONS],
        ["no SEIFA published by ABS", f"fewer than {MIN_PERSONS} residents"], default="")

    out = pd.DataFrame({
        "sa2_code16": sa2.sa2_code16,
        "sa2_name": sa2.sa2_name,
        "n_blocks": sa2.n_blocks,
        "persons": sa2.persons,
        "abs_usual_resident_pop": sa2.URP.astype("Int64"),
        "coverage_of_abs_pop": sa2.coverage_of_abs_pop,
        "uhi_mean": sa2.uhi_mean.round(3),
        "canopy_pct": sa2.canopy_pct.round(3),
        "uhi_block_mean": sa2.uhi_mean_block_mean.round(3),
        "canopy_block_mean": sa2.canopy_pct_block_mean.round(3),
        "irsd_score": sa2.IRSD.astype("Int64"),
        "irsd_decile": sa2.IRSD_dec.astype("Int64"),
        "included_in_analysis": sa2.included_in_analysis,
        "exclusion_reason": sa2.exclusion_reason,
    }).sort_values("sa2_code16").reset_index(drop=True)

    a = out[out.included_in_analysis].copy()
    a["irsd_score"] = a.irsd_score.astype(float)
    a["irsd_decile"] = a.irsd_decile.astype(int)
    print(f"  SA2s in analysis: {len(a)} of {len(out)}")
    c.expect_true("analysis covers all ten SEIFA deciles", sorted(a.irsd_decile.unique()) == list(range(1, 11)))
    c.expect_true("no block- or SA1-level column in any output",
                  not (FORBIDDEN_COLUMNS & set(out.columns)))
    c.expect_true(f"every analysed SA2 has >= {MIN_PERSONS} residents", bool((a.persons >= MIN_PERSONS).all()))
    c.finish()

    # ---- 7.1.2 measure ----------------------------------------------------
    print("\nMeasuring (n = %d SA2s) ..." % len(a))
    x = a.irsd_score.values
    primary = {"heat": describe(x, a.uhi_mean.values), "canopy": describe(x, a.canopy_pct.values)}

    deciles = group_table(a, "irsd_decile")
    d1row, d10row = deciles.iloc[0], deciles.iloc[-1]
    gap = {
        "uhi_decile1": float(d1row.uhi_mean), "uhi_decile10": float(d10row.uhi_mean),
        "uhi_gap_c": round(float(d1row.uhi_mean - d10row.uhi_mean), 2),
        "canopy_decile1": float(d1row.canopy_pct), "canopy_decile10": float(d10row.canopy_pct),
        "canopy_ratio_10_to_1": round(float(d10row.canopy_pct / d1row.canopy_pct), 2),
        "sa2_uhi_sd": round(float(a.uhi_mean.std()), 2),
        "sa2_canopy_sd": round(float(a.canopy_pct.std()), 2),
    }

    # ---- sensitivity runs: reported alongside, never instead of, the primary
    sens = {}
    sens["unweighted_block_mean"] = {
        "heat": describe(x, a.uhi_block_mean.values),
        "canopy": describe(x, a.canopy_block_mean.values)}

    res = aggregate_to_sa2(blocks[blocks.mb_category == "Residential"], ["uhi_mean", "canopy_pct"])
    res = res.merge(a[["sa2_code16", "irsd_score"]], on="sa2_code16")
    res = res[res.persons >= MIN_PERSONS]
    sens["residential_blocks_only"] = {
        "n_sa2": int(len(res)),
        "heat": describe(res.irsd_score.values, res.uhi_mean.values),
        "canopy": describe(res.irsd_score.values, res.canopy_pct.values)}

    a["sa4"] = a.sa2_code16.str[:3]
    dm = a.groupby("sa4")[["irsd_score", "uhi_mean", "canopy_pct"]].transform(lambda s: s - s.mean())
    sens["within_sa4_region"] = {
        "what": "Each SA2 compared only with others in its own SA4 region (values demeaned "
                "by SA4). Asks: is the gradient still there once broad geography "
                "(west vs east, inner vs outer) is held constant?",
        "n_sa4": int(a.sa4.nunique()),
        "heat_pearson_r": round(pearson(dm.irsd_score, dm.uhi_mean), 4),
        "canopy_pearson_r": round(pearson(dm.irsd_score, dm.canopy_pct), 4)}

    a["metro_quintile"] = pd.qcut(a.irsd_score, 5, labels=range(1, 6)).astype(int)
    sens["metro_quintiles"] = group_table(a, "metro_quintile").to_dict(orient="records")

    # D1 stops at the metro boundary, so some fringe SA2s are only partly in
    # our blocks (coverage_of_abs_pop < 1). Their heat/canopy describe only
    # the covered part; check the result does not hinge on them.
    wc = a[a.coverage_of_abs_pop >= 0.8]
    sens["well_covered_sa2s_only"] = {
        "what": "Only SA2s where our blocks hold >= 80% of the ABS usual resident population.",
        "n_sa2": int(len(wc)),
        "heat_pearson_r": round(pearson(wc.irsd_score, wc.uhi_mean), 4),
        "canopy_pearson_r": round(pearson(wc.irsd_score, wc.canopy_pct), 4)}

    allpop = out[out.irsd_score.notna() & (out.persons > 0)]
    sens["including_small_sa2s"] = {
        "n_sa2": int(len(allpop)),
        "heat_pearson_r": round(pearson(allpop.irsd_score.astype(float), allpop.uhi_mean), 4),
        "canopy_pearson_r": round(pearson(allpop.irsd_score.astype(float), allpop.canopy_pct), 4)}

    # Block-level reference (SA1 SEIFA attached to each block). Computed for
    # comparison ONLY -- a single coefficient leaves this script, never a row.
    d4 = load_d4()
    bl = blocks.merge(d4, left_on="sa1_code16", right_on="SA1_11", how="inner").dropna(subset=["IRSD"])
    sens["block_level_reference"] = {
        "what": "Same correlation computed on individual mesh blocks with SA1 SEIFA. "
                "Reported only to show how much aggregation strengthens r (ecological "
                "correlation). Not part of the product output.",
        "n_blocks": int(len(bl)),
        "heat_pearson_r": round(pearson(bl.IRSD, bl.uhi_mean), 4),
        "canopy_pearson_r": round(pearson(bl.IRSD, bl.canopy_pct), 4)}

    # ---- sanity check (DoD 7.1.2 #2) ---------------------------------------
    cols = ["sa2_name", "irsd_score", "irsd_decile", "uhi_mean", "canopy_pct"]
    q_hot, q_cool = a.uhi_mean.quantile(0.75), a.uhi_mean.quantile(0.25)
    sanity = {
        "most_disadvantaged_5": a.nsmallest(5, "irsd_score")[cols].round(2).to_dict(orient="records"),
        "least_disadvantaged_5": a.nlargest(5, "irsd_score")[cols].round(2).to_dict(orient="records"),
        "exceptions_hot_and_advantaged": a[(a.irsd_decile >= 9) & (a.uhi_mean >= q_hot)]
            .sort_values("uhi_mean", ascending=False)[cols].round(2).to_dict(orient="records"),
        "exceptions_cool_and_disadvantaged": a[(a.irsd_decile <= 2) & (a.uhi_mean <= q_cool)]
            [cols].round(2).to_dict(orient="records"),
    }

    stats = {
        "generated": date.today().isoformat(),
        "script": "data-pipeline/08_build_equity_sa2.py",
        "stories": ["7.1.1", "7.1.2"],
        "unit_of_analysis": "SA2 (ASGS 2016)",
        "n_sa2_total": int(len(out)),
        "n_sa2_analysed": int(len(a)),
        "persons_analysed": int(a.persons.sum()),
        "min_persons_per_sa2": MIN_PERSONS,
        "seifa_index": "IRSD (Index of Relative Socio-economic Disadvantage), ABS 2033.0.55.001, 2016, SA2 Table 1",
        "decile_definition": "ABS national ranking of SA2s (1 = most disadvantaged 10% of SA2s in Australia)",
        "aggregation": "population-weighted mean of mesh-block values (weights = 2016 Census usual residents)",
        "heat_measure": "uhi_mean: summer surface heat, degrees C above non-urban baseline (DTP 2018)",
        "canopy_measure": "canopy_pct: % of area under tree canopy (DTP 2018)",
        "x_variable": "irsd_score (higher = less disadvantaged)",
        "bootstrap": {"resamples": N_BOOT, "seed": SEED, "caveat":
                      "SA2s are spatially autocorrelated, so these intervals are likely somewhat too narrow."},
        "primary": primary,
        "decile_gap": gap,
        "by_decile": deciles.to_dict(orient="records"),
        "sensitivity": sens,
        "sanity_check": sanity,
    }

    # ---- write ------------------------------------------------------------
    os.makedirs(OUT, exist_ok=True)
    out.to_csv(os.path.join(OUT, "equity_sa2.csv"), index=False)
    deciles.to_csv(os.path.join(OUT, "equity_by_decile.csv"), index=False)
    with open(os.path.join(OUT, "equity_stats.json"), "w") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False, default=float)

    bundle = {
        "meta": {k: stats[k] for k in ["generated", "unit_of_analysis", "n_sa2_analysed",
                                       "persons_analysed", "seifa_index", "decile_definition",
                                       "aggregation", "heat_measure", "canopy_measure"]},
        "headline": {
            "heat_pearson_r": primary["heat"]["pearson_r"],
            "heat_pearson_r_ci95": primary["heat"]["pearson_r_ci95"],
            "canopy_pearson_r": primary["canopy"]["pearson_r"],
            "canopy_pearson_r_ci95": primary["canopy"]["pearson_r_ci95"],
            **gap,
        },
        "byDecile": [{"decile": int(r.irsd_decile), "nSa2": int(r.n_sa2), "persons": int(r.persons),
                      "uhi": float(r.uhi_mean), "canopy": float(r.canopy_pct)}
                     for r in deciles.itertuples()],
        "sa2": [{"name": r.sa2_name, "irsd": int(r.irsd_score), "decile": int(r.irsd_decile),
                 "persons": int(r.persons), "uhi": round(float(r.uhi_mean), 2),
                 "canopy": round(float(r.canopy_pct), 2)}
                for r in a.sort_values("irsd_score").itertuples()],
    }
    os.makedirs(os.path.dirname(FRONTEND_JSON), exist_ok=True)
    with open(FRONTEND_JSON, "w") as f:
        json.dump(bundle, f, separators=(",", ":"), ensure_ascii=False)

    # ---- report -----------------------------------------------------------
    h, cn = primary["heat"], primary["canopy"]
    print(f"\n  heat   : r = {h['pearson_r']:+.3f} {h['pearson_r_ci95']}, r2 = {h['r_squared']:.3f}, "
          f"rho = {h['spearman_rho']:+.3f}, slope = {h['ols_slope_per_100_irsd']:+.2f} C / 100 IRSD")
    print(f"  canopy : r = {cn['pearson_r']:+.3f} {cn['pearson_r_ci95']}, r2 = {cn['r_squared']:.3f}, "
          f"rho = {cn['spearman_rho']:+.3f}, slope = {cn['ols_slope_per_100_irsd']:+.2f} pp / 100 IRSD")
    print(f"  decile 1 vs 10: {gap['uhi_decile1']} vs {gap['uhi_decile10']} C (gap {gap['uhi_gap_c']}), "
          f"canopy {gap['canopy_decile1']} vs {gap['canopy_decile10']} % (x{gap['canopy_ratio_10_to_1']})")
    print("\n" + deciles.to_string(index=False))
    print(f"\nWritten: data-pipeline/equity/ (3 files) and frontend/src/data/equitySeifa.json")


if __name__ == "__main__":
    build()
