function round2(value) {
  if (value == null || value === "") return null;
  return Math.round(Number(value) * 100) / 100;
}

function round4(value) {
  if (value == null || value === "") return null;
  return Math.round(Number(value) * 10000) / 10000;
}

function asNumber(value) {
  if (value == null || value === "") return null;
  return Number(value);
}

function asInt(value) {
  if (value == null || value === "") return null;
  return Math.trunc(Number(value));
}

function trimCode(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function warmingLevel(value) {
  return asNumber(value);
}

function shapeProjection(row) {
  return {
    warming_level: warmingLevel(row.warming_level),
    horizon_label: row.horizon_label,
    days_label: row.days_label,
    days_lower: asInt(row.days_lower),
    days_upper: asInt(row.days_upper),
    ...(row.is_fallback !== undefined
      ? { is_fallback: Boolean(row.is_fallback) }
      : {}),
  };
}

function shapeBlock(row) {
  return {
    mb_code16: trimCode(row.mb_code16),
    sa2_name: row.sa2_name,
    sa3_name: row.sa3_name,
    lga_name: row.lga_name,
    uhi_mean: round2(row.uhi_mean),
    canopy_pct: round2(row.canopy_pct),
    grass_pct: round2(row.grass_pct),
    shrub_pct: round2(row.shrub_pct),
    any_veg_pct: round2(row.any_veg_pct),
    tree_03_10_pct: round2(row.tree_03_10_pct),
    tree_10_15_pct: round2(row.tree_10_15_pct),
    tree_15plus_pct: round2(row.tree_15plus_pct),
    mb_category: row.mb_category,
    dwellings: asInt(row.dwellings),
    persons: asInt(row.persons),
    area_sqkm: round4(row.area_sqkm),
    irsd_score: asInt(row.irsd_score),
    irsd_decile: asInt(row.irsd_decile),
  };
}

function shapeFlags(block, coolest) {
  const persons = block.persons;
  return {
    no_published_population: persons == null || persons === 0,
    already_coolest_in_lga: Boolean(
      coolest && coolest.mb_code16 && coolest.mb_code16 === block.mb_code16
    ),
  };
}

function shapeComparison(row) {
  return {
    area_type: row.area_type,
    area_name: row.area_name,
    scope: row.scope,
    uhi_mean: round2(row.uhi_mean),
    canopy_mean: round2(row.canopy_mean),
    uhi_delta: round2(row.uhi_delta),
    canopy_delta: round2(row.canopy_delta),
  };
}

function shapeCoolest(row) {
  if (!row || !row.coolest_mb_code) return null;
  return {
    mb_code16: trimCode(row.coolest_mb_code),
    uhi_mean: round2(row.coolest_uhi),
    canopy_pct: round2(row.coolest_canopy_pct),
  };
}

function shapeArea(row) {
  return {
    area_type: row.area_type,
    area_code: row.area_code,
    area_name: row.area_name,
    scope: row.scope,
    n_blocks: asInt(row.n_blocks),
    uhi_mean: round2(row.uhi_mean),
    uhi_p10: round2(row.uhi_p10),
    uhi_p90: round2(row.uhi_p90),
    canopy_mean: round2(row.canopy_mean),
    canopy_p10: round2(row.canopy_p10),
    canopy_p90: round2(row.canopy_p90),
    coolest: shapeCoolest({
      coolest_mb_code: row.coolest_mb_code,
      coolest_uhi: row.coolest_uhi,
      coolest_canopy_pct: row.coolest_canopy_pct,
    }),
  };
}

function shapeStreetSearch(street, suburb, rows) {
  // A street-name search is a PREFIX match (like suburb search), so
  // "Main" can legitimately match both "Main Street" and "Main Road" as
  // separate street entities -- group by street_id, not just flatten
  // every row, so the frontend can tell distinct streets apart (AC 1.3.4)
  // as well as multiple blocks within one street (AC 1.3.2).
  const streetsById = new Map();
  for (const row of rows) {
    const id = asInt(row.street_id);
    if (!streetsById.has(id)) {
      streetsById.set(id, {
        street_id: id,
        road_name: row.road_name,
        road_type: row.road_type,
        locality_name: row.locality_name,
        blocks: [],
      });
    }
    streetsById.get(id).blocks.push({
      mb_code16: trimCode(row.mb_code16),
      n_addresses: asInt(row.n_addresses),
    });
  }

  const results = Array.from(streetsById.values());
  return {
    query: { street, suburb },
    count: results.length,
    results,
  };
}

function shapeBootstrap({ configRows, modelRow, projectionRows }) {
  const config = Object.fromEntries(configRows.map((r) => [r.key, r.value]));
  return {
    data_vintage: asInt(config.data_vintage),
    n_blocks: asInt(config.n_blocks),
    uhi_units: config.uhi_units,
    scale: {
      uhi_min: asNumber(config.uhi_scale_min),
      uhi_max: asNumber(config.uhi_scale_max),
      canopy_max: asNumber(config.canopy_scale_max),
    },
    model: {
      model_type: modelRow.model_type,
      scope: "METRO",
      slope: round2(modelRow.slope) != null ? Number(Number(modelRow.slope).toFixed(4)) : null,
      intercept: Number(Number(modelRow.intercept).toFixed(4)),
      pearson_r: Number(Number(modelRow.pearson_r).toFixed(4)),
      r_squared: Number(Number(modelRow.r_squared).toFixed(3)),
      n_blocks: asInt(modelRow.n_blocks),
    },
    projections: projectionRows.map((row) => shapeProjection(row)),
  };
}

function shapeMeshblockList(rows) {
  return {
    count: rows.length,
    fields: ["mb_code16", "uhi_mean", "canopy_pct"],
    rows: rows.map((row) => [
      trimCode(row.mb_code16),
      round2(row.uhi_mean),
      round2(row.canopy_pct),
    ]),
  };
}

module.exports = {
  round2,
  round4,
  asInt,
  trimCode,
  shapeProjection,
  shapeBlock,
  shapeFlags,
  shapeComparison,
  shapeCoolest,
  shapeArea,
  shapeStreetSearch,
  shapeBootstrap,
  shapeMeshblockList,
};