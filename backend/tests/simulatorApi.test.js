jest.mock("../src/db/pool", () => ({ query: jest.fn() }));
const request = require("supertest");
const pool = require("../src/db/pool");
const app = require("../src/index");
const { resetBootstrapCache } = require("../src/services/readApi");
const { blocks, ...metadata } = require("./fixtures/simulator-v3.json");
const { getSimulatorMetadata, getBlockSimulator } = require("../src/services/simulator");
let releaseId;
let loaded;

beforeEach(() => {
  releaseId = "a".repeat(64);
  loaded = true;
  resetBootstrapCache();
  pool.query.mockReset().mockImplementation(async (sql, params) => {
    let rows = [];
    if (sql.includes("bootstrapModel")) rows = [{ model_type: "OLS_GLOBAL", slope: -0.1229, intercept: 10.0507, n_blocks: 54239 }];
    if (sql.includes("bootstrapProjections") || sql.includes("blockProjections")) rows = [{ warming_level: 1.2, days_lower: 5, days_upper: 10 }];
    if (sql.includes("simulatorMetadata") && loaded) rows = [{ release_id: releaseId, metadata }];
    if (sql.includes("blockByCode")) {
      const b = blocks.find((b) => b.mb_code16 === params[0]);
      if (b) rows = [{ mb_code16: b.mb_code16, uhi_mean: b.observed_uhi, canopy_pct: b.observed_canopy_pct, persons: 1, area_sqkm: b.tree_planting.area_m2 / 1e6 }];
    }
    if (sql.includes("simulatorBlock") && loaded) {
      rows = [{ release_id: releaseId, metadata, payload: blocks.find((b) => b.mb_code16 === params[0]) || null }];
    }
    return { rows };
  });
});

test("bootstrap keeps global OLS and exposes metadata without the full block dataset", async () => {
  const response = await request(app).get("/api/v1/bootstrap");
  expect(response.status).toBe(200);
  expect(response.body.simulator).toEqual({ ...metadata, release_id: releaseId });
  expect(response.body.simulator.blocks).toBeUndefined();
  expect(JSON.stringify(response.body)).toContain("OLS_GLOBAL");
});

test("bootstrap's legacy cache does not hide release activation", async () => {
  loaded = false;
  expect((await request(app).get("/api/v1/bootstrap")).body.simulator).toBeNull();
  loaded = true;
  const first = await request(app).get("/api/v1/bootstrap");
  releaseId = "b".repeat(64);
  const second = await request(app).get("/api/v1/bootstrap");
  expect(second.body.simulator.release_id).not.toBe(first.body.simulator.release_id);
  expect(second.body.simulator.release_id).toBe(releaseId);
  expect(pool.query.mock.calls.filter(([s]) => s.includes("bootstrapModel"))).toHaveLength(1);
});

test.each(blocks)("serves exact screened data for $mb_code16 with release identifiers", async (block) => {
  const response = await request(app).get(`/api/v1/meshblocks/${block.mb_code16}`);
  expect(response.status).toBe(200);
  expect(response.body.simulator).toEqual({ ...block, release_id: releaseId, schema_version: 3, inputs: metadata.inputs });
  expect(response.body.block.mb_code16).toBe(block.mb_code16);
  if (block.status === "unavailable") {
    expect(response.body.simulator.scenarios[1].cooling_c).toBeNull();
    expect(response.body.simulator.tree_planting.simulation_slope).toBeNull();
  }
});

test("no active release is distinct from an unreliable block", async () => {
  loaded = false;
  expect(await getSimulatorMetadata()).toBeNull();
  expect(await getBlockSimulator(blocks[0].mb_code16)).toBeNull();
});

test("an incomplete active release returns a service error", async () => {
  await expect(getBlockSimulator("00000000000")).rejects.toMatchObject({ status: 503, code: "SIMULATOR_UNAVAILABLE" });
});

test("database errors are propagated rather than disguised as no estimate", async () => {
  pool.query.mockRejectedValue(new Error("database disconnected"));
  await expect(getSimulatorMetadata()).rejects.toThrow("database disconnected");
  await expect(getBlockSimulator(blocks[0].mb_code16)).rejects.toThrow("database disconnected");
});

test('HTTP exposes uncertainty metadata and preserves signed bounds and nulls', async () => {
  const { blocks: sample, ...meta } = require('./helpers/uncertaintyFixture')();
  const previous = pool.query.getMockImplementation();
  pool.query.mockImplementation(async (sql, params) => {
    if (sql.includes('simulatorMetadata')) return { rows: [{ release_id: releaseId, metadata: meta }] };
    if (sql.includes('simulatorBlock')) return { rows: [{ release_id: releaseId, metadata: meta,
      payload: sample.find(b => b.mb_code16 === params[0]) }] };
    return previous(sql, params);
  });
  const bootstrap = await request(app).get('/api/v1/bootstrap');
  expect(bootstrap.status).toBe(200);
  expect(bootstrap.body.simulator.uncertainty).toEqual(meta.uncertainty);
  for (const block of sample) {
    const response = await request(app).get(`/api/v1/meshblocks/${block.mb_code16}`);
    expect(response.status).toBe(200);
    expect(response.body.simulator).toEqual({ ...block, release_id: releaseId, schema_version: 3,
      inputs: meta.inputs, uncertainty: meta.uncertainty });
  }
});
