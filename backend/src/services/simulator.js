const pool = require("../db/pool");
const { ApiError } = require("../http/errors");

async function getSimulatorMetadata() {
  const { rows } = await pool.query(`
    -- name: simulatorMetadata
    SELECT r.release_id, r.metadata
      FROM simulator_active a JOIN simulator_release r USING (release_id)
     WHERE a.singleton`);
  if (!rows.length) return null;
  return { ...rows[0].metadata, release_id: rows[0].release_id };
}

async function getBlockSimulator(code) {
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
  return { ...payload, release_id, schema_version: metadata.schema_version, inputs: metadata.inputs,
    ...(metadata.uncertainty ? { uncertainty: metadata.uncertainty } : {}) };
}

module.exports = { getSimulatorMetadata, getBlockSimulator };
