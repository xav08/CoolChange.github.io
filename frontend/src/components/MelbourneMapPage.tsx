import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import mapboxgl, { type GeoJSONSource, type MapMouseEvent } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { resolveMapStyle } from "../utils/mapStyle";
import { BlockPlanting } from "./BlockPlanting";
import { SelectedBlockPanel, type BlockTab } from "./SelectedBlockPanel";
import { ExplorerPanel } from "./ExplorerPanel";
import { metricValue } from "../utils/blockInsights";
import { MapPlantingFeedback } from "./MapPlantingFeedback";
import type { BlockGeometry } from "../utils/canopyGeometry";
import { useTheme } from "../hooks/useTheme";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { animateHeatStates, type HeatState } from "../utils/plantingMotion";
import { applyMapTheme } from "../utils/mapTheme";
import { ProjectionHelp } from "./ProjectionHelp";
import { ProjectionControls, ProjectionLegend } from "./ProjectionControls";
import { daysBand, isProjectionData, projectionColor, warmingLabel, UNAVAILABLE_COLOR, type ProjectionData, type WarmingLevel } from "../utils/projections";
import { calculatePlanting, keepSuburbPlanting, restorePlanting, updatePlanting, PLANTING_STORAGE_KEY, type PlantingModel, type PlantingScenario } from "../utils/planting";
import { plantingMilestones } from "../utils/plantingMilestones";
import { polygonBounds, polygonsFor } from "../utils/canopyGeometry";
import type { SheetSize } from "../utils/explorerSheet";
import { MapTour } from "../tour/MapTour";
import type { TourController, TourState } from "../tour/tourTypes";
import type { Rect } from "../tour/tourLogic";

// resolve the backend endpoint for map data
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/$/, "");
const MELBOURNE_CENTER: [number, number] = [144.9631, -37.8136];
type SourceData = Parameters<GeoJSONSource["setData"]>[0];
type MapFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: string; coordinates?: unknown } | null;
    properties?: MapProperties;
  }>;
};
const EMPTY_COLLECTION: MapFeatureCollection = { type: "FeatureCollection", features: [] };
// keep source and layer ids stable so updates target the existing map objects
const SUBURB_SOURCE = "melbourne-suburbs";
const MESH_SOURCE = "suburb-meshblocks";
const SUBURB_FILL = "melbourne-suburbs-fill";
const SUBURB_LINE = "melbourne-suburbs-line";
const MESH_FILL = "suburb-meshblocks-fill";
const MESH_LINE = "suburb-meshblocks-line";
const MESH_SELECTED = "suburb-meshblocks-selected";
const PROJECTION_FILL = "suburb-projection-fill";

type SearchResult = {
  sa2_code16: string;
  sa2_name: string;
  lga_name: string;
  n_blocks: number;
};

type SuburbSummary = SearchResult & {
  uhi_mean?: number | null;
  canopy_mean?: number | null;
};

type MeshblockProperties = {
  mb_code16: string;
  uhi_mean: number | null;
  canopy_pct: number | null;
  mb_category: string;
  persons: number | null;
};

type BlockComparison = {
  area_type: "METRO" | "LGA";
  area_name: string;
  uhi_mean: number | null;
  canopy_mean: number | null;
};

type CoolestBlock = {
  mb_code16: string;
  uhi_mean: number | null;
  canopy_pct: number | null;
};

export type MeshblockDetail = {
  simulator?: { release_id: string; interactive?: PlantingModel } | null;
  block: MeshblockProperties & {
    sa2_name: string;
    lga_name: string;
    dwellings: number | null;
    area_sqkm: number | null;
  };
  streets: string[];
  comparisons: BlockComparison[];
  coolest_in_lga: CoolestBlock | null;
};

type StreetBlock = {
  mb_code16: string;
  n_addresses: number;
  sa2_code16: string;
};

type StreetResult = {
  street_id: number;
  road_name: string;
  road_type: string;
  locality_name: string;
  blocks: StreetBlock[];
};

// Calculate bounds from nested GeoJSON coordinates.
function boundsFor(data: MapFeatureCollection): [[number, number], [number, number]] | null {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  // Visit each coordinate in the geometry.
  function visit(value: unknown) {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      west = Math.min(west, value[0]);
      south = Math.min(south, value[1]);
      east = Math.max(east, value[0]);
      north = Math.max(north, value[1]);
      return;
    }
    value.forEach(visit);
  }

  data.features.forEach((feature) => {
    const geometry = feature.geometry;
    if (geometry?.coordinates) visit(geometry.coordinates);
  });
  return Number.isFinite(west) ? [[west, south], [east, north]] : null;
}

type MapProperties = Record<string, string | number | boolean | null | undefined>;

// Read properties from the top rendered feature.
function eventProperties(event: MapMouseEvent): MapProperties | undefined {
  return (event.features?.[0] as { properties?: MapProperties } | undefined)?.properties;
}

// Read a text value from map properties.
function propertyText(properties: MapProperties | undefined, key: string) {
  const value = properties?.[key];
  return value == null ? "" : String(value);
}

// Read a numeric value from map properties.
function propertyNumber(properties: MapProperties | undefined, key: string) {
  const value = Number(properties?.[key]);
  return Number.isFinite(value) ? value : 0;
}

// Render the suburb and mesh block explorer.
export function MelbourneMapPage() {
  const { theme } = useTheme();
  const reducedMotion = useReducedMotion();
  const heatStates = useRef(new Map<string, HeatState>());
  const heatSuburb = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const meshDataRef = useRef<MapFeatureCollection>(EMPTY_COLLECTION);
  const suburbDataRef = useRef<MapFeatureCollection>(EMPTY_COLLECTION);
  const loadedSuburbRef = useRef<string | null>(null);
  const futureRef = useRef(false);
  const [future, setFuture] = useState(false);
  const [warmingLevel, setWarmingLevel] = useState<WarmingLevel>(2);
  const [projectionData, setProjectionData] = useState<ProjectionData | null>(null);
  const [projectionStatus, setProjectionStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [basemapUnavailable, setBasemapUnavailable] = useState(false);
  const [loadingSuburb, setLoadingSuburb] = useState(false);
  const [suburb, setSuburb] = useState<SuburbSummary | null>(null);
  // bumped whenever the search field should clear itself (remounts UnifiedSearch)
  const [searchResetToken, setSearchResetToken] = useState(0);
  const [hoveredSuburb, setHoveredSuburb] = useState<SuburbSummary | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<MeshblockDetail | null>(null);
  const [selectedGeometry, setSelectedGeometry] = useState<BlockGeometry | null>(null);
  const [plantingInteracting, setPlantingInteracting] = useState(false);
  const [plantingRevision, setPlantingRevision] = useState(0);
  const [blockTab, setBlockTab] = useState<BlockTab>("Overview");
  const [blockLoading, setBlockLoading] = useState(false);
  const blockRequest = useRef<AbortController | null>(null);
  const suburbRequest = useRef<AbortController | null>(null);
  const [scenarios, setScenarios] = useState<PlantingScenario[]>(() => {
    try { return restorePlanting(localStorage.getItem(PLANTING_STORAGE_KEY)); } catch { return []; }
  });
  const [comparison, setComparison] = useState<"before" | "after">("after");
  const [previewBefore, setPreviewBefore] = useState(false);
  const effectiveComparison = previewBefore ? "before" : comparison;
  const [plantingNotice, setPlantingNotice] = useState("");
  // guided tour: highlighted street blocks, search prefill and mobile sheet size requests
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [tourActive, setTourActive] = useState(false);
  const [searchPrefill, setSearchPrefill] = useState<{ text: string; token: number } | null>(null);
  const [sheetRequest, setSheetRequest] = useState<{ size: SheetSize; nonce: number } | null>(null);
  const tourActiveRef = useRef(false);
  const tourSnapshot = useRef<PlantingScenario[]>([]);
  const model = selectedBlock?.simulator?.interactive ?? null;
  const activeScenario = scenarios.find(s => s.code === selectedBlock?.block.mb_code16);
  const addedTrees = activeScenario?.trees ?? 0;
  const displayed = model ? calculatePlanting(model, effectiveComparison === "after" ? addedTrees : 0) : null;
  const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  const projectionRows = useMemo(() => new Map(projectionData?.suburbs
    .filter(row => row.warming_level === warmingLevel).map(row => [row.sa2_code16, row])), [projectionData, warmingLevel]);
  const projectionSuburb = suburb ?? hoveredSuburb;
  const selectedProjection = projectionSuburb ? projectionRows.get(projectionSuburb.sa2_code16) : undefined;
  const savedTrees = scenarios.reduce((sum, item) => sum + item.trees, 0);

  useEffect(() => {
    const map = mapRef.current;
    if (mapReady && map) applyMapTheme(map, theme);
  }, [mapReady, theme]);

  useEffect(() => {
    if (!future || projectionData) return;
    const controller = new AbortController();
    setProjectionStatus("loading");
    const timeout = window.setTimeout(() => {
      setProjectionStatus("error");
      controller.abort();
    }, 20000);
    fetch(`${API_BASE}/map/projections`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Projection unavailable");
        const data: unknown = await response.json();
        if (!isProjectionData(data)) throw new Error("Invalid projection response");
        if (!controller.signal.aborted) { setProjectionData(data); setProjectionStatus("ready"); }
      }).catch(() => { if (!controller.signal.aborted) setProjectionStatus("error"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [future, projectionData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getLayer(PROJECTION_FILL)) return;
    const colors = Object.fromEntries([...projectionRows].map(([code, band]) => [code, projectionColor(band, projectionData!.scale)]));
    map.setPaintProperty(PROJECTION_FILL, "fill-color", ["coalesce", ["get", ["get", "sa2_code16"], ["literal", colors]], UNAVAILABLE_COLOR]);
    map.setFilter(PROJECTION_FILL, suburb ? ["==", ["get", "sa2_code16"], suburb.sa2_code16] : null);
    map.setFilter(SUBURB_LINE, future && suburb ? ["==", ["get", "sa2_code16"], suburb.sa2_code16] : null);
    map.setLayoutProperty(PROJECTION_FILL, "visibility", future ? "visible" : "none");
    map.setLayoutProperty(SUBURB_FILL, "visibility", !future && !suburb ? "visible" : "none");
    const meshReady = suburb && loadedSuburbRef.current === suburb.sa2_code16;
    map.setLayoutProperty(SUBURB_LINE, "visibility", future || !meshReady ? "visible" : "none");
    for (const layer of [MESH_FILL, MESH_LINE, MESH_SELECTED]) {
      map.setLayoutProperty(layer, "visibility", !future && meshReady ? "visible" : "none");
    }
  }, [future, mapReady, suburb, projectionRows, projectionData, loadingSuburb]);

  useEffect(() => {
    // The tour plants demo trees; keep the visitor's own saved scenario untouched until it ends.
    if (tourActiveRef.current) return;
    try { localStorage.setItem(PLANTING_STORAGE_KEY, JSON.stringify(scenarios)); } catch { /* Private browsing may disable storage. */ }
  }, [scenarios]);

  useEffect(() => {
    panelRef.current?.querySelector(".map-explorer-content")?.scrollTo({ top: 0 });
  }, [selectedBlock?.block.mb_code16]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getSource(MESH_SOURCE)) return;
    if (heatSuburb.current !== suburb?.sa2_code16) {
      map.removeFeatureState({ source: MESH_SOURCE });
      heatStates.current.clear();
      heatSuburb.current = suburb?.sa2_code16 ?? null;
    }
    const targets = new Map<string, HeatState>();
    if (effectiveComparison === "after") {
      for (const scenario of scenarios) {
        if (scenario.suburb_code !== suburb?.sa2_code16) continue;
        targets.set(scenario.code, {
          heat: calculatePlanting(scenario.model, scenario.trees).heat,
          baseline: scenario.model.baseline_heat_c,
        });
      }
    }
    map.setPaintProperty(MESH_FILL, "fill-color-transition", { duration: reducedMotion ? 0 : 400, delay: 0 });
    return animateHeatStates(heatStates.current, targets, reducedMotion ? 0 : 400,
      (code, heat) => map.setFeatureState({ source: MESH_SOURCE, id: code }, { simulatedHeat: heat }),
      code => map.removeFeatureState({ source: MESH_SOURCE, id: code }, "simulatedHeat"),
    );
  }, [scenarios, effectiveComparison, mapReady, suburb, reducedMotion]);

  function changeTrees(trees: number) {
    if (!model || !selectedBlock?.simulator || !suburb) return;
    if (calculatePlanting(model, trees).trees === addedTrees) return;
    setPlantingRevision(value => value + 1);
    const code = selectedBlock.block.mb_code16;
    setPlantingNotice("");
    const next = { code, suburb_code: suburb.sa2_code16, release: selectedBlock.simulator.release_id, trees, model };
    setScenarios(current => updatePlanting(current, next));
    setComparison("after");
  }

  function resetPlanting() {
    setScenarios([]);
    setComparison("after");
    setPlantingNotice("All added trees cleared. Every block is back to its baseline.");
  }

  // Load and display mesh blocks for one suburb.
  const openSuburb = useCallback(async (selection: SearchResult | SuburbSummary) => {
    const map = mapRef.current;
    if (!map?.getLayer(MESH_FILL)) return;

    suburbRequest.current?.abort();
    blockRequest.current?.abort();
    const controller = new AbortController();
    suburbRequest.current = controller;
    setBlockLoading(false);
    setHighlighted([]);
    if (futureRef.current) {
      // The future view never requests or drills into mesh-block geometry.
      const feature = suburbDataRef.current.features.find(item => item.properties?.sa2_code16 === selection.sa2_code16);
      setSuburb({ ...selection, ...(feature?.properties ?? {}) } as SuburbSummary);
      setHoveredSuburb(null);
      setLoadingSuburb(false);
      setMapError("");
      suburbRequest.current = null;
      const bounds = feature ? boundsFor({ type: "FeatureCollection", features: [feature] }) : null;
      if (bounds) map.fitBounds(bounds, { padding: 70, duration: 1000, maxZoom: 14.7 });
      return true;
    }
    setLoadingSuburb(true);
    setSelectedBlock(null);
    setMapError("");
    try {
      // load mesh blocks only after a suburb is selected
      const response = await fetch(
        `${API_BASE}/map/suburbs/${encodeURIComponent(selection.sa2_code16)}/meshblocks`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("This suburb’s mesh blocks could not be loaded.");
      const data = (await response.json()) as MapFeatureCollection & { suburb: SearchResult };
      if (controller.signal.aborted) return;
      const source = map.getSource(MESH_SOURCE) as GeoJSONSource | undefined;
      source?.setData(data as SourceData);
      meshDataRef.current = data;
      loadedSuburbRef.current = selection.sa2_code16;
      setScenarios(current => keepSuburbPlanting(current, selection.sa2_code16));
      setPlantingNotice("");
      setComparison("after");
      // Search results omit averages; retain the same suburb benchmarks as map selection.
      const summary = suburbDataRef.current.features.find(item => item.properties?.sa2_code16 === selection.sa2_code16)?.properties;
      setSuburb({ ...selection, ...summary, ...data.suburb } as SuburbSummary);
      // Clear highlighting from the previous street search.
      map.setFilter(MESH_SELECTED, ["==", ["get", "mb_code16"], ""]);
      if (map.getLayer(MESH_FILL)) map.setPaintProperty(MESH_FILL, "fill-opacity", 0.8);
      // replace suburb outlines with mesh-block layers
      map.setLayoutProperty(SUBURB_FILL, "visibility", "none");
      map.setLayoutProperty(SUBURB_LINE, "visibility", "none");
      map.setLayoutProperty(MESH_FILL, "visibility", "visible");
      map.setLayoutProperty(MESH_LINE, "visibility", "visible");
      map.setLayoutProperty(MESH_SELECTED, "visibility", "visible");
      const bounds = boundsFor(data);
      if (bounds) map.fitBounds(bounds, { padding: 70, duration: 1000, maxZoom: 14.7 });
      return true;
    } catch (error) {
      if (controller.signal.aborted) return;
      setMapError(error instanceof Error ? error.message : "Could not load this suburb.");
    } finally {
      if (!controller.signal.aborted) {
        setLoadingSuburb(false);
        suburbRequest.current = null;
      }
    }
  }, []);

  async function toggleFuture() {
    setPlantingInteracting(false);
    const next = !futureRef.current;
    panelRef.current?.querySelector(".map-explorer-content")?.scrollTo({ top: 0 });
    futureRef.current = next;
    setFuture(next);
    setMapError("");
    if (next) {
      suburbRequest.current?.abort();
      blockRequest.current?.abort();
      setLoadingSuburb(false);
      setBlockLoading(false);
    } else {
      setComparison("after");
      if (suburb && loadedSuburbRef.current !== suburb.sa2_code16) await openSuburb(suburb);
    }
  }

  // Load details for the selected mesh block.
  const openBlock = useCallback(async (mbCode16: string) => {
    const map = mapRef.current;
    if (!map || futureRef.current || (suburbRequest.current && !suburbRequest.current.signal.aborted)) return;
    blockRequest.current?.abort();
    const controller = new AbortController();
    blockRequest.current = controller;
    setSelectedBlock(null);
    setPlantingInteracting(false);
    setPlantingNotice("");
    setMapError("");
    map.setFilter(MESH_SELECTED, ["==", ["get", "mb_code16"], mbCode16]);
    setHighlighted([]);
    // clicking any block -- highlighted or not -- resolves the street search's
    // job; drop the dim so the view returns to normal, leaving just this one
    // block outlined
    if (map.getLayer(MESH_FILL)) map.setPaintProperty(MESH_FILL, "fill-opacity", 0.8);
    setBlockLoading(true);
    try {
      const response = await fetch(`${API_BASE}/meshblocks/${mbCode16}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Mesh-block details are unavailable.");
      const detail = (await response.json()) as MeshblockDetail;
      if (controller.signal.aborted) return;
      setSelectedGeometry(meshDataRef.current.features.find(feature => String(feature.properties?.mb_code16) === mbCode16)?.geometry ?? null);
      setSelectedBlock(detail);
      setBlockTab("Overview");
      // Reconcile saved scenarios with the active release and freshly read model.
      setScenarios(current => {
        if (!detail.simulator) return [];
        const release = detail.simulator.release_id;
        const compatible = current.filter(s => s.release === release);
        const saved = compatible.find(s => s.code === mbCode16);
        const fresh = detail.simulator.interactive;
        return saved && fresh ? updatePlanting(compatible, { ...saved, model: fresh }) : compatible;
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setMapError(error instanceof Error ? error.message : "Could not load this mesh block.");
    } finally {
      if (!controller.signal.aborted) setBlockLoading(false);
    }
  }, []);

  // Highlight blocks matched by a street search.
  const highlightBlocks = useCallback((mbCodes: string[]) => {
    const map = mapRef.current;
    if (!map || futureRef.current || !mbCodes.length) return;
    setHighlighted(mbCodes);
    map.setFilter(MESH_SELECTED, ["in", ["get", "mb_code16"], ["literal", mbCodes]]);
    map.setLayoutProperty(MESH_SELECTED, "visibility", "visible");
    map.setPaintProperty(MESH_FILL, "fill-opacity", [
      "case",
      ["in", ["get", "mb_code16"], ["literal", mbCodes]],
      0.85,
      0.15,
    ]);
  }, []);

  function viewPlantedBlock(code: string) {
    void openBlock(code);
  }

  function resetBlock(code: string) {
    setScenarios(current => current.filter(item => item.code !== code));
    setPlantingNotice(`Added trees removed from block ${code}.`);
  }

  // Load a suburb and highlight matching street blocks.
  const openStreetMatch = useCallback(
    async (sa2Code16: string, mbCodes: string[]) => {
      if (await openSuburb({ sa2_code16: sa2Code16, sa2_name: "", lga_name: "", n_blocks: 0 })) {
        highlightBlocks(mbCodes);
      }
    },
    [openSuburb, highlightBlocks],
  );

  // Create the Melbourne map and its suburb layers.
  useEffect(() => {
    const container = containerRef.current;
    const mapConfig = resolveMapStyle(accessToken);
    if (!container || !mapConfig.accessToken) return undefined;
    let cancelled = false;
    let layersInitialized = false;
    let usingFallback = false;
    const dataRequest = new AbortController();
    // Fetch real boundaries independently of the external basemap request.
    const dataTimeout = window.setTimeout(() => dataRequest.abort(), 20000);
    const boundaries = fetch(`${API_BASE}/map/suburbs`, { signal: dataRequest.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Suburb data is unavailable. Check the API connection and reload the map.");
        const data = await response.json() as MapFeatureCollection;
        if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) throw new Error("Invalid suburb data received.");
        return { data, error: "" };
      })
      .catch(() => ({ data: null, error: "Suburb data could not load. Check the API connection and reload the map." }))
      .finally(() => window.clearTimeout(dataTimeout));

    const map = new mapboxgl.Map({
      container,
      accessToken: mapConfig.accessToken,
      style: mapConfig.style,
      center: MELBOURNE_CENTER,
      zoom: 8.55,
      minZoom: 7.5,
      maxZoom: 17,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-left");

    // A failed/blocked style must not prevent the local GeoJSON from rendering.
    const useDataOnlyMap = () => {
      if (cancelled || layersInitialized || usingFallback) return;
      usingFallback = true;
      setBasemapUnavailable(true);
      map.setStyle({ version: 8, sources: {}, layers: [
        { id: "background", type: "background", paint: { "background-color": "#e8ece4" } },
      ] });
    };
    const styleTimeout = window.setTimeout(useDataOnlyMap, 8000);
    map.on("error", useDataOnlyMap);
    map.on("load", async () => {
      if (cancelled || layersInitialized) return;
      layersInitialized = true;
      window.clearTimeout(styleTimeout);
      // sources must exist before their layers are added
      map.addSource(SUBURB_SOURCE, { type: "geojson", data: EMPTY_COLLECTION as SourceData });
      map.addSource(MESH_SOURCE, { type: "geojson", data: EMPTY_COLLECTION as SourceData, promoteId: "mb_code16" });

      map.addLayer({
        id: SUBURB_FILL,
        type: "fill",
        source: SUBURB_SOURCE,
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "uhi_mean"], 0],
            -4, "#2c9e9c", 0, "#8bcf9b", 4, "#f0d264", 8, "#ef8a47", 12, "#d94835",
          ],
          "fill-opacity": 0.72,
        },
      });
      map.addLayer({
        id: SUBURB_LINE,
        type: "line",
        source: SUBURB_SOURCE,
        paint: { "line-color": "rgba(255,255,255,0.82)", "line-width": 0.75 },
      });
      map.addLayer({
        id: PROJECTION_FILL,
        type: "fill",
        source: SUBURB_SOURCE,
        layout: { visibility: "none" },
        paint: { "fill-color": UNAVAILABLE_COLOR, "fill-opacity": 0.8 },
      }, SUBURB_LINE);
      map.addLayer({
        id: MESH_FILL,
        type: "fill",
        source: MESH_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["coalesce", ["feature-state", "simulatedHeat"], ["get", "uhi_mean"], 0],
            -4, "#238f93", 0, "#78c794", 4, "#eed05e", 8, "#ed8142", 12, "#cf3e32",
          ],
          "fill-opacity": 0.8,
        },
      });
      map.addLayer({
        id: MESH_LINE,
        type: "line",
        source: MESH_SOURCE,
        layout: { visibility: "none" },
        paint: { "line-color": "rgba(255,255,255,0.72)", "line-width": 0.7 },
      });
      map.addLayer({
        id: MESH_SELECTED,
        type: "line",
        source: MESH_SOURCE,
        filter: ["==", ["get", "mb_code16"], ""],
        layout: { visibility: "none" },
        paint: { "line-color": "#102f24", "line-width": 3 },
      });

      for (const layer of [SUBURB_FILL, PROJECTION_FILL]) {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
          setHoveredSuburb(null);
        });
        map.on("mousemove", layer, (event: MapMouseEvent) => {
          // update the hover card without committing the user to a suburb selection
          const properties = eventProperties(event);
          if (!properties) return;
          setHoveredSuburb({
            sa2_code16: propertyText(properties, "sa2_code16"),
            sa2_name: propertyText(properties, "sa2_name"),
            lga_name: propertyText(properties, "lga_name"),
            n_blocks: propertyNumber(properties, "n_blocks"),
            uhi_mean: propertyNumber(properties, "uhi_mean"),
            canopy_mean: propertyNumber(properties, "canopy_mean"),
          });
        });
        map.on("click", layer, (event: MapMouseEvent) => {
          const properties = eventProperties(event);
          if (!properties) return;
          void openSuburb({
            sa2_code16: propertyText(properties, "sa2_code16"),
            sa2_name: propertyText(properties, "sa2_name"),
            lga_name: propertyText(properties, "lga_name"),
            n_blocks: propertyNumber(properties, "n_blocks"),
            uhi_mean: propertyNumber(properties, "uhi_mean"),
            canopy_mean: propertyNumber(properties, "canopy_mean"),
          });
        });
      }
      map.on("mouseenter", MESH_FILL, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", MESH_FILL, () => { map.getCanvas().style.cursor = ""; });
      map.on("click", MESH_FILL, (event: MapMouseEvent) => {
        // use the rendered feature id to request the detailed metrics on demand
        const code = propertyText(eventProperties(event), "mb_code16");
        if (code) {
          void openBlock(code);
          if (window.matchMedia("(max-width: 620px)").matches) {
            // Keep the tapped block below the taller mobile information card.
            map.easeTo({ center: event.lngLat, offset: [0, map.getContainer().clientHeight * 0.29], duration: 350 });
          }
        }
      });

      try {
        // load lightweight suburb outlines for the first view
        const { data, error } = await boundaries;
        if (!data) throw new Error(error);
        if (cancelled) return;
        suburbDataRef.current = data;
        (map.getSource(SUBURB_SOURCE) as GeoJSONSource).setData(data as SourceData);
      } catch (error) {
        if (!cancelled) setMapError(error instanceof Error ? error.message : "Could not load Melbourne suburbs.");
      } finally {
        if (!cancelled) setMapReady(true);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(styleTimeout);
      window.clearTimeout(dataTimeout);
      dataRequest.abort();
      map.off("error", useDataOnlyMap);
      blockRequest.current?.abort();
      suburbRequest.current?.abort();
      mapRef.current = null;
      map.remove();
    };
  }, [accessToken, openBlock, openSuburb]);

  // Restore the full Melbourne suburb view.
  function showAllSuburbs() {
    const map = mapRef.current;
    if (!map) return;
    blockRequest.current?.abort();
    suburbRequest.current?.abort();
    setBlockLoading(false);
    setLoadingSuburb(false);
    setSuburb(null);
    loadedSuburbRef.current = null;
    setHoveredSuburb(null);
    setSelectedBlock(null);
    setHighlighted([]);
    setSearchResetToken((token) => token + 1);
    // Clear detailed geometry before restoring the overview.
    (map.getSource(MESH_SOURCE) as GeoJSONSource)?.setData(EMPTY_COLLECTION as SourceData);
    map.setLayoutProperty(SUBURB_FILL, "visibility", futureRef.current ? "none" : "visible");
    map.setFilter(PROJECTION_FILL, null);
    map.setFilter(SUBURB_LINE, null);
    map.setLayoutProperty(SUBURB_LINE, "visibility", "visible");
    map.setLayoutProperty(MESH_FILL, "visibility", "none");
    map.setLayoutProperty(MESH_LINE, "visibility", "none");
    map.setLayoutProperty(MESH_SELECTED, "visibility", "none");
    map.setFilter(MESH_SELECTED, ["==", ["get", "mb_code16"], ""]);
    if (map.getLayer(MESH_FILL)) map.setPaintProperty(MESH_FILL, "fill-opacity", 0.8);
    map.flyTo({ center: MELBOURNE_CENTER, zoom: 8.55, duration: 900 });
  }

  // --- Guided tour -------------------------------------------------------
  const milestones = model ? plantingMilestones(model, suburb?.canopy_mean ?? null) : [];
  const tourState: TourState = {
    mapReady, future, warming: warmingLevel, projectionStatus,
    projectionDays: future && suburb ? daysBand(selectedProjection) : null,
    suburbCode: suburb?.sa2_code16 ?? null,
    meshReady: !!suburb && !loadingSuburb && loadedSuburbRef.current === suburb.sa2_code16,
    highlighted: highlighted.length,
    blockCode: selectedBlock?.block.mb_code16 ?? null,
    blockLoading, tab: blockTab, trees: addedTrees, maxTrees: model?.max_trees ?? 0,
    milestones, comparison, plantedBlocks: scenarios.length,
  };

  function screenRect(bounds: [[number, number], [number, number]] | null): Rect | null {
    const map = mapRef.current;
    if (!map || !bounds) return null;
    const box = map.getContainer().getBoundingClientRect();
    const a = map.project(bounds[0]);
    const b = map.project(bounds[1]);
    return { left: box.left + Math.min(a.x, b.x), top: box.top + Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  }

  function closeBlock() {
    setSelectedBlock(null);
    setBlockTab("Overview");
    panelRef.current?.querySelector(".map-explorer-content")?.scrollTo({ top: 0 });
    mapRef.current?.setFilter(MESH_SELECTED, ["==", ["get", "mb_code16"], ""]);
  }

  function prefillSearch(text: string) {
    const token = searchResetToken + 1;
    setSearchPrefill({ text, token });
    setSearchResetToken(token);
  }

  // Latest-render actions; the tour calls them through a stable object below.
  const tourActions = useRef<Omit<TourController, "apiBase">>(null!);
  tourActions.current = {
    begin() {
      tourSnapshot.current = scenarios;
      tourActiveRef.current = true;
      setScenarios([]);
      setPlantingNotice("");
    },
    end() {
      tourActiveRef.current = false;
      setScenarios(tourSnapshot.current);
      setComparison("after");
      setPreviewBefore(false);
      setPlantingNotice("");
      setBlockTab("Overview");
      futureRef.current = false;
      setFuture(false);
      setSearchPrefill(null);
      showAllSuburbs();
      setTourActive(false);
    },
    setFuture(on) { if (futureRef.current !== on) void toggleFuture(); },
    setWarming: setWarmingLevel,
    showAll: showAllSuburbs,
    openSuburb(target, text) { prefillSearch(text); void openSuburb(target); },
    streetSearch(text) { prefillSearch(text); },
    clearHighlight() {
      const map = mapRef.current;
      if (map?.getLayer(MESH_FILL)) {
        map.setFilter(MESH_SELECTED, ["==", ["get", "mb_code16"], ""]);
        map.setPaintProperty(MESH_FILL, "fill-opacity", 0.8);
      }
      setHighlighted([]);
      setSearchPrefill(null);
      setSearchResetToken(token => token + 1);
    },
    openBlock(code) { void openBlock(code); },
    closeBlock,
    setTab: setBlockTab,
    setTrees: changeTrees,
    setComparison,
    setSheet(size) { setSheetRequest(current => ({ size, nonce: (current?.nonce ?? 0) + 1 })); },
    openPlantedList() { panelRef.current?.querySelector<HTMLDetailsElement>(".planted-blocks")?.setAttribute("open", ""); },
    suburbSummary(code) {
      const properties = suburbDataRef.current.features.find(item => item.properties?.sa2_code16 === code)?.properties;
      return properties ? {
        sa2_code16: propertyText(properties, "sa2_code16"), sa2_name: propertyText(properties, "sa2_name"),
        lga_name: propertyText(properties, "lga_name"), n_blocks: propertyNumber(properties, "n_blocks"),
        uhi_mean: properties.uhi_mean == null ? null : propertyNumber(properties, "uhi_mean"),
        canopy_mean: properties.canopy_mean == null ? null : propertyNumber(properties, "canopy_mean"),
      } : null;
    },
    suburbRect() {
      if (!suburb) return null;
      const meshReady = loadedSuburbRef.current === suburb.sa2_code16;
      const feature = suburbDataRef.current.features.find(item => item.properties?.sa2_code16 === suburb.sa2_code16);
      return screenRect(meshReady ? boundsFor(meshDataRef.current) : feature ? boundsFor({ type: "FeatureCollection", features: [feature] }) : null);
    },
    blockRect(code) {
      const feature = meshDataRef.current.features.find(item => String(item.properties?.mb_code16) === code);
      const bounds = polygonBounds(polygonsFor(feature?.geometry ?? null));
      return screenRect(bounds as [[number, number], [number, number]] | null);
    },
  };
  const tourController = useMemo<TourController>(() => {
    const call = <K extends keyof Omit<TourController, "apiBase">>(key: K) =>
      ((...args: unknown[]) => (tourActions.current[key] as (...a: unknown[]) => unknown)(...args)) as TourController[K];
    return {
      apiBase: API_BASE,
      begin: call("begin"), end: call("end"), setFuture: call("setFuture"), setWarming: call("setWarming"),
      showAll: call("showAll"), openSuburb: call("openSuburb"), streetSearch: call("streetSearch"),
      clearHighlight: call("clearHighlight"), openBlock: call("openBlock"), closeBlock: call("closeBlock"),
      setTab: call("setTab"), setTrees: call("setTrees"), setComparison: call("setComparison"),
      setSheet: call("setSheet"), openPlantedList: call("openPlantedList"), suburbSummary: call("suburbSummary"),
      suburbRect: call("suburbRect"), blockRect: call("blockRect"),
    };
  }, []);
  const searchInitial = searchPrefill?.token === searchResetToken ? searchPrefill.text : undefined;
  // The prefill is one-shot: the search box remounts when a block opens, and must
  // not replay the tour's street search (which would reopen the suburb).
  useEffect(() => {
    if (searchPrefill) setSearchPrefill(null);
  }, [searchPrefill]);

  return (
    <main className={`melbourne-map-page${future ? " is-future-view" : ""}`}>
      <div ref={containerRef} className="melbourne-map-canvas" aria-label="Interactive urban heat map of metropolitan Melbourne" />
      {mapReady && !future && selectedBlock && <MapPlantingFeedback key={`feedback-${selectedBlock.block.mb_code16}`}
        mapRef={mapRef} panelRef={panelRef} geometry={selectedGeometry} trees={addedTrees} maxTrees={model?.max_trees ?? 0}
        cooling={displayed?.cooling ?? 0} revision={plantingRevision} interacting={plantingInteracting}
        after={effectiveComparison === "after"} reducedMotion={reducedMotion} />}
      <ProjectionControls future={future} onToggle={toggleFuture} level={warmingLevel} onLevel={setWarmingLevel} />
      <div className="map-view-actions">
        <button
          className="map-tour-button"
          type="button"
          onClick={() => setTourActive(true)}
          disabled={!mapReady || tourActive}
          aria-haspopup="dialog"
          title="Take a guided tour of the map"
        >
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4.5 7.5 3l5 1.5L17 3v12.5L12.5 17l-5-1.5L3 17Z" /><path d="M7.5 3v12.5M12.5 4.5V17" />
          </svg>
          <span>Take the tour</span>
        </button>
        <button
          className="map-reset-button"
          type="button"
          onClick={showAllSuburbs}
          disabled={!mapReady}
          aria-label="Reset map view"
          title="Reset map view"
        >
          <span>Reset view</span>
        </button>
      </div>

      <ExplorerPanel panelRef={panelRef} selectionKey={`${future}-${selectedBlock?.block.mb_code16 ?? suburb?.sa2_code16 ?? "all"}`}
        title={selectedBlock && !future ? (selectedBlock.streets.join(" / ") || `Block ${selectedBlock.block.mb_code16}`) : suburb?.sa2_name || "Explore Melbourne"}
        summary={selectedBlock && !future ? `${metricValue(displayed?.heat ?? selectedBlock.block.uhi_mean, "heat")} · ${metricValue(displayed?.canopy ?? selectedBlock.block.canopy_pct, "canopy")} canopy${effectiveComparison === "after" && addedTrees > 0 ? " · Modelled" : " · Baseline"}` : "Search or select a location to explore"}
        onCollapse={() => setPreviewBefore(false)} sizeRequest={sheetRequest} className={`map-explorer-panel${selectedBlock && !future ? " has-selected-block" : ""}${future && suburb ? " has-projection-suburb" : ""}`}>
        {(!selectedBlock || future) && <>
        <p className="map-page-eyebrow">{future ? "2050 vision · Melbourne suburbs" : "Melbourne · 2018 mesh blocks"}</p>
        {future && projectionStatus === "error" && <p className="projection-failure" role="alert">2050 projection failed to load</p>}
        <h1>{suburb ? suburb.sa2_name : future ? "A hotter future. A reason to plant." : "See the heat beneath your suburb."}</h1>
        <p className="map-page-intro">
          {future ? "Without planting today, we miss the chance to grow shade for a warmer future. Explore projected extreme heat across our suburbs."
          : suburb
            ? `${suburb.n_blocks.toLocaleString()} mesh blocks in ${suburb.lga_name}. Select a block to inspect its heat and canopy.`
            : "Explore all 54,239 mapped neighbourhood blocks. Choose a suburb on the map or search by name to reveal its local pattern."}
        </p>
        </>}
        {selectedBlock && !future ? <details className="selected-block-search" key={selectedBlock.block.mb_code16}>
          <summary>Search another location</summary>
        <UnifiedSearch
          key={`${searchResetToken}-${future}`}
          initialQuery={searchInitial}
          suburbsOnly={future}
          onSelectSuburb={(result) => void openSuburb(result)}
          onStreetMatch={(sa2Code16, mbCodes) => void openStreetMatch(sa2Code16, mbCodes)}
        />
        </details> : <>
        <UnifiedSearch
          key={`${searchResetToken}-${future}`}
          initialQuery={searchInitial}
          suburbsOnly={future}
          onSelectSuburb={(result) => void openSuburb(result)}
          onStreetMatch={(sa2Code16, mbCodes) => void openStreetMatch(sa2Code16, mbCodes)}
        />
        </>}
        {suburb && (!selectedBlock || future) && <button className="map-back-button" type="button" onClick={showAllSuburbs}>← Back to all suburbs</button>}

        {future && <div className="projection-detail" aria-live="polite">
          <span>{warmingLabel(warmingLevel)} global warming</span>
          {projectionStatus === "error" ? null
            : projectionStatus !== "ready" ? <p>Loading 2050 projections…</p>
            : projectionSuburb ? <>
              {!suburb && <h2>{projectionSuburb.sa2_name}</h2>}<p className="projection-days">{daysBand(selectedProjection)}<small>{selectedProjection?.days_lower != null ? "days/year ≥35°C" : ""}</small></p>
              {suburb && <ProjectionHelp band={selectedProjection} level={warmingLevel} suburbName={suburb.sa2_name} />}
            </> : <p>Choose a suburb to see its projected hot-day band.</p>}
          <p className="projection-context">Climate projections by warming level, not an exact forecast for 2050. Added trees provide shade; this dataset does not measure their effect on hot-day counts.</p>
          {savedTrees > 0 && <p className="projection-saved">Your {savedTrees.toLocaleString()} added {savedTrees === 1 ? "tree is" : "trees are"} saved. Switch to 🌳 to explore canopy and cooling.</p>}
          {suburb && <button className="projection-planting-link" type="button" onClick={async () => {
            setBlockTab("Plant");
            await toggleFuture();
            if (!futureRef.current && loadedSuburbRef.current === suburb.sa2_code16) {
              setPlantingNotice(selectedBlock ? "" : `Pick a block in ${suburb.sa2_name} to add trees and explore its mature canopy and cooling.`);
              panelRef.current?.querySelector<HTMLElement>('.block-planting')?.scrollIntoView({ block: 'nearest' });
            }
          }}>
            <span>What could trees change in {suburb.sa2_name}?</span>
            <strong>Try planting today <span aria-hidden="true">↗</span></strong>
          </button>}
        </div>}

        {(!future && hoveredSuburb && !suburb) && (
          <div className="suburb-hover-card" aria-live="polite">
            <strong>{hoveredSuburb.sa2_name}</strong>
            <span>{hoveredSuburb.n_blocks.toLocaleString()} mesh blocks · {hoveredSuburb.lga_name}</span>
          </div>
        )}

        {!future && blockLoading && <p role="status">Reading this mesh block…</p>}
        {!future && selectedBlock && <SelectedBlockPanel key={`block-panel-${selectedBlock.block.mb_code16}`}
          detail={selectedBlock} suburb={suburb}
          heat={displayed?.heat ?? selectedBlock.block.uhi_mean}
          canopy={displayed?.canopy ?? selectedBlock.block.canopy_pct}
          modelled={effectiveComparison === "after" && addedTrees > 0 && !!displayed}
          tab={blockTab} onTab={setBlockTab}
          onBack={() => {
            setSelectedBlock(null);
            setBlockTab("Overview");
            panelRef.current?.querySelector(".map-explorer-content")?.scrollTo({ top: 0 });
            mapRef.current?.setFilter(MESH_SELECTED, ["==", ["get", "mb_code16"], ""]);
          }}>
          <BlockPlanting model={model} trees={addedTrees} onChange={changeTrees} onInteractionChange={setPlantingInteracting}
            suburbCanopy={suburb?.canopy_mean ?? null} previewBefore={previewBefore} onPreview={setPreviewBefore}
            previewEnabled={!future && blockTab === "Plant" && comparison === "after"} />
        </SelectedBlockPanel>}
        <div hidden={!!selectedBlock && blockTab !== "Plant"}>
        {!future && suburb && (selectedBlock || scenarios.length > 0) && <div className="planting-controls">
          <div className="planting-map-toggle" role="group" aria-label="Compare map before and after planting">
            <button type="button" aria-pressed={comparison === "before"} onClick={() => setComparison("before")}>Before</button>
            <button type="button" aria-pressed={comparison === "after"} onClick={() => setComparison("after")}>After</button>
          </div>
          <button className="planting-reset" type="button" disabled={scenarios.length === 0} onClick={resetPlanting}>Reset all</button>
        </div>}
        {!future && suburb && (selectedBlock || scenarios.length > 0) && <details className="planted-blocks" key={suburb.sa2_code16}>
          <summary><span>Added trees in {suburb.sa2_name}</span><span className="planted-blocks-count">{scenarios.length} {scenarios.length === 1 ? "block" : "blocks"}</span></summary>
          <p className="planted-blocks-hint">Keep adding trees across this suburb. Switching to another suburb clears these additions.</p>
          {scenarios.length ? <ul>
            {scenarios.map(scenario => <li key={scenario.code} className={scenario.code === selectedBlock?.block.mb_code16 ? "is-selected" : ""}>
              <button type="button" className="planted-block-view" onClick={() => viewPlantedBlock(scenario.code)} aria-label={`View block ${scenario.code}, ${scenario.trees} added trees`} aria-current={scenario.code === selectedBlock?.block.mb_code16 ? "true" : undefined}>
                <span>Block {scenario.code}</span><strong>{scenario.trees.toLocaleString()} {scenario.trees === 1 ? "tree" : "trees"} added</strong>
              </button>
              <button type="button" className="planted-block-reset" aria-label={`Reset block ${scenario.code}`} onClick={() => resetBlock(scenario.code)}>Reset</button>
            </li>)}
          </ul> : <p className="planted-blocks-empty">Blocks appear here when you add trees.</p>}
        </details>}
        </div>
        {!future && plantingNotice && <p className="planting-notice" role="status">{plantingNotice}</p>}
      </ExplorerPanel>

      {future && projectionData && <ProjectionLegend data={projectionData} />}
      {!future && <div className="map-heat-legend" aria-label="Surface heat legend">
        <span>Cooler</span><i /><span>Hotter</span>
        <small>{suburb && scenarios.length > 0 ? `${effectiveComparison === "after" ? "After planting · modelled" : "Before planting · observed"} · ` : ""}°C above non-urban baseline</small>
      </div>}

      {(!mapReady || loadingSuburb) && <div className="map-page-loading">{loadingSuburb ? "Drawing mesh blocks…" : "Mapping Melbourne…"}</div>}
      {!resolveMapStyle(accessToken).accessToken && <div className="map-page-error">Add a public Mapbox token (pk.*) to frontend/.env.local.</div>}
      {mapError && <div className="map-page-error" role="alert">{mapError}</div>}
      {basemapUnavailable && !mapError && <div className="map-basemap-notice" role="status">Background map unavailable. Suburb and block data remain available.</div>}
      {tourActive && <MapTour state={tourState} controller={tourController} />}
    </main>
  );
}

// search a suburb by name, or "street, suburb" to highlight matching blocks
// on the currently loaded suburb's mesh -- a comma is what decides the mode
type StreetStatus =
  | { kind: "match"; count: number; label: string }
  | { kind: "empty"; label: string };

// Search for suburbs or matching street blocks.
function UnifiedSearch({
  onSelectSuburb,
  onStreetMatch,
  suburbsOnly = false,
  initialQuery,
}: {
  onSelectSuburb: (result: SearchResult) => void;
  onStreetMatch: (sa2Code16: string, mbCodes: string[]) => void;
  suburbsOnly?: boolean;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(() => {
    if (initialQuery !== undefined) return initialQuery;
    const saved = sessionStorage.getItem("coolchange-suburb-query") || "";
    sessionStorage.removeItem("coolchange-suburb-query");
    return saved.replace(/\s+VIC(?:\s+\d{4})?$/i, "");
  });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [streetStatus, setStreetStatus] = useState<StreetStatus | null>(null);

  const commaIndex = query.indexOf(",");
  const isStreetMode = !suburbsOnly && commaIndex >= 0;
  const streetPart = isStreetMode ? query.slice(0, commaIndex).trim() : "";
  const suburbPart = isStreetMode ? query.slice(commaIndex + 1).trim() : "";

  // suburb mode: request matches after the user pauses typing
  useEffect(() => {
    if (isStreetMode) {
      setResults([]);
      return undefined;
    }
    const value = query.trim();
    if (value.length < 2) {
      setResults([]);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    // wait briefly so each keystroke does not create a request
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(value)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search failed");
        const payload = (await response.json()) as { results: SearchResult[] };
        setResults(payload.results);
        setActiveIndex(payload.results.length ? 0 : -1);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, isStreetMode]);

  // Search for matching street blocks after a short delay.
  useEffect(() => {
    if (!isStreetMode || streetPart.length < 2 || suburbPart.length === 0) {
      setStreetStatus(null);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${API_BASE}/street-search?street=${encodeURIComponent(streetPart)}&suburb=${encodeURIComponent(suburbPart)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Street search failed");
        const payload = (await response.json()) as { results: StreetResult[] };
        const blocks = payload.results.flatMap((result) => result.blocks);
        if (!blocks.length) {
          setStreetStatus({ kind: "empty", label: suburbPart });
          return;
        }
        // Use the shared suburb code from the first matched block.
        const sa2Code16 = blocks[0].sa2_code16;
        const mbCodes = blocks.map((block) => block.mb_code16);
        setStreetStatus({ kind: "match", count: mbCodes.length, label: suburbPart });
        onStreetMatch(sa2Code16, mbCodes);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setStreetStatus({ kind: "empty", label: suburbPart });
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // Run this effect only when the search query changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreetMode, streetPart, suburbPart]);

  // Clear the search field and results.
  function clearSearch() {
    setQuery("");
    setResults([]);
    setStreetStatus(null);
    setIsOpen(false);
  }

  // Select a suburb and close the result list.
  function chooseSuburb(result: SearchResult) {
    setQuery(result.sa2_name);
    setResults([]);
    setIsOpen(false);
    onSelectSuburb(result);
  }

  // Handle keyboard navigation in the result list.
  function handleKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (isStreetMode || !results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      chooseSuburb(results[activeIndex]);
    } else if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div className="suburb-search">
      <label htmlFor="unified-search-input">{suburbsOnly ? "Find a suburb" : 'Find a suburb, or type "street, suburb"'}</label>
      <div className="suburb-search-input-wrap">
        <span aria-hidden="true">⌕</span>
        <input
          id="unified-search-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeys}
          placeholder={suburbsOnly ? "Try Brunswick or Melton" : "Try Brunswick, or Smith Street, Ringwood"}
          autoComplete="off"
          role={isStreetMode ? undefined : "combobox"}
          aria-autocomplete={isStreetMode ? undefined : "list"}
          aria-expanded={!isStreetMode && isOpen && results.length > 0}
          aria-controls={isStreetMode ? undefined : "suburb-search-results"}
          aria-activedescendant={!isStreetMode && activeIndex >= 0 ? `suburb-option-${activeIndex}` : undefined}
        />
        {loading ? (
          <span className="search-spinner" aria-label="Searching" />
        ) : query.length > 0 ? (
          <button
            type="button"
            className="search-clear-button"
            aria-label="Clear search"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearSearch}
          >
            ×
          </button>
        ) : null}
      </div>

      {!isStreetMode && isOpen && results.length > 0 && (
        <ul id="suburb-search-results" className="suburb-search-results" role="listbox">
          {results.map((result, index) => (
            <li
              id={`suburb-option-${index}`}
              key={result.sa2_code16}
              role="option"
              aria-selected={activeIndex === index}
            >
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuburb(result)}>
                <span><strong>{result.sa2_name}</strong><small>{result.lga_name}</small></span>
                <em>{result.n_blocks.toLocaleString()} blocks</em>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isStreetMode && streetStatus?.kind === "match" && (
        <p className="street-search-status" aria-live="polite">
          Highlighting {streetStatus.count} mesh block{streetStatus.count === 1 ? "" : "s"} in {streetStatus.label} — click one to see its details.
        </p>
      )}
      {isStreetMode && streetStatus?.kind === "empty" && (
        <p className="street-search-status street-search-empty" aria-live="polite">
          No matching street found in {streetStatus.label}.
        </p>
      )}
    </div>
  );
}
