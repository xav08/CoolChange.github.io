// Read-only integration verification against the local Docker database.
// Usage: npm run simulator:verify -- /absolute/path/to/simulator_scenarios.json
const assert = require("node:assert/strict");
process.env.DATABASE_URL ||= "postgres://coolchange:coolchange@localhost:5433/coolchange";
const target = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(target.hostname) && target.port === "5433" &&
  target.pathname === "/coolchange", "Verification is restricted to local Docker coolchange on port 5433");
process.env.DATABASE_SSL = "false";
process.env.PGOPTIONS = "-c default_transaction_read_only=on";
const { readExport, validateDatabaseBlocks } = require("../src/db/simulatorExport");
const pool = require("../src/db/pool");
const app = require("../src/index");

async function verify(file) {
  assert.ok(file, "Pass the full simulator_scenarios.json path");
  const { blocks, metadata, releaseId } = readExport(file);
  let server;
  try {
    const baseline = await pool.query("SELECT mb_code16, uhi_mean, canopy_pct, area_sqkm FROM mesh_block");
    validateDatabaseBlocks(blocks, baseline.rows);
    const release = await pool.query(`SELECT r.release_id, r.metadata, r.block_count
      FROM simulator_active a JOIN simulator_release r USING (release_id) WHERE a.singleton`);
    assert.deepEqual(release.rows, [{ release_id: releaseId, metadata, block_count: blocks.length }]);
    const count = await pool.query("SELECT count(*)::int AS n FROM simulator_block WHERE release_id = $1", [releaseId]);
    assert.equal(count.rows[0].n, blocks.length);
    for (let i = 0; i < blocks.length; i += 1000) {
      const batch = blocks.slice(i, i + 1000);
      const { rows } = await pool.query(`SELECT payload FROM simulator_block
        WHERE release_id = $1 AND mb_code16 = ANY($2::bpchar[])`, [releaseId, batch.map(b => b.mb_code16)]);
      const stored = new Map(rows.map(r => [r.payload.mb_code16, r.payload]));
      for (const block of batch) assert.deepEqual(stored.get(block.mb_code16), block, block.mb_code16);
    }
    console.log(`PASS full database/export equality: ${blocks.length} blocks, ${blocks.length * 4} scenarios`);
    server = await new Promise(resolve => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const get = async (path, status = 200) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
      assert.equal(response.status, status, path);
      return response.json();
    };
    const health = await get("/health/db");
    assert.equal(health.db, "connected");
    assert.ok(health.postgis);
    const bootstrap = await get("/api/v1/bootstrap");
    assert.deepEqual(bootstrap.simulator, { ...metadata, release_id: releaseId });
    assert.equal(bootstrap.n_blocks, blocks.length);
    const list = await get("/api/v1/meshblocks");
    assert.equal(list.count, blocks.length);
    console.log("PASS real HTTP health, bootstrap metadata and full meshblock list");

    const selected = new Set(["20631942810", "20046872000"]);
    for (const status of ["indicative", "unavailable"]) {
      const block = blocks.find(b => b.status === status);
      assert.ok(block, `Expected ${status} coverage`);
      selected.add(block.mb_code16);
    }
    const outside = blocks.find(b => b.status === "indicative" &&
      b.scenarios.some(s => s.status === "unavailable"));
    assert.ok(outside, "Expected out-of-range scenario coverage");
    selected.add(outside.mb_code16);
    const byCode = new Map(blocks.map(b => [b.mb_code16, b]));
    for (const code of selected) {
      const body = await get(`/api/v1/meshblocks/${code}`);
      assert.equal(body.block.mb_code16, code);
      assert.deepEqual(body.simulator, { ...byCode.get(code), release_id: releaseId,
        schema_version: metadata.schema_version, inputs: metadata.inputs });
    }
    console.log(`PASS ${selected.size} block HTTP responses: exact baselines, scenarios, nulls, reasons and limits`);

    // Regression: a published 15+ band has a legitimate null upper bound.
    // Only a missing projection row should use the city-wide fallback.
    const openRows = await pool.query(`SELECT DISTINCT ON (warming_level) mb_code16, warming_level
      FROM mesh_block_projection WHERE days_upper IS NULL ORDER BY warming_level, mb_code16`);
    assert.ok(openRows.rows.length);
    for (const row of openRows.rows) {
      const body = await get(`/api/v1/meshblocks/${row.mb_code16}`);
      const p = body.projections.find(p => p.warming_level === Number(row.warming_level));
      assert.equal(p.days_upper, null);
      assert.equal(p.is_fallback, false);
    }
    const missing = await pool.query(`SELECT mb_code16 FROM mesh_block m WHERE NOT EXISTS
      (SELECT 1 FROM mesh_block_projection p WHERE p.mb_code16 = m.mb_code16) ORDER BY mb_code16 LIMIT 1`);
    assert.ok(missing.rows.length);
    const fallback = await get(`/api/v1/meshblocks/${missing.rows[0].mb_code16}`);
    assert.deepEqual(fallback.projections, bootstrap.projections.map(p => ({ ...p, is_fallback: true })));
    const noSeifa = await pool.query("SELECT mb_code16 FROM mesh_block WHERE irsd_score IS NULL ORDER BY mb_code16 LIMIT 1");
    const equity = await get(`/api/v1/meshblocks/${noSeifa.rows[0].mb_code16}`);
    assert.equal(equity.block.irsd_score, null);
    await get("/api/v1/meshblocks/00000000000", 404);
    console.log("PASS open-ended projections, labelled fallback, missing SEIFA and unknown-block 404");
    console.log(JSON.stringify({ database: "localhost:5433/coolchange", release_id: releaseId,
      blocks: blocks.length, indicative: blocks.filter(b => b.status === "indicative").length,
      unavailable: blocks.filter(b => b.status === "unavailable").length }));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

verify(process.argv[2]).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
