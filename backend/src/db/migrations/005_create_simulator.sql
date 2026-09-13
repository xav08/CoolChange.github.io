-- Separate screened scenario payloads from the existing global OLS model.
CREATE TABLE simulator_release (
    release_id TEXT PRIMARY KEY CHECK (release_id ~ '^[0-9a-f]{64}$'),
    metadata JSONB NOT NULL CHECK (metadata->>'schema_version' = '3'),
    block_count INTEGER NOT NULL CHECK (block_count > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE simulator_block (
    release_id TEXT NOT NULL REFERENCES simulator_release(release_id),
    mb_code16 CHAR(11) NOT NULL REFERENCES mesh_block(mb_code16),
    payload JSONB NOT NULL,
    PRIMARY KEY (release_id, mb_code16),
    CHECK (payload->>'mb_code16' = RTRIM(mb_code16))
);

-- One pointer makes a complete release visible atomically. Keep old releases.
CREATE TABLE simulator_active (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    release_id TEXT NOT NULL REFERENCES simulator_release(release_id)
);
