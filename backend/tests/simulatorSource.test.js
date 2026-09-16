jest.mock("@aws-sdk/client-s3", () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }));
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { readSimulatorSource, DEFAULT_SIMULATOR_URL } = require("../src/db/simulatorSource");
const { parseExport } = require("../src/db/simulatorExport");
const fixture = require("./fixtures/simulator-uncertainty-v1.json");
const bytes = Buffer.from(JSON.stringify(fixture));
const originalFetch = global.fetch;
let send;
let destroy;
beforeEach(() => {
  send = jest.fn(async () => ({ Body: { transformToWebStream: () => new Response(bytes).body } }));
  destroy = jest.fn();
  S3Client.mockImplementation(() => ({ send, destroy }));
  global.fetch = jest.fn();
});
afterEach(() => { global.fetch = originalFetch; });

test("defaults to the requested S3 object and validates its exact contents", async () => {
  const result = await readSimulatorSource();
  expect(S3Client).toHaveBeenCalledWith({ region: "ap-southeast-4" });
  expect(GetObjectCommand).toHaveBeenCalledWith({ Bucket: "coolchange-model-transfer-yipu-20260914", Key: "simulator_scenarios.json" });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalled();
  expect(result.releaseId).toBe(parseExport(bytes).releaseId);
  expect(result.blocks).toEqual(fixture.blocks);
  expect(result.metadata.source_url).toBe(DEFAULT_SIMULATOR_URL);
  expect(result.metadata.uncertainty).toEqual(fixture.uncertainty);
});

test("rejects failed downloads before any import", async () => {
  global.fetch = jest.fn(async () => new Response("Forbidden", { status: 403 }));
  await expect(readSimulatorSource("https://example.com/model.json")).rejects.toThrow("HTTP 403");
});

test("rejects malformed or unsupported model data", async () => {
  global.fetch = jest.fn(async () => new Response('{"schema_version":1}'));
  await expect(readSimulatorSource("https://example.com/model.json")).rejects.toThrow("Invalid simulator export");
});

test("strips temporary credentials from stored source metadata", async () => {
  global.fetch = jest.fn(async () => new Response(bytes));
  const source = `${DEFAULT_SIMULATOR_URL}?X-Amz-Security-Token=secret#fragment`;
  const result = await readSimulatorSource(source);
  expect(global.fetch).toHaveBeenCalledWith(source, expect.objectContaining({ redirect: "error" }));
  expect(result.metadata.source_url).toBe(DEFAULT_SIMULATOR_URL);
});

test("missing credentials explain sign-in without falling back to anonymous access", async () => {
  send.mockRejectedValue(Object.assign(new Error("missing"), { name: "CredentialsProviderError" }));
  await expect(readSimulatorSource()).rejects.toThrow("aws login --profile coolchange");
  expect(global.fetch).not.toHaveBeenCalled();
  expect(destroy).toHaveBeenCalled();
});

test("S3 permission errors leave the download failed and close the client", async () => {
  send.mockRejectedValue(Object.assign(new Error("Access denied"), { name: "AccessDenied" }));
  await expect(readSimulatorSource()).rejects.toThrow("Access denied");
  expect(destroy).toHaveBeenCalled();
});

test("oversized S3 bodies are cancelled", async () => {
  const cancel = jest.fn();
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(150 * 1024 * 1024 + 1)); }, cancel });
  send.mockResolvedValue({ Body: { transformToWebStream: () => body } });
  await expect(readSimulatorSource()).rejects.toThrow("exceeds 150 MB");
  expect(cancel).toHaveBeenCalled();
  expect(destroy).toHaveBeenCalled();
});

test("rejects unencrypted URLs", async () => {
  global.fetch = jest.fn();
  await expect(readSimulatorSource("http://example.com/model.json")).rejects.toThrow("HTTPS");
  expect(global.fetch).not.toHaveBeenCalled();
});
