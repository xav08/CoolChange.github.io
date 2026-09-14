const pool = require("../db/pool");
const sql = require("../db/sql");
const { getSimulatorMetadata, getBlockSimulator } = require("./simulator");
const {
  ApiError,
  notFound,
  badRequest,
  projectionUnavailable,
} = require("../http/errors");
const {
  shapeBootstrap,
  shapeMeshblockList,
  shapeBlock,
  shapeFlags,
  shapeComparison,
  shapeCoolest,
  shapeProjection,
  shapeArea,
  shapeStreetSearch,
  round2,
} = require("./shape");

const AREA_TYPES = new Set(["METRO", "LGA", "SA3", "SA2"]);
const SCOPES = new Set(["ALL", "RESIDENTIAL"]);

let bootstrapCache = null;
let mapSuburbsCache = null;

function resetBootstrapCache() {
  bootstrapCache = null;
  mapSuburbsCache = null;
}

async function query(text, params) {
  return pool.query(text, params);
}

async function getBootstrap() {
  if (bootstrapCache) return { ...bootstrapCache, simulator: await getSimulatorMetadata() };

  const configResult = await query(sql.bootstrapConfig);
  const modelResult = await query(sql.bootstrapModel);
  let projectionResult;
  try {
    projectionResult = await query(sql.bootstrapProjections);
  } catch (error) {
    throw projectionUnavailable();
  }

  if (!projectionResult.rows.length) {
    throw projectionUnavailable();
  }
  if (!modelResult.rows.length) {
    throw new ApiError(500, "INTERNAL", "No active METRO model_coefficient row.");
  }

  bootstrapCache = shapeBootstrap({
    configRows: configResult.rows,
    modelRow: modelResult.rows[0],
    projectionRows: projectionResult.rows,
  });
  return { ...bootstrapCache, simulator: await getSimulatorMetadata() };
}

async function listMeshblocks(lga) {
  const result = lga
    ? await query(sql.meshblocksByLga, [lga])
    : await query(sql.meshblocksAll);
  return shapeMeshblockList(result.rows);
}

async function getMeshblock(mbCode16) {
  const code = String(mbCode16 || "").trim();
  if (!/^\d{11}$/.test(code)) {
    throw badRequest("mb_code16 must be an 11-digit ABS mesh block code.");
  }

  const blockResult = await query(sql.blockByCode, [code]);
  if (!blockResult.rows.length) {
    throw notFound(`Mesh block ${code} was not found.`);
  }

  let comparisonRows;
  let coolestRow;
  let projectionRows;
  try {
    const [comparisons, coolest, projections] = await Promise.all([
      query(sql.blockComparisons, [code]),
      query(sql.blockCoolest, [code]),
      query(sql.blockProjections, [code]),
    ]);
    comparisonRows = comparisons.rows;
    coolestRow = coolest.rows[0] || null;
    projectionRows = projections.rows;
  } catch (error) {
    if (/mesh_block_projection|projection_metro/i.test(error.message)) {
      throw projectionUnavailable();
    }
    throw error;
  }

  if (!projectionRows.length) {
    throw projectionUnavailable();
  }

  const block = shapeBlock(blockResult.rows[0]);
  const coolest = shapeCoolest(coolestRow);
  return {
    block,
    simulator: await getBlockSimulator(code),
    flags: shapeFlags(block, coolest),
    comparisons: comparisonRows.map(shapeComparison),
    coolest_in_lga: coolest,
    projections: projectionRows.map(shapeProjection),
  };
}

async function getArea(areaType, areaCode, scope) {
  const type = String(areaType || "").toUpperCase();
  const resolvedScope = (scope || "RESIDENTIAL").toUpperCase();
  if (!AREA_TYPES.has(type)) {
    throw badRequest("area_type must be one of METRO, LGA, SA3, SA2.");
  }
  if (!SCOPES.has(resolvedScope)) {
    throw badRequest("scope must be ALL or RESIDENTIAL.");
  }
  const code = decodeURIComponent(String(areaCode || "")).trim();
  if (!code) {
    throw badRequest("area_code is required.");
  }

  const result = await query(sql.areaByKey, [type, code, resolvedScope]);
  if (!result.rows.length) {
    throw notFound(`Area ${type}/${code} (${resolvedScope}) was not found.`);
  }
  return shapeArea(result.rows[0]);
}

async function searchSuburbs(rawQuery) {
  const q = String(rawQuery || "").trim();
  if (q.length < 2) {
    throw badRequest("q must be at least 2 characters.");
  }

  const result = await query(sql.searchSuburbs, [q]);
  return {
    query: q,
    results: result.rows.map((row) => ({
      sa2_code16: String(row.sa2_code16).trim(),
      sa2_name: row.sa2_name,
      lga_name: row.lga_name,
      n_blocks: Number(row.n_blocks),
    })),
  };
}

// Common road-type abbreviations VicMap itself never stores (its data always
// spells the type in full) but residents naturally type. Only the LAST
// whitespace-separated token is checked, since the road type is always the
// final word -- this avoids ever touching the rest of a street name.
// "St" is deliberately NOT included: it's genuinely ambiguous with "Saint"
// (St Kilda Road, St Georges Road, ...), and guessing wrong there would
// silently break real, common Melbourne street names rather than just
// failing an abbreviation. Every other entry here is unambiguous.
const ROAD_TYPE_ABBREVIATIONS = {
  rd: "road", ave: "avenue", av: "avenue", dr: "drive", ct: "court",
  cres: "crescent", cr: "crescent", pl: "place", ln: "lane",
  blvd: "boulevard", hwy: "highway", cl: "close", pde: "parade",
  cct: "circuit", tce: "terrace", gr: "grove", sq: "square",
  esp: "esplanade", pkwy: "parkway", cir: "circle",
};

function expandRoadTypeAbbreviation(street) {
  const tokens = street.split(/\s+/);
  const lastIndex = tokens.length - 1;
  const expansion = ROAD_TYPE_ABBREVIATIONS[tokens[lastIndex].toLowerCase()];
  if (!expansion) return street;
  tokens[lastIndex] = expansion;
  return tokens.join(" ");
}

function normalizeWhitespace(s) {
  return s.replace(/\s+/g, " ");
}

async function searchStreets(rawStreet, rawSuburb) {
  const street = normalizeWhitespace(String(rawStreet || "")).trim();
  const suburb = normalizeWhitespace(String(rawSuburb || "")).trim();
  if (street.length < 2) {
    throw badRequest("street must be at least 2 characters.");
  }
  if (!suburb) {
    throw badRequest("suburb is required.");
  }

  // Match against BOTH the raw prefix and the abbreviation-expanded one, not
  // just the expanded one -- "Pl" expanding to "place" must not stop it from
  // also matching "Plenty Road" via the plain, unexpanded prefix.
  const streetExpanded = expandRoadTypeAbbreviation(street);
  const result = await query(sql.streetSearch, [street, suburb, streetExpanded]);
  // echo back what the resident actually typed (whitespace-normalised), not
  // the expanded form used internally for matching
  return shapeStreetSearch(street, suburb, result.rows);
}

function geometryFeature(row, properties) {
  return {
    type: "Feature",
    geometry: JSON.parse(row.geometry),
    properties,
  };
}

async function getMapSuburbs() {
  if (mapSuburbsCache) return mapSuburbsCache;

  const result = await query(sql.mapSuburbs);
  if (!result.rows.length) {
    throw new ApiError(
      503,
      "GEOMETRY_UNAVAILABLE",
      "Mesh-block geometry has not been loaded. Run npm run geometry:load."
    );
  }

  mapSuburbsCache = {
    type: "FeatureCollection",
    features: result.rows.map((row) =>
      geometryFeature(row, {
        sa2_code16: String(row.sa2_code16).trim(),
        sa2_name: row.sa2_name,
        lga_name: row.lga_name,
        n_blocks: Number(row.n_blocks),
        uhi_mean: round2(row.uhi_mean),
        canopy_mean: round2(row.canopy_mean),
      })
    ),
  };
  return mapSuburbsCache;
}

async function getMapMeshblocks(rawSa2Code) {
  const sa2Code = String(rawSa2Code || "").trim();
  if (!/^\d{9}$/.test(sa2Code)) {
    throw badRequest("sa2_code16 must be a 9-digit ABS SA2 code.");
  }

  const result = await query(sql.mapMeshblocksBySuburb, [sa2Code]);
  if (!result.rows.length) {
    throw notFound(`No mapped mesh blocks were found for SA2 ${sa2Code}.`);
  }

  const first = result.rows[0];
  return {
    type: "FeatureCollection",
    suburb: {
      sa2_code16: String(first.sa2_code16).trim(),
      sa2_name: first.sa2_name,
      lga_name: first.lga_name,
      n_blocks: result.rows.length,
    },
    features: result.rows.map((row) =>
      geometryFeature(row, {
        mb_code16: String(row.mb_code16).trim(),
        uhi_mean: round2(row.uhi_mean),
        canopy_pct: round2(row.canopy_pct),
        mb_category: row.mb_category,
        persons: row.persons == null ? null : Number(row.persons),
      })
    ),
  };
}

module.exports = {
  getBootstrap,
  resetBootstrapCache,
  listMeshblocks,
  getMeshblock,
  getArea,
  searchSuburbs,
  searchStreets,
  getMapSuburbs,
  getMapMeshblocks,
};