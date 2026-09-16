const { readExport, parseExport } = require("./simulatorExport");

const DEFAULT_SIMULATOR_URL = "https://coolchange-model-transfer-yipu-20260914.s3.ap-southeast-4.amazonaws.com/simulator_scenarios.json";
const MAX_BYTES = 150 * 1024 * 1024;

// Download at import time only. Block selection and slider changes never fetch S3.
async function readSimulatorSource(source = DEFAULT_SIMULATOR_URL) {
  if (!/^https?:\/\//i.test(source)) return readExport(source);
  if (new URL(source).protocol !== "https:") throw new Error("Simulator downloads require HTTPS.");
  const response = await fetch(source, { signal: AbortSignal.timeout(120000), redirect: "error" });
  if (!response.ok) throw new Error(`Simulator download failed (HTTP ${response.status}).`);
  if (!response.body) throw new Error("Simulator download has no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Simulator download exceeds 150 MB.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = parseExport(Buffer.concat(chunks));
  return { ...result, metadata: { ...result.metadata, source_url: source } };
}

module.exports = { DEFAULT_SIMULATOR_URL, readSimulatorSource };
