const { readExport, validateDatabaseBlocks } = require("./simulatorExport");

async function importSimulator(pool, file) {
  const { blocks, metadata, releaseId } = readExport(file);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize importers and prevent seed changes during the baseline check.
    await client.query("SELECT pg_advisory_xact_lock(5120, 3)");
    await client.query("LOCK TABLE mesh_block IN SHARE MODE");
    const { rows } = await client.query("SELECT mb_code16, uhi_mean, canopy_pct, area_sqkm FROM mesh_block");
    validateDatabaseBlocks(blocks, rows);
    const inserted = await client.query(`INSERT INTO simulator_release (release_id, metadata, block_count)
      VALUES ($1, $2::jsonb, $3) ON CONFLICT (release_id) DO NOTHING RETURNING release_id`,
    [releaseId, JSON.stringify(metadata), blocks.length]);
    if (inserted.rows.length) {
      for (let i = 0; i < blocks.length; i += 500) {
        await client.query(`INSERT INTO simulator_block (release_id, mb_code16, payload)
          SELECT $1, item->>'mb_code16', item FROM jsonb_array_elements($2::jsonb) item`,
        [releaseId, JSON.stringify(blocks.slice(i, i + 500))]);
      }
    }
    const count = await client.query("SELECT count(*)::int AS count FROM simulator_block WHERE release_id = $1", [releaseId]);
    if (count.rows[0].count !== blocks.length) throw new Error("Simulator release is incomplete; activation cancelled.");
    await client.query(`INSERT INTO simulator_active (singleton, release_id) VALUES (TRUE, $1)
      ON CONFLICT (singleton) DO UPDATE SET release_id = EXCLUDED.release_id`, [releaseId]);
    await client.query("COMMIT");
    return { release_id: releaseId, block_count: blocks.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(args) {
  const dryRun = args.includes("--dry-run");
  const files = args.filter((arg) => arg !== "--dry-run");
  if (files.length !== 1 || files[0].startsWith("--")) {
    throw new Error("Usage: npm run simulator:import -- <simulator_scenarios.json> [--dry-run]");
  }
  if (dryRun) {
    const { releaseId, blocks } = readExport(files[0]);
    console.log(JSON.stringify({ release_id: releaseId, block_count: blocks.length, validation: "file_only", database_checked: false }));
    return;
  }
  const pool = require("./pool");
  try {
    console.log(JSON.stringify(await importSimulator(pool, files[0])));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { importSimulator, main };
