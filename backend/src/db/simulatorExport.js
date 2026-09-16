const fs = require("node:fs");
const crypto = require("node:crypto");

function check(condition, message) {
  if (!condition) throw new Error(`Invalid simulator export: ${message}`);
}
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const percent = (n) => finite(n) && n >= 0 && n <= 100;
const close = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b));
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function validateExport(data) {
  check(object(data) && data.schema_version === 3, "schema_version must be 3");
  check(object(data.inputs), "inputs required");
  for (const key of ["points_sha256", "mesh_block_sha256", "planting_assumptions_sha256"]) {
    check(typeof data.inputs[key] === "string" && /^[0-9a-f]{64}$/.test(data.inputs[key]), key);
  }
  check(data.policy?.version === "cooling-screen-v2" &&
    data.policy.validated_uncertainty_interval === false && data.policy.canopy_ceiling_pct === 100 &&
    data.policy.min_local_r2 === 0.1 && data.policy.min_effective_neighbors === 30 &&
    data.policy.min_weighted_canopy_sd_pp === 1 &&
    JSON.stringify(data.policy.bandwidth_multipliers) === "[0.5,1,2]",
  "unsupported screening policy");
  check(object(data.reason_messages) && Object.values(data.reason_messages).every((v) => typeof v === "string" && v.length), "reason_messages");
  const reasonsValid = (reasons) => Array.isArray(reasons) && new Set(reasons).size === reasons.length &&
    reasons.every((reason) => typeof reason === "string" && Object.hasOwn(data.reason_messages, reason));
  const assumptions = data.planting_assumptions;
  check(assumptions?.version === "planting-v1" && ["A", "B", "C"].includes(assumptions.default_profile), "planting assumptions");
  check(assumptions.canopy_accounting?.default_net_canopy_fraction === 1 &&
    assumptions.canopy_accounting.physical_percentage_bound === 100 &&
    assumptions.capacity?.physical_capacity_from_current_data === null &&
    assumptions.maturity?.guaranteed_by_2050 === false, "capacity and maturity assumptions");
  check(Array.isArray(assumptions.sources) && assumptions.sources.length > 0 &&
    typeof data.notice === "string" && data.notice.length > 0, "sources and notice required");
  for (const name of ["A", "B", "C"]) {
    const area = assumptions.profiles?.[name]?.mature_canopy_area_m2;
    check(finite(area) && area > 0, `profile ${name} crown area`);
  }
  check(Array.isArray(data.blocks) && data.blocks.length > 0, "blocks required");
  if (data.uncertainty !== undefined) {
    check(data.uncertainty.method === "gwr_coefficient_normal_v1" &&
      data.uncertainty.level === 0.95 && data.uncertainty.coverage_validated === false &&
      data.uncertainty.scope === "conditional_mean_cooling" &&
      close(data.uncertainty.critical_value, 1.9599639845400534), "unsupported uncertainty method");
  }
  const codes = new Set();
  for (const block of data.blocks) {
    const code = block.mb_code16;
    check(typeof code === "string" && /^\d{11}$/.test(code) && !codes.has(code), `duplicate/invalid mb_code16 ${code}`);
    codes.add(code);
    check(finite(block.observed_uhi) && percent(block.observed_canopy_pct), `${code} baseline`);
    check(["indicative", "unavailable"].includes(block.status) && reasonsValid(block.reason_codes), `${code} status/reasons`);
    const available = block.status === "indicative";
    check(available === (block.reason_codes.length === 0), `${code} status/reason mismatch`);
    const t = block.tree_planting;
    check(object(t) && finite(t.area_m2) && t.area_m2 > 0, `${code} area_m2`);
    check(percent(t.local_canopy_min_pct) && percent(t.local_canopy_max_pct) &&
      t.local_canopy_min_pct <= t.local_canopy_max_pct, `${code} canopy support`);
    check(available ? finite(t.simulation_slope) && t.simulation_slope < 0 : t.simulation_slope === null,
      `${code} screened simulation_slope`);
    check(t.site_capacity_trees === null && t.site_capacity_status === "not_assessed", `${code} unknown site capacity must remain null`);
    if (data.uncertainty) {
      const u = t.coefficient_uncertainty;
      check(available ? object(u) && u.method === data.uncertainty.method &&
        u.level === 0.95 && u.coverage_validated === false && finite(u.standard_error) && u.standard_error >= 0 &&
        close(u.lower, t.simulation_slope - data.uncertainty.critical_value * u.standard_error) &&
        close(u.upper, t.simulation_slope + data.uncertainty.critical_value * u.standard_error) : u === null,
      `${code} coefficient uncertainty`);
    }
    for (const name of ["A", "B", "C"]) {
      const crown = assumptions.profiles[name].mature_canopy_area_m2;
      const domain = Math.floor(Math.max(0, t.local_canopy_max_pct - block.observed_canopy_pct) / 100 * t.area_m2 / crown + 1e-9);
      const full = Math.floor((100 - block.observed_canopy_pct) / 100 * t.area_m2 / crown + 1e-9);
      const estimable = available && block.observed_canopy_pct >= t.local_canopy_min_pct && block.observed_canopy_pct <= t.local_canopy_max_pct;
      const limits = t.default_limits_by_profile?.[name];
      check(limits?.canopy_domain_max_trees === domain && Number.isSafeInteger(domain) &&
        limits.max_trees_with_estimate === (estimable ? Math.min(domain, full) : null), `${code} profile ${name} limits`);
    }
    check(Array.isArray(block.scenarios) && block.scenarios.length === 4, `${code} four scenarios required`);
    for (const [index, s] of block.scenarios.entries()) {
      const canopy = Math.min(100, block.observed_canopy_pct + index * 5);
      const delta = canopy - block.observed_canopy_pct;
      check(s.requested_delta_pp === index * 5 && close(s.canopy_pct, canopy) && close(s.applied_delta_pp, delta), `${code} scenario canopy`);
      check(reasonsValid(s.reason_codes), `${code} scenario reasons`);
      if (data.uncertainty) {
        const ci = s.cooling_interval;
        const u = t.coefficient_uncertainty;
        check(s.status === "indicative" ? object(ci) && object(u) &&
          ci.method === data.uncertainty.method && ci.level === 0.95 && ci.coverage_validated === false &&
          close(ci.lower_c, -u.upper * delta) && close(ci.upper_c, -u.lower * delta) &&
          ci.includes_zero === (ci.lower_c <= 0 && ci.upper_c >= 0) : ci === null,
        `${code} cooling interval`);
      }
      if (delta === 0) {
        check(s.status === (index === 0 ? "baseline" : "no_change") && s.reason_codes.length === 0 &&
          s.cooling_c === 0 && s.predicted_uhi === block.observed_uhi, `${code} baseline/no change`);
      } else {
        const outside = block.observed_canopy_pct < t.local_canopy_min_pct - 1e-9 || canopy > t.local_canopy_max_pct + 1e-9;
        if (!available || outside) {
          check(s.status === "unavailable" && s.predicted_uhi === null && s.cooling_c === null &&
            s.reason_codes.length > 0 && block.reason_codes.every((r) => s.reason_codes.includes(r)) &&
            (!outside || s.reason_codes.includes("outside_local_canopy_range") || s.reason_codes.includes("invalid_local_fit")), `${code} unavailable scenario must retain null and reasons`);
        } else {
          const cooling = -t.simulation_slope * delta;
          check(s.status === "indicative" && s.reason_codes.length === 0 && close(s.cooling_c, cooling) &&
            close(s.predicted_uhi, block.observed_uhi - cooling), `${code} indicative scenario arithmetic`);
        }
      }
    }
  }
  const { blocks, ...metadata } = data;
  return { blocks, metadata };
}

function readExport(file) {
  const bytes = fs.readFileSync(file);
  return parseExport(bytes);
}

function parseExport(bytes) {
  const data = validateExport(JSON.parse(bytes.toString("utf8")));
  return { ...data, releaseId: crypto.createHash("sha256").update(bytes).digest("hex") };
}

// Existing mesh_block observations use PostgreSQL REAL (float32). Compare at
// that precision, not at the API's display rounding or a broad decimal tolerance.
function validateDatabaseBlocks(blocks, rows) {
  check(rows.length === blocks.length, `database/export block count differs (${rows.length}/${blocks.length})`);
  const byCode = new Map(rows.map((row) => [String(row.mb_code16).trim(), row]));
  const sameReal = (a, b) => finite(a) && finite(b) && Math.fround(a) === Math.fround(b);
  for (const block of blocks) {
    const row = byCode.get(block.mb_code16);
    check(row && sameReal(row.uhi_mean, block.observed_uhi) &&
      sameReal(row.canopy_pct, block.observed_canopy_pct) &&
      sameReal(row.area_sqkm, block.tree_planting.area_m2 / 1e6), `${block.mb_code16} does not match database baseline/area`);
  }
}

module.exports = { validateExport, readExport, parseExport, validateDatabaseBlocks };
