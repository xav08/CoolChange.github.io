const path = require("node:path");
const { readExport } = require("./simulatorExport");

const DEFAULT_SIMULATOR_FILE = path.join(__dirname, "GWR", "simulator_scenarios 2.json");

// Import a local file once; requests and slider changes use the stored model.
async function readSimulatorSource(source = DEFAULT_SIMULATOR_FILE) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
    throw new Error("Simulator imports require a local JSON file, not a remote URL.");
  }
  return readExport(source);
}

module.exports = { DEFAULT_SIMULATOR_FILE, readSimulatorSource };
