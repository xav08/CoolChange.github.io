const { readExport, parseExport } = require("./simulatorExport");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const DEFAULT_SIMULATOR_URL = "https://coolchange-model-transfer-yipu-20260914.s3.ap-southeast-4.amazonaws.com/simulator_scenarios.json";
const MAX_BYTES = 150 * 1024 * 1024;

async function downloadPrivateModel() {
  // The SDK reads AWS_PROFILE and the user's AWS config/cache outside the repo.
  const client = new S3Client({ region: "ap-southeast-4" });
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: "coolchange-model-transfer-yipu-20260914",
      Key: "simulator_scenarios.json",
    }), { abortSignal: AbortSignal.timeout(120000) });
    if (!response.Body) throw new Error("Simulator download has no body.");
    return await readDownload(response.Body.transformToWebStream());
  } catch (error) {
    if (error.name === "CredentialsProviderError" || error.name === "TokenProviderError") {
      throw new Error("AWS sign-in is required. Run aws login --profile coolchange, then set AWS_PROFILE=coolchange and retry.");
    }
    throw error;
  } finally {
    client.destroy();
  }
}

// Download at import time only. Block selection and slider changes never fetch S3.
async function readSimulatorSource(source = DEFAULT_SIMULATOR_URL) {
  if (!/^https?:\/\//i.test(source)) return readExport(source);
  const url = new URL(source);
  if (url.protocol !== "https:") throw new Error("Simulator downloads require HTTPS.");
  let bytes;
  if (source === DEFAULT_SIMULATOR_URL) {
    bytes = await downloadPrivateModel();
  } else {
    bytes = await downloadHttps(source);
  }
  const result = parseExport(bytes);
  // Presigned URLs can contain temporary credentials. Record provenance only.
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  return { ...result, metadata: { ...result.metadata, source_url: url.toString() } };
}

async function downloadHttps(source) {
  const response = await fetch(source, { signal: AbortSignal.timeout(120000), redirect: "error" });
  if (!response.ok) throw new Error(`Simulator download failed (HTTP ${response.status}).`);
  if (!response.body) throw new Error("Simulator download has no body.");
  return readDownload(response.body);
}

async function readDownload(body) {
  const reader = body.getReader();
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
  return Buffer.concat(chunks);
}

module.exports = { DEFAULT_SIMULATOR_URL, readSimulatorSource };
