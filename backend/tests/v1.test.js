jest.mock("../src/db/pool", () => ({
  query: jest.fn(),
}));

const request = require("supertest");
const pool = require("../src/db/pool");
const app = require("../src/index");
const { resetBootstrapCache } = require("../src/services/readApi");

function rows(data) {
  return { rows: data };
}

beforeEach(() => {
  pool.query.mockReset();
  resetBootstrapCache();
});

describe("GET /health", () => {
  it("returns ok status", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.service).toBe("coolchange-backend");
  });
});

describe("GET /api/v1", () => {
  it("lists the read-only endpoints", async () => {
    const response = await request(app).get("/api/v1");
    expect(response.status).toBe(200);
    expect(response.body.version).toBe("v1");
    expect(response.body.endpoints).toEqual(
      expect.arrayContaining(["GET /api/v1/bootstrap"])
    );
  });
});

describe("GET /api/v1/bootstrap", () => {
  it("composes config, model and metro projections", async () => {
    pool.query.mockImplementation(async (text) => {
      if (text.includes("simulatorMetadata")) return rows([]);
      if (text.includes("bootstrapConfig")) {
        return rows([
          { key: "data_vintage", value: "2018" },
          { key: "n_blocks", value: "54239" },
          { key: "uhi_units", value: "°C above non-urban baseline" },
          { key: "uhi_scale_min", value: "-8.0" },
          { key: "uhi_scale_max", value: "17.0" },
          { key: "canopy_scale_max", value: "80.0" },
        ]);
      }
      if (text.includes("bootstrapModel")) {
        return rows([
          {
            model_type: "OLS_GLOBAL",
            slope: -0.1229,
            intercept: 10.0507,
            pearson_r: -0.5706,
            r_squared: 0.326,
            n_blocks: 54239,
          },
        ]);
      }
      if (text.includes("bootstrapProjections")) {
        return rows([
          {
            warming_level: 1.2,
            horizon_label: "Today",
            days_label: "5-10",
            days_lower: 5,
            days_upper: 10,
          },
        ]);
      }
      throw new Error(`unexpected query: ${text}`);
    });

    const response = await request(app).get("/api/v1/bootstrap");
    expect(response.status).toBe(200);
    expect(response.body.n_blocks).toBe(54239);
    expect(response.body.simulator).toBeNull();
    expect(response.body.projections[0].days_label).toBe("5-10");
  });

  it("returns PROJECTION_UNAVAILABLE when metro projections are empty", async () => {
    pool.query.mockImplementation(async (text) => {
      if (text.includes("bootstrapConfig")) return rows([]);
      if (text.includes("bootstrapModel")) {
        return rows([{ model_type: "OLS_GLOBAL", slope: -0.12, intercept: 10, pearson_r: -0.5, r_squared: 0.3, n_blocks: 1 }]);
      }
      if (text.includes("bootstrapProjections")) return rows([]);
      throw new Error(`unexpected query: ${text}`);
    });

    const response = await request(app).get("/api/v1/bootstrap");
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("PROJECTION_UNAVAILABLE");
  });
});

describe("GET /api/v1/meshblocks/:mb_code16", () => {
  it("returns NOT_FOUND for an unknown block", async () => {
    pool.query.mockResolvedValue(rows([]));
    const response = await request(app).get("/api/v1/meshblocks/20102100101");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns BAD_REQUEST for a malformed code", async () => {
    const response = await request(app).get("/api/v1/meshblocks/not-a-code");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("sets fallback and population flags from the four queries", async () => {
    pool.query.mockImplementation(async (text) => {
      if (text.includes("simulatorBlock")) return rows([]);
      if (text.includes("blockByCode")) {
        return rows([
          {
            mb_code16: "20102100101",
            sa2_name: "Melton",
            sa3_name: "Melton - Bacchus Marsh",
            lga_name: "Melton (C)",
            uhi_mean: 8.42,
            canopy_pct: 4.74,
            grass_pct: 11.2,
            shrub_pct: 6.1,
            any_veg_pct: 22,
            tree_03_10_pct: 3.1,
            tree_10_15_pct: 1,
            tree_15plus_pct: 0.6,
            mb_category: "Residential",
            dwellings: 42,
            persons: 0,
            area_sqkm: 0.0388,
            irsd_score: null,
            irsd_decile: null,
          },
        ]);
      }
      if (text.includes("blockComparisons")) {
        return rows([
          {
            area_type: "LGA",
            area_name: "Melton (C)",
            scope: "RESIDENTIAL",
            uhi_mean: 9.1,
            canopy_mean: 5.2,
            uhi_delta: -0.68,
            canopy_delta: -0.46,
          },
        ]);
      }
      if (text.includes("blockCoolest")) {
        return rows([
          {
            coolest_mb_code: "20102100999",
            coolest_uhi: 1.12,
            coolest_canopy_pct: 3.96,
          },
        ]);
      }
      if (text.includes("blockProjections")) {
        return rows([
          {
            warming_level: 2.0,
            horizon_label: "2050",
            days_label: "10-15",
            days_lower: 10,
            days_upper: 15,
            is_fallback: true,
          },
        ]);
      }
      throw new Error(`unexpected query: ${text}`);
    });

    const response = await request(app).get("/api/v1/meshblocks/20102100101");
    expect(response.status).toBe(200);
    expect(response.body.flags.no_published_population).toBe(true);
    expect(response.body.flags.already_coolest_in_lga).toBe(false);
    expect(response.body.block.irsd_score).toBeNull();
    expect(response.body.simulator).toBeNull();
    expect(response.body.projections[0].is_fallback).toBe(true);
    expect(response.body.comparisons[0].uhi_delta).toBe(-0.68);
  });
});

describe("GET /api/v1/search", () => {
  it("rejects short queries", async () => {
    const response = await request(app).get("/api/v1/search?q=m");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("returns an empty list without 404", async () => {
    pool.query.mockResolvedValue(rows([]));
    const response = await request(app).get("/api/v1/search?q=zzzx");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ query: "zzzx", results: [] });
  });
});

describe("GET /api/v1/areas/:type/:code", () => {
  it("returns NOT_FOUND when the area is missing", async () => {
    pool.query.mockResolvedValue(rows([]));
    const response = await request(app).get("/api/v1/areas/LGA/Nope");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
