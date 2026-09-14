-- =============================================================================
-- load_seeds.sql -- loads the pipeline output into the Cool Change database.
--
-- Run AFTER `npm run migrate`, from THIS directory so the relative paths
-- resolve:
--
--     cd backend/src/db/seeds
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f load_seeds.sql
--
-- Safe to re-run: every table is truncated first, so this is a full reload
-- rather than an append. Wrapped in one transaction -- if any file fails,
-- nothing changes.
--
-- The CSVs are produced by data-pipeline/02_build_mesh_block.py,
-- data-pipeline/03_build_projections.py, and
-- data-pipeline/05_build_street_mesh_block.py. Do not hand-edit them.
-- =============================================================================

BEGIN;

-- A full seed reload invalidates previously imported simulator releases.
-- This also works before migration 005 has been applied.
DO $$
BEGIN
    IF to_regclass('simulator_release') IS NOT NULL THEN
        TRUNCATE simulator_active, simulator_block, simulator_release;
    END IF;
END $$;

-- Reverse dependency order: children first.
TRUNCATE street_mesh_block, mesh_block_projection, area_baseline, model_coefficient, street, mesh_block
    RESTART IDENTITY CASCADE;

-- Empty CSV fields mean NULL. This matters for irsd_score / irsd_decile,
-- which are legitimately absent for 1,477 blocks, and for days_upper on the
-- open-ended "15+" band.

\echo '-> mesh_block (expect 54,239 rows)'
\copy mesh_block (mb_code16, sa1_code16, sa2_code16, sa2_name, sa3_code16, sa3_name, lga_name, uhi_mean, canopy_pct, grass_pct, shrub_pct, any_veg_pct, shrub_tree_pct, tree_03_10_pct, tree_10_15_pct, tree_15plus_pct, mb_category, dwellings, persons, area_sqkm, irsd_score, irsd_decile) FROM 'mesh_block.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo '-> street (expect 65,015 rows)'
\copy street (street_id, road_name, road_type, locality_name) FROM 'street.csv' WITH (FORMAT csv, HEADER true, NULL '', FORCE_NOT_NULL (road_type))

\echo '-> street_mesh_block (expect 178,762 rows)'
\copy street_mesh_block (street_id, mb_code16, n_addresses) FROM 'street_mesh_block.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo '-> area_baseline (expect 744 rows)'
\copy area_baseline (area_type, area_code, area_name, scope, n_blocks, uhi_mean, uhi_p10, uhi_p90, canopy_mean, canopy_p10, canopy_p90, coolest_mb_code, coolest_uhi, coolest_canopy_pct) FROM 'area_baseline.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo '-> mesh_block_projection (expect 204,532 rows)'
\copy mesh_block_projection (mb_code16, warming_level, days_label, days_lower, days_upper) FROM 'mesh_block_projection.csv' WITH (FORMAT csv, HEADER true, NULL '')

\echo '-> model_coefficient (expect 1 row)'
\copy model_coefficient (model_type, scope_type, scope_code, slope, intercept, pearson_r, r_squared, n_blocks, is_active, notes) FROM 'model_coefficient.csv' WITH (FORMAT csv, HEADER true, NULL '')

-- ---------------------------------------------------------------------------
-- Post-load assertions. Any failure aborts the transaction, so a bad load
-- can never be left half-applied in the database.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    n_blocks     INT;
    n_no_seifa   INT;
    n_proj       INT;
    n_covered    INT;
    n_street     INT;
    n_smb        INT;
    n_smb_blocks INT;
    total_people INT;
    fitted_slope REAL;
BEGIN
    SELECT count(*) INTO n_blocks FROM mesh_block;
    IF n_blocks <> 54239 THEN
        RAISE EXCEPTION 'mesh_block has % rows, expected 54,239', n_blocks;
    END IF;

    SELECT count(*) INTO n_no_seifa FROM mesh_block WHERE irsd_score IS NULL;
    IF n_no_seifa <> 1477 THEN
        RAISE EXCEPTION 'mesh_block has % rows without SEIFA, expected 1,477 '
                        '(0 would mean NULLs were silently filled)', n_no_seifa;
    END IF;

    SELECT sum(persons) INTO total_people FROM mesh_block;
    IF total_people <> 4345097 THEN
        RAISE EXCEPTION 'persons sums to %, expected 4,345,097', total_people;
    END IF;

    SELECT count(*), count(DISTINCT mb_code16) INTO n_proj, n_covered
      FROM mesh_block_projection;
    IF n_proj <> 204532 OR n_covered <> 51133 THEN
        RAISE EXCEPTION 'mesh_block_projection has % rows over % blocks, '
                        'expected 204,532 over 51,133', n_proj, n_covered;
    END IF;

    SELECT count(*) INTO n_street FROM street;
    IF n_street <> 65015 THEN
        RAISE EXCEPTION 'street has % rows, expected 65,015', n_street;
    END IF;

    SELECT count(*), count(DISTINCT mb_code16) INTO n_smb, n_smb_blocks
      FROM street_mesh_block;
    IF n_smb <> 178762 OR n_smb_blocks <> 52071 THEN
        RAISE EXCEPTION 'street_mesh_block has % rows over % blocks, '
                        'expected 178,762 over 52,071 (52,071 of our 54,239 '
                        'study-area blocks have at least one street -- the '
                        'other 2,168 are addressless per this dataset; the '
                        'spatial-join reconciliation fixed the previous '
                        'vintage-mismatch gap of 8,373, not a load failure)',
                        n_smb, n_smb_blocks;
    END IF;

    SELECT slope INTO fitted_slope
      FROM model_coefficient WHERE is_active AND scope_type = 'METRO';
    IF fitted_slope IS NULL OR fitted_slope > -0.10 OR fitted_slope < -0.15 THEN
        RAISE EXCEPTION 'active METRO slope is %, expected about -0.1229 '
                        '(published benchmark -0.1274)', fitted_slope;
    END IF;

    RAISE NOTICE 'All post-load assertions passed.';
END
$$;

COMMIT;

-- Empty until the first refresh: the view is created at migrate time
-- when mesh_block has no rows yet.
REFRESH MATERIALIZED VIEW equity_by_decile;

\echo ''
\echo 'Loaded. Summary:'
SELECT 'mesh_block'            AS table_name, count(*) AS rows FROM mesh_block
UNION ALL SELECT 'mesh_block_projection', count(*) FROM mesh_block_projection
UNION ALL SELECT 'area_baseline',         count(*) FROM area_baseline
UNION ALL SELECT 'model_coefficient',     count(*) FROM model_coefficient
UNION ALL SELECT 'street',                 count(*) FROM street
UNION ALL SELECT 'street_mesh_block',      count(*) FROM street_mesh_block
UNION ALL SELECT 'projection_metro',      count(*) FROM projection_metro
UNION ALL SELECT 'app_config',            count(*) FROM app_config
ORDER BY 1;