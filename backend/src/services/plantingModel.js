// Keep the original screened export intact; describe the interactive model separately.
function plantingModel(payload, metadata, baseline, donor = null) {
  const own = payload.tree_planting;
  const fit = donor?.payload.tree_planting || own;
  const canopy = Number(baseline.canopy_pct);
  const area = Number(baseline.area_sqkm) * 1e6;
  const heat = Number(baseline.uhi_mean);
  const crown = metadata.planting_assumptions.profiles.B.mature_canopy_area_m2;
  const ceiling = Math.min(100, own.local_canopy_max_pct, fit.local_canopy_max_pct);
  const supported = Number.isFinite(fit.simulation_slope) && fit.simulation_slope < 0 &&
    canopy >= fit.local_canopy_min_pct - 1e-5 && canopy <= ceiling + 1e-5;
  const valid = [canopy, area, heat, crown, ceiling].every(Number.isFinite) && area > 0 && crown > 0;
  return {
    baseline_heat_c: heat,
    baseline_canopy_pct: canopy,
    area_m2: area,
    crown_area_m2: crown,
    canopy_ceiling_pct: ceiling,
    max_trees: valid && supported ? Math.max(0, Math.floor((ceiling - canopy) / 100 * area / crown + 1e-9)) : 0,
    slope: supported ? fit.simulation_slope : null,
    coefficient_uncertainty: supported ? fit.coefficient_uncertainty || null : null,
    source_mb_code16: donor?.payload.mb_code16 || payload.mb_code16,
    source_kind: donor ? (donor.adjacent ? "adjacent" : "nearest") : "local",
    unavailable_reason: !valid || !supported ? "No supported estimate is available for this block's canopy range." : null,
  };
}

module.exports = { plantingModel };
