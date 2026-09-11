-- =============================================================================
-- 004_create_street_mesh_block.sql  --  Street-level search (E1, US1.3)
--
-- Author: Savio. Companion doc: e1-street-search-log (VicMap Address pipeline
-- decisions, to be published as a README once the data phase closes out).
--
-- Source data: VicMap Address (D5), filtered to our 54,239 study-area mesh
-- blocks and collapsed from individual address points to street grain by
-- data-pipeline/05_build_street_mesh_block.py. 45,866 of our 54,239 blocks
-- have at least one street; the remaining 8,373 are a documented 2016
-- mesh-block-vintage gap (new ABS blocks in outer growth corridors that
-- postdate this schema's 2016 geography) -- AC 1.3.3's "no results" response
-- covers a search landing on one of those blocks correctly.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- street -- one row per distinct (road_name, road_type, locality_name).
-- Expect 59,032 rows.
-- -----------------------------------------------------------------------------
CREATE TABLE street (
    street_id      SERIAL       PRIMARY KEY,
    road_name      VARCHAR(45)  NOT NULL,
    road_type      VARCHAR(15)  NOT NULL DEFAULT '',
    locality_name  VARCHAR(46)  NOT NULL,

    CONSTRAINT ux_street_name
        UNIQUE (road_name, road_type, locality_name)
);

COMMENT ON TABLE street IS
    'Distinct streets from VicMap Address, restricted to streets with at '
    'least one address in one of our 54,239 study-area mesh blocks. 59,032 '
    'rows.';

COMMENT ON COLUMN street.road_type IS
    'Empty string, never NULL, when VicMap has no type for this road name '
    '(e.g. "Broadway", "The Boulevard" -- the type is baked into the name or '
    'genuinely absent). Postgres treats every NULL as distinct from every '
    'other NULL, which would let duplicate streets through ux_street_name on '
    'a reseed -- normalised to '''' at build time specifically so this '
    'constraint catches real duplicates.';

-- Street search (US1.3, AC 1.3.1). Suburb is an exact match, road name a
-- prefix match, both lowercased -- same pattern as
-- ix_mesh_block_sa2_name_lower for suburb search.
CREATE INDEX ix_street_search
    ON street (LOWER(locality_name), LOWER(road_name) varchar_pattern_ops);


-- -----------------------------------------------------------------------------
-- street_mesh_block -- which mesh block(s) each street touches.
-- Expect 158,278 rows. A street spanning multiple blocks gets one row per
-- block (AC 1.3.2/1.3.4 -- the API returns every match, and n_addresses lets
-- the front end judge which block a resident most likely meant).
-- -----------------------------------------------------------------------------
CREATE TABLE street_mesh_block (
    street_id    INTEGER   NOT NULL REFERENCES street (street_id) ON DELETE CASCADE,
    mb_code16    CHAR(11)  NOT NULL REFERENCES mesh_block (mb_code16) ON DELETE CASCADE,
    n_addresses  INTEGER   NOT NULL,

    PRIMARY KEY (street_id, mb_code16),

    CONSTRAINT ck_street_mesh_block_n_addresses
        CHECK (n_addresses > 0)
);

COMMENT ON TABLE street_mesh_block IS
    'Junction: which mesh block(s) a street touches. 158,278 rows over '
    '59,032 streets and 45,866 blocks -- most streets sit in exactly one '
    'block, but a street spanning a block boundary gets one row per block it '
    'touches.';

COMMENT ON COLUMN street_mesh_block.n_addresses IS
    'Count of VicMap address points for this street that fall in this '
    'specific block. A confidence signal for AC 1.3.4''s disambiguation UI '
    'when a street returns multiple blocks -- not a precise address count '
    '(collapsed from individual house numbers, not unit-level).';

-- Reverse lookup (which streets touch a given block) and keeps the
-- mesh_block -> street_mesh_block CASCADE from needing a full table scan.
CREATE INDEX ix_street_mesh_block_mb_code16 ON street_mesh_block (mb_code16);
