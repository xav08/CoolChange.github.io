-- =============================================================================
-- queries.sql -- reference SQL for each API endpoint in the API contract.
--
-- These are NOT run by the app. They are the verified query for each endpoint,
-- so the backend has a known-correct starting point. Every one of them has been
-- executed against a fully loaded database.
--
-- Yipu: parameters are written as $1 in the style the pg driver expects.
-- =============================================================================


-- GET /api/v1/bootstrap ------------------------------------------------------
-- Three small reads. Cache the result in memory; it never changes at runtime.

SELECT key, value FROM app_config;

SELECT model_type, slope, intercept, pearson_r, r_squared, n_blocks
  FROM model_coefficient
 WHERE is_active AND scope_type = 'METRO';

SELECT warming_level, horizon_label, days_label, days_lower, days_upper
  FROM projection_metro
 ORDER BY warming_level;


-- GET /api/v1/meshblocks -----------------------------------------------------
-- The choropleth payload. Return as array-of-arrays, not array-of-objects:
-- at 54,239 rows the repeated key names roughly triple the response size.
-- Geometry is NOT here -- the front end joins it client-side on mb_code16.

SELECT mb_code16, uhi_mean, canopy_pct
  FROM mesh_block
 ORDER BY mb_code16;

-- optional filter
SELECT mb_code16, uhi_mean, canopy_pct
  FROM mesh_block
 WHERE lga_name = $1
 ORDER BY mb_code16;


-- GET /api/v1/meshblocks/:mb_code16 ------------------------------------------
-- The detail panel. US2.1.5 requires these values to match the database row
-- exactly, so nothing here is recomputed at request time.

-- 1. the block itself
SELECT mb_code16, sa1_code16, sa2_code16, sa2_name, sa3_code16, sa3_name,
       lga_name, uhi_mean, canopy_pct, grass_pct, shrub_pct, any_veg_pct,
       shrub_tree_pct, tree_03_10_pct, tree_10_15_pct, tree_15plus_pct,
       mb_category, dwellings, persons, area_sqkm, irsd_score, irsd_decile
  FROM mesh_block
 WHERE mb_code16 = $1;

-- 2. comparisons against its LGA and against metro, residential scope.
--    uhi_delta / canopy_delta are BLOCK MINUS AREA: positive uhi_delta means
--    hotter than the comparison. Keep that sign convention in the UI copy.
SELECT b.area_type, b.area_name, b.scope, b.uhi_mean, b.canopy_mean,
       round((m.uhi_mean   - b.uhi_mean)::numeric,   2) AS uhi_delta,
       round((m.canopy_pct - b.canopy_mean)::numeric, 2) AS canopy_delta
  FROM mesh_block m
  JOIN area_baseline b
    ON b.scope = 'RESIDENTIAL'
   AND ( (b.area_type = 'LGA'   AND b.area_code = m.lga_name)
      OR (b.area_type = 'METRO' AND b.area_code = 'METRO') )
 WHERE m.mb_code16 = $1;

-- 3. coolest block in the same council area.
--    WARNING for the UI: the coolest block does not always have more canopy.
--    In Wyndham it has less (3.96% vs 4.74%) yet runs 8.3 C cooler. Do not
--    write copy implying the coolest block is cooler BECAUSE of its trees.
SELECT b.coolest_mb_code, b.coolest_uhi, b.coolest_canopy_pct
  FROM mesh_block m
  JOIN area_baseline b
    ON b.area_type = 'LGA' AND b.scope = 'RESIDENTIAL' AND b.area_code = m.lga_name
 WHERE m.mb_code16 = $1;

-- 4. projections for this block, with the US3.2.5 fallback built in.
--    A block outside every ACS polygon (3,106 coastal blocks) gets the
--    city-wide figure and is_fallback = true. The UI must then say the number
--    is for Melbourne as a whole, not for this block.
SELECT pm.warming_level,
       pm.horizon_label,
       COALESCE(p.days_label, pm.days_label) AS days_label,
       COALESCE(p.days_lower, pm.days_lower) AS days_lower,
       COALESCE(p.days_upper, pm.days_upper) AS days_upper,
       (p.mb_code16 IS NULL)                 AS is_fallback
  FROM projection_metro pm
  LEFT JOIN mesh_block_projection p
    ON p.warming_level = pm.warming_level AND p.mb_code16 = $1
 ORDER BY pm.warming_level;


-- GET /api/v1/areas/:area_type/:area_code ------------------------------------
SELECT area_type, area_code, area_name, scope, n_blocks,
       uhi_mean, uhi_p10, uhi_p90, canopy_mean, canopy_p10, canopy_p90,
       coolest_mb_code, coolest_uhi, coolest_canopy_pct
  FROM area_baseline
 WHERE area_type = $1 AND area_code = $2 AND scope = COALESCE($3, 'RESIDENTIAL');


-- GET /api/v1/search?q= ------------------------------------------------------
-- Suburb search only. There is NO postcode field in any source dataset --
-- see the open issue in the API contract before wiring US1.2.1.
-- The LOWER(sa2_name) index makes this a prefix scan.
SELECT sa2_code16, sa2_name, min(lga_name) AS lga_name, count(*) AS n_blocks
  FROM mesh_block
 WHERE LOWER(sa2_name) LIKE LOWER($1) || '%'
 GROUP BY sa2_code16, sa2_name
 ORDER BY sa2_name
 LIMIT 10;


-- GET /api/v1/street-search?street=&suburb= --------------------------------
-- US1.3, AC 1.3.1-1.3.4. Suburb is an exact match, street name a prefix match,
-- both lowercased -- same style as suburb search. Returns every matching
-- block (AC 1.3.2), each with its address count as a disambiguation signal
-- for the frontend (AC 1.3.4). Zero rows is a normal, successful empty
-- result, not an error -- that's AC 1.3.3, handled at the API layer, not here.
SELECT s.street_id, s.road_name, s.road_type, s.locality_name,
       smb.mb_code16, smb.n_addresses
  FROM street s
  JOIN street_mesh_block smb ON smb.street_id = s.street_id
 WHERE LOWER(s.road_name) LIKE LOWER($1) || '%'
   AND LOWER(s.locality_name) = LOWER($2)
 ORDER BY s.road_name, smb.mb_code16;


-- Optional: which block contains this point? -------------------------------
-- Only works once mesh_block_geometry is populated. This is the one thing
-- PostGIS is needed for; everything else above is plain SQL.
SELECT mb_code16
  FROM mesh_block_geometry
 WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
 LIMIT 1;