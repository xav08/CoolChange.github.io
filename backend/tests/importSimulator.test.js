const path = require("node:path");
const { importSimulator } = require("../src/db/importSimulator");
const fixture = require("./fixtures/simulator-v3.json");
const file = path.join(__dirname, "fixtures/simulator-v3.json");

function database({ failInsert = false, badBaseline = false, existing = false, incomplete = false } = {}) {
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (sql.startsWith("SELECT mb_code16")) return { rows: fixture.blocks.map((b) => ({
        mb_code16: b.mb_code16, uhi_mean: b.observed_uhi + (badBaseline ? 1 : 0),
        canopy_pct: b.observed_canopy_pct, area_sqkm: b.tree_planting.area_m2 / 1e6,
      })) };
      if (sql.startsWith("INSERT INTO simulator_release")) return { rows: existing ? [] : [{}] };
      if (sql.startsWith("INSERT INTO simulator_block") && failInsert) throw new Error("insert failed");
      if (sql.startsWith("SELECT count")) return { rows: [{ count: incomplete ? 0 : fixture.blocks.length }] };
      return { rows: [] };
    }),
  };
  return { client, pool: { connect: jest.fn(async () => client) } };
}

test("activates only after all payloads are inserted and counted, then commits", async () => {
  const { pool, client } = database();
  const result = await importSimulator(pool, file);
  expect(result.block_count).toBe(3);
  expect(result.release_id).toMatch(/^[0-9a-f]{64}$/);
  const calls = client.query.mock.calls;
  expect(calls[0][0]).toBe("BEGIN");
  expect(calls.at(-2)[0]).toContain("INSERT INTO simulator_active");
  expect(calls.at(-1)[0]).toBe("COMMIT");
  const payloads = JSON.parse(calls.find(([s]) => s.startsWith("INSERT INTO simulator_block"))[1][1]);
  expect(payloads).toEqual(fixture.blocks);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test.each([
  { failInsert: true }, { badBaseline: true }, { incomplete: true },
])("rolls back without activating on failure %j", async (options) => {
  const { pool, client } = database(options);
  await expect(importSimulator(pool, file)).rejects.toThrow();
  expect(client.query.mock.calls.at(-1)[0]).toBe("ROLLBACK");
  expect(client.query.mock.calls.some(([s]) => s.startsWith("INSERT INTO simulator_active"))).toBe(false);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test("re-imports identical content without duplicating payloads", async () => {
  const { pool, client } = database({ existing: true });
  await importSimulator(pool, file);
  expect(client.query.mock.calls.some(([s]) => s.startsWith("INSERT INTO simulator_block"))).toBe(false);
  expect(client.query.mock.calls.at(-1)[0]).toBe("COMMIT");
});
