// Optional schema-3 extension. Reject inconsistent or overstated intervals on import.
const METHOD = "gwr_coefficient_normal_v1";
const LEVEL = 0.95;
const CRITICAL = 1.9599639845400536;
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const close = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b));
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function check(ok, message) {
  if (!ok) throw new Error(`Invalid simulator export: uncertainty ${message}`);
}
function common(v) {
  return object(v) && v.method === METHOD && v.level === LEVEL && v.coverage_validated === false;
}

function validateUncertainty(data) {
  const m = data.uncertainty;
  if (!Object.hasOwn(data, "uncertainty")) {
    for (const b of data.blocks) {
      check(!Object.hasOwn(b.tree_planting, "coefficient_uncertainty") &&
        b.scenarios.every((s) => !Object.hasOwn(s, "cooling_interval")), "fields require metadata");
    }
    return;
  }
  check(common(m) && m.version === "uncertainty-v1" && m.scope === "conditional_mean_cooling" &&
    m.pointwise === true && close(m.critical_value, CRITICAL), "unsupported method or coverage claim");
  check(m.variance_assumption === "independent_homoskedastic_errors" &&
    m.coefficient_units === "degrees_C_per_canopy_percentage_point", "assumptions/units");
  for (const key of ["source_export_sha256", "source_coefficients_sha256", "source_model_sha256"]) {
    check(typeof m[key] === "string" && /^[0-9a-f]{64}$/.test(m[key]), key);
  }
  check(typeof m.notice === "string" && m.notice.length > 0, "notice required");
  check(Array.isArray(m.conditioned_on) && ["fixed_bandwidth", "coordinates", "observed_baseline", "canopy_change"].every((v) => m.conditioned_on.includes(v)), "conditioning required");
  check(Array.isArray(m.excludes) && ["spatial_error_correlation", "local_smoothing_bias", "bandwidth_selection",
    "screening_selection", "measurement_error", "tree_growth_and_survival", "site_capacity",
    "causal_effect_uncertainty", "future_observation_noise"].every((v) => m.excludes.includes(v)), "limitations required");
  const f = m.fit;
  check(object(f) && f.n_blocks === data.blocks.length && Number.isSafeInteger(f.n_neighbors) &&
    f.n_neighbors > 2 && f.n_neighbors <= f.n_blocks &&
    [f.trace_s, f.trace_sts, f.residual_sum_squares, f.residual_variance].every((v) => finite(v) && v >= 0) &&
    finite(f.residual_df) && f.residual_df > 0 &&
    close(f.residual_df, f.n_blocks - 2 * f.trace_s + f.trace_sts) &&
    close(f.residual_variance, f.residual_sum_squares / f.residual_df), "fit diagnostics");
  for (const b of data.blocks) {
    const c = b.tree_planting.coefficient_uncertainty;
    if (b.status === "indicative") {
      const slope = b.tree_planting.simulation_slope;
      check(common(c) && finite(c.standard_error) && c.standard_error >= 0 &&
        close(c.lower, slope - CRITICAL * c.standard_error) &&
        close(c.upper, slope + CRITICAL * c.standard_error), `${b.mb_code16} coefficient arithmetic`);
    } else {
      check(c === null, `${b.mb_code16} unavailable coefficient must be null`);
    }
    for (const s of b.scenarios) {
      const v = s.cooling_interval;
      if (s.status !== "indicative") {
        check(v === null, `${b.mb_code16} unavailable/baseline interval must be null`);
        continue;
      }
      check(common(v) && close(v.lower_c, -c.upper * s.applied_delta_pp) &&
        close(v.upper_c, -c.lower * s.applied_delta_pp) &&
        v.includes_zero === (v.lower_c <= 0 && v.upper_c >= 0), `${b.mb_code16} cooling interval arithmetic`);
    }
  }
}
module.exports = { validateUncertainty };
