const pool = require("../db/pool");
const { ApiError } = require("../http/errors");
const { plantingModel } = require("./plantingModel");

async function getSimulatorMetadata() {
  const { rows } = await pool.query(`
    -- name: simulatorMetadata
    SELECT r.release_id, r.metadata
      FROM simulator_active a JOIN simulator_release r USING (release_id)
     WHERE a.singleton`);
  if (!rows.length) return null;
  return { ...rows[0].metadata, release_id: rows[0].release_id };
}

async function getBlockSimulator(code, baseline) {
  // Read the pointer, metadata and block in one statement/snapshot.
  const { rows } = await pool.query(`
    -- name: simulatorBlock
    SELECT r.release_id, r.metadata, b.payload
      FROM simulator_active a JOIN simulator_release r USING (release_id)
      LEFT JOIN simulator_block b ON b.release_id = r.release_id AND b.mb_code16 = $1
     WHERE a.singleton`, [code]);
  if (!rows.length) return null;
  const { release_id, metadata, payload } = rows[0];
  if (!payload) {
    throw new ApiError(503, "SIMULATOR_UNAVAILABLE", "Active simulator release is missing this block.");
  }
  const result = { ...payload, release_id, schema_version: metadata.schema_version, inputs: metadata.inputs };
  if (!baseline) return result;
  let donor = null;
  const t = payload.tree_planting;
  if (payload.status !== "indicative" || baseline.canopy_pct < t.local_canopy_min_pct - 1e-5 ||
    baseline.canopy_pct > t.local_canopy_max_pct + 1e-5) {
    // Resolve once on block selection, never on slider movement. Pin both queries
    // to the release already read, even if a new export is activated meanwhile.
    for (const adjacent of [true, false]) {
      const { rows: candidates } = await pool.query(`
        -- name: simulatorNeighbor
        SELECT b.payload
          FROM mesh_block_geometry target
          JOIN mesh_block_geometry g ON g.mb_code16 <> target.mb_code16
          JOIN simulator_block b ON b.mb_code16 = g.mb_code16 AND b.release_id = $2
         WHERE target.mb_code16 = $1
           ${adjacent ? "AND ST_Touches(target.geom, g.geom)" : ""}
           AND b.payload->>'status' = 'indicative'
           AND (b.payload#>>'{tree_planting,simulation_slope}')::double precision < 0
           AND (b.payload#>>'{tree_planting,local_canopy_min_pct}')::double precision <= $3 + 0.00001
           AND (b.payload#>>'{tree_planting,local_canopy_max_pct}')::double precision >= $3
         ORDER BY ST_Distance(ST_Centroid(target.geom)::geography, ST_Centroid(g.geom)::geography), g.mb_code16
         LIMIT 1`, [code, release_id, baseline.canopy_pct]);
      if (candidates.length) {
        donor = { ...candidates[0], adjacent };
        break;
      }
    }
  }
  return { ...result, interactive: plantingModel(payload, metadata, baseline, donor) };
}

module.exports = { getSimulatorMetadata, getBlockSimulator };
