const path = require("node:path");
const { readSimulatorSource, DEFAULT_SIMULATOR_FILE } = require("../src/db/simulatorSource");
jest.mock("../src/db/simulatorExport", () => ({ readExport: jest.fn() }));
const { readExport } = require("../src/db/simulatorExport");

beforeEach(() => jest.clearAllMocks());

test("defaults to the local GWR file independently of the working directory", async () => {
  readExport.mockReturnValue({ releaseId: "local" });
  expect(DEFAULT_SIMULATOR_FILE).toBe(path.resolve(__dirname, "../src/db/GWR/simulator_scenarios 2.json"));
  await expect(readSimulatorSource()).resolves.toEqual({ releaseId: "local" });
  expect(readExport).toHaveBeenCalledWith(DEFAULT_SIMULATOR_FILE);
});

test("accepts an explicitly selected local file", async () => {
  await readSimulatorSource("another-model.json");
  expect(readExport).toHaveBeenCalledWith("another-model.json");
});

test.each(["https://example.com/model.json", "s3://bucket/model.json"])("rejects remote source %s", async source => {
  await expect(readSimulatorSource(source)).rejects.toThrow("local JSON file");
  expect(readExport).not.toHaveBeenCalled();
});
