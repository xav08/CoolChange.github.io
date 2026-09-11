const express = require("express");
const { asyncHandler } = require("../http/errors");
const readApi = require("../services/readApi");

const router = express.Router();

router.get(
  "/",
  (req, res) => {
    res.json({
      version: "v1",
      endpoints: [
        "GET /api/v1/bootstrap",
        "GET /api/v1/meshblocks",
        "GET /api/v1/meshblocks/:mb_code16",
        "GET /api/v1/areas/:area_type/:area_code",
        "GET /api/v1/search?q=",
        "GET /api/v1/street-search?street=&suburb=",
        "GET /api/v1/map/suburbs",
        "GET /api/v1/map/suburbs/:sa2_code16/meshblocks",
      ],
    });
  }
);

router.get(
  "/bootstrap",
  asyncHandler(async (req, res) => {
    res.json(await readApi.getBootstrap());
  })
);

router.get(
  "/meshblocks/:mb_code16",
  asyncHandler(async (req, res) => {
    res.json(await readApi.getMeshblock(req.params.mb_code16));
  })
);

router.get(
  "/meshblocks",
  asyncHandler(async (req, res) => {
    const lga = typeof req.query.lga === "string" ? req.query.lga.trim() : "";
    res.json(await readApi.listMeshblocks(lga || undefined));
  })
);

router.get(
  "/areas/:area_type/:area_code",
  asyncHandler(async (req, res) => {
    res.json(
      await readApi.getArea(
        req.params.area_type,
        req.params.area_code,
        req.query.scope
      )
    );
  })
);

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    res.json(await readApi.searchSuburbs(req.query.q));
  })
);

router.get(
  "/street-search",
  asyncHandler(async (req, res) => {
    res.json(await readApi.searchStreets(req.query.street, req.query.suburb));
  })
);

router.get(
  "/map/suburbs",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json(await readApi.getMapSuburbs());
  })
);

router.get(
  "/map/suburbs/:sa2_code16/meshblocks",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "public, max-age=3600");
    res.json(await readApi.getMapMeshblocks(req.params.sa2_code16));
  })
);

module.exports = router;