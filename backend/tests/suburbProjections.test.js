jest.mock("../src/db/pool", () => ({ query: jest.fn() }));
const request = require("supertest");
const pool = require("../src/db/pool");
const app = require("../src/index");
const { resetProjectionCache } = require("../src/services/suburbProjections");

const bands = [
  { days_label: "1-5", days_lower: 1, days_upper: 5 },
  { days_label: "15+", days_lower: 15, days_upper: null },
  { days_label: "20-40", days_lower: 20, days_upper: 40 },
];
beforeEach(() => { pool.query.mockReset(); resetProjectionCache(); });
function successfulRead() {
  pool.query.mockImplementation(async sql => ({ rows: sql.includes("projectionBands") ? bands : [
    { sa2_code16: "206011106", warming_level: "2.0", ...bands[0], source_sa2_code16: "206011106" },
    { sa2_code16: "206011106", warming_level: "3.0", ...bands[1], source_sa2_code16: "206011106" },
    { sa2_code16: "206051130", warming_level: "3.0", ...bands[1], source_sa2_code16: "206011106" },
  ] }));
}
test("all levels share a global domain including classes outside the selected suburb", async () => {
  successfulRead();
  const response = await request(app).get("/api/v1/map/projections");
  expect(response.status).toBe(200);
  expect(response.body.scale).toEqual({ min: 1, max: 40 });
  expect(response.body.bands).toEqual(bands);
  expect(response.body.suburbs[1]).toMatchObject({ warming_level: 3, days_upper: null });
  expect(response.body.suburbs[2].source_sa2_code16).toBe("206011106");
  await request(app).get("/api/v1/map/projections");
  expect(pool.query).toHaveBeenCalledTimes(2);
});
test("a failed fetch returns explicit 503 and can be retried", async () => {
  pool.query.mockRejectedValue(new Error("database offline"));
  const failed = await request(app).get("/api/v1/map/projections");
  expect(failed.status).toBe(503);
  expect(failed.body.error.code).toBe("PROJECTION_UNAVAILABLE");
  successfulRead();
  expect((await request(app).get("/api/v1/map/projections")).status).toBe(200);
});
test("an empty projection table is a failed layer, not successful blank data", async () => {
  pool.query.mockResolvedValue({ rows: [] });
  expect((await request(app).get("/api/v1/map/projections")).status).toBe(503);
});
test("a missing row stays null when no neighbour can supply that level", async () => {
  pool.query.mockImplementation(async sql => ({ rows: sql.includes("projectionBands") ? bands : [
    { sa2_code16: "206011106", warming_level: "3.0", days_label: null, days_lower: null, days_upper: null, source_sa2_code16: null },
  ] }));
  const response = await request(app).get("/api/v1/map/projections");
  expect(response.body.suburbs[0].days_lower).toBeNull();
});
