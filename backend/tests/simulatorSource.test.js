const { readSimulatorSource, DEFAULT_SIMULATOR_URL } = require("../src/db/simulatorSource");
const { parseExport } = require("../src/db/simulatorExport");
const fixture = require("./fixtures/simulator-uncertainty-v1.json");
const bytes = Buffer.from(JSON.stringify(fixture));
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

test("defaults to the requested S3 object and validates its exact contents", async () => {
  global.fetch = jest.fn(async () => new Response(bytes));
  const result = await readSimulatorSource();
  expect(global.fetch).toHaveBeenCalledWith(DEFAULT_SIMULATOR_URL, expect.objectContaining({ redirect: "error" }));
  expect(result.releaseId).toBe(parseExport(bytes).releaseId);
  expect(result.blocks).toEqual(fixture.blocks);
  expect(result.metadata.source_url).toBe(DEFAULT_SIMULATOR_URL);
  expect(result.metadata.uncertainty).toEqual(fixture.uncertainty);
});

test("rejects failed downloads before any import", async () => {
  global.fetch = jest.fn(async () => new Response("Forbidden", { status: 403 }));
  await expect(readSimulatorSource()).rejects.toThrow("HTTP 403");
});

test("rejects malformed or unsupported model data", async () => {
  global.fetch = jest.fn(async () => new Response('{"schema_version":1}'));
  await expect(readSimulatorSource()).rejects.toThrow("Invalid simulator export");
});

test("rejects unencrypted URLs", async () => {
  global.fetch = jest.fn();
  await expect(readSimulatorSource("http://example.com/model.json")).rejects.toThrow("HTTPS");
  expect(global.fetch).not.toHaveBeenCalled();
});
