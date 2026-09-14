/**
 * Named queries matching backend/src/db/queries.sql.
 * CHAR columns are RTRIM'd so JSON never carries blank padding.
 */

const bootstrapConfig = `
-- name: bootstrapConfig
SELECT key, value FROM app_config
`;

const bootstrapModel = `
-- name: bootstrapModel
SELECT model_type, slope, intercept, pearson_r, r_squared, n_blocks
  FROM model_coefficient
 WHERE is_active AND scope_type = 'METRO'
`;

const bootstrapProjections = `
-- name: bootstrapProjections
SELECT warming_level, horizon_label, days_label, days_lower, days_upper
  FROM projection_metro
 ORDER BY warming_level
`;

const meshblocksAll = `
-- name: meshblocksAll
SELECT RTRIM(mb_code16) AS mb_code16, uhi_mean, canopy_pct
  FROM mesh_block
 ORDER BY mb_code16
`;

const meshblocksByLga = `
-- name: meshblocksByLga
SELECT RTRIM(mb_code16) AS mb_code16, uhi_mean, canopy_pct
  FROM mesh_block
 WHERE lga_name = $1
 ORDER BY mb_code16
`;

const blockByCode = `
-- name: blockByCode
SELECT RTRIM(mb_code16) AS mb_code16,
       RTRIM(sa1_code16) AS sa1_code16,
       RTRIM(sa2_code16) AS sa2_code16,
       sa2_name, RTRIM(sa3_code16) AS sa3_code16, sa3_name,
       lga_name, uhi_mean, canopy_pct, grass_pct, shrub_pct, any_veg_pct,
       shrub_tree_pct, tree_03_10_pct, tree_10_15_pct, tree_15plus_pct,
       mb_category, dwellings, persons, area_sqkm, irsd_score, irsd_decile
  FROM mesh_block
 WHERE mb_code16 = $1
`;

const blockComparisons = `
-- name: blockComparisons
SELECT b.area_type, b.area_name, b.scope, b.uhi_mean, b.canopy_mean,
       round((m.uhi_mean   - b.uhi_mean)::numeric,   2) AS uhi_delta,
       round((m.canopy_pct - b.canopy_mean)::numeric, 2) AS canopy_delta
  FROM mesh_block m
  JOIN area_baseline b
    ON b.scope = 'RESIDENTIAL'
   AND ( (b.area_type = 'LGA'   AND b.area_code = m.lga_name)
      OR (b.area_type = 'METRO' AND b.area_code = 'METRO') )
 WHERE m.mb_code16 = $1
`;

const blockCoolest = `
-- name: blockCoolest
SELECT RTRIM(b.coolest_mb_code) AS coolest_mb_code,
       b.coolest_uhi, b.coolest_canopy_pct
  FROM mesh_block m
  JOIN area_baseline b
    ON b.area_type = 'LGA' AND b.scope = 'RESIDENTIAL' AND b.area_code = m.lga_name
 WHERE m.mb_code16 = $1
`;

const blockProjections = `
-- name: blockProjections
SELECT pm.warming_level,
       pm.horizon_label,
       COALESCE(p.days_label, pm.days_label) AS days_label,
       COALESCE(p.days_lower, pm.days_lower) AS days_lower,
       COALESCE(p.days_upper, pm.days_upper) AS days_upper,
       (p.mb_code16 IS NULL)                 AS is_fallback
  FROM projection_metro pm
  LEFT JOIN mesh_block_projection p
    ON p.warming_level = pm.warming_level AND p.mb_code16 = $1
 ORDER BY pm.warming_level
`;

const areaByKey = `
-- name: areaByKey
SELECT area_type, area_code, area_name, scope, n_blocks,
       uhi_mean, uhi_p10, uhi_p90, canopy_mean, canopy_p10, canopy_p90,
       RTRIM(coolest_mb_code) AS coolest_mb_code, coolest_uhi, coolest_canopy_pct
  FROM area_baseline
 WHERE area_type = $1 AND area_code = $2 AND scope = COALESCE($3, 'RESIDENTIAL')
`;

const searchSuburbs = `
-- name: searchSuburbs
SELECT RTRIM(sa2_code16) AS sa2_code16, sa2_name, min(lga_name) AS lga_name, count(*) AS n_blocks
  FROM mesh_block
 WHERE LOWER(sa2_name) LIKE LOWER($1) || '%'
 GROUP BY sa2_code16, sa2_name
 ORDER BY sa2_name
LIMIT 10
`;

const streetSearch = `
-- name: streetSearch
SELECT s.street_id,
       s.road_name,
       s.road_type,
       s.locality_name,
       RTRIM(smb.mb_code16) AS mb_code16,
       smb.n_addresses,
       RTRIM(m.sa2_code16) AS sa2_code16
  FROM street s
  JOIN street_mesh_block smb ON smb.street_id = s.street_id
  JOIN mesh_block m ON m.mb_code16 = smb.mb_code16
 WHERE (LOWER(s.road_name || ' ' || s.road_type) LIKE LOWER($1) || '%'
     OR LOWER(s.road_name || ' ' || s.road_type) LIKE LOWER($3) || '%')
   AND LOWER(s.locality_name) = LOWER($2)
 ORDER BY s.road_name, smb.mb_code16
`;

const mapSuburbs = `
-- name: mapSuburbs
SELECT RTRIM(m.sa2_code16) AS sa2_code16,
       m.sa2_name,
       MIN(m.lga_name) AS lga_name,
       COUNT(*)::integer AS n_blocks,
       ROUND(AVG(m.uhi_mean)::numeric, 2) AS uhi_mean,
       ROUND(AVG(m.canopy_pct)::numeric, 2) AS canopy_mean,
       ST_AsGeoJSON(s.geom, 6) AS geometry
  FROM mesh_block m
  JOIN map_suburb_geometry s ON s.sa2_code16 = m.sa2_code16
 GROUP BY m.sa2_code16, m.sa2_name, s.geom
 ORDER BY m.sa2_name
`;

const mapMeshblocksBySuburb = `
-- name: mapMeshblocksBySuburb
SELECT RTRIM(m.mb_code16) AS mb_code16,
       RTRIM(m.sa2_code16) AS sa2_code16,
       m.sa2_name,
       m.lga_name,
       m.uhi_mean,
       m.canopy_pct,
       m.mb_category,
       m.persons,
       ST_AsGeoJSON(
         ST_SimplifyPreserveTopology(g.geom, 0.00001),
         6
       ) AS geometry
  FROM mesh_block m
  JOIN mesh_block_geometry g USING (mb_code16)
 WHERE m.sa2_code16 = $1
 ORDER BY m.mb_code16
`;

module.exports = {
  bootstrapConfig,
  bootstrapModel,
  bootstrapProjections,
  meshblocksAll,
  meshblocksByLga,
  blockByCode,
  blockComparisons,
  blockCoolest,
  blockProjections,
  areaByKey,
  searchSuburbs,
  streetSearch,
  mapSuburbs,
  mapMeshblocksBySuburb,
};