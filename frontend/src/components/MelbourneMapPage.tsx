import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import mapboxgl, { type GeoJSONSource, type MapMouseEvent } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { resolveMapStyle } from "../utils/mapStyle";

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

type SearchResult = {
  sa2_code16: string;
  sa2_name: string;
  lga_name: string;
  n_blocks: number;
};

type SuburbSummary = SearchResult & {
  uhi_mean?: number;
  canopy_mean?: number;
};

type MeshblockProperties = {
  mb_code16: string;
  uhi_mean: number | null;
  canopy_pct: number | null;
  mb_category: string;
  persons: number | null;
};

type MeshblockDetail = {
  block: MeshblockProperties & {
    sa2_name: string;
    lga_name: string;
    dwellings: number | null;
    area_sqkm: number | null;
  };
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
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [loadingSuburb, setLoadingSuburb] = useState(false);
  const [suburb, setSuburb] = useState<SuburbSummary | null>(null);
  // bumped whenever the search field should clear itself (remounts UnifiedSearch)
  const [searchResetToken, setSearchResetToken] = useState(0);
  const [hoveredSuburb, setHoveredSuburb] = useState<SuburbSummary | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<MeshblockDetail | null>(null);
  const [blockLoading, setBlockLoading] = useState(false);
  const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

  // Load and display mesh blocks for one suburb.
  const openSuburb = useCallback(async (selection: SearchResult | SuburbSummary) => {
    const map = mapRef.current;
    if (!map) return;

    setLoadingSuburb(true);
    setSelectedBlock(null);
    setMapError("");
    try {
      // load mesh blocks only after a suburb is selected
      const response = await fetch(
        `${API_BASE}/map/suburbs/${encodeURIComponent(selection.sa2_code16)}/meshblocks`,
      );
      if (!response.ok) throw new Error("This suburb’s mesh blocks could not be loaded.");
      const data = (await response.json()) as MapFeatureCollection & { suburb: SearchResult };
      const source = map.getSource(MESH_SOURCE) as GeoJSONSource | undefined;
      source?.setData(data as SourceData);
      setSuburb({ ...selection, ...data.suburb });
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
    } catch (error) {
      setMapError(error instanceof Error ? error.message : "Could not load this suburb.");
    } finally {
      setLoadingSuburb(false);
    }
  }, []);

  // Load details for the selected mesh block.
  const openBlock = useCallback(async (mbCode16: string) => {
    const map = mapRef.current;
    if (!map) return;
    map.setFilter(MESH_SELECTED, ["==", ["get", "mb_code16"], mbCode16]);
    // clicking any block -- highlighted or not -- resolves the street search's
    // job; drop the dim so the view returns to normal, leaving just this one
    // block outlined
    if (map.getLayer(MESH_FILL)) map.setPaintProperty(MESH_FILL, "fill-opacity", 0.8);
    setBlockLoading(true);
    try {
      const response = await fetch(`${API_BASE}/meshblocks/${mbCode16}`);
      if (!response.ok) throw new Error("Mesh-block details are unavailable.");
      setSelectedBlock((await response.json()) as MeshblockDetail);
    } catch (error) {
      setMapError(error instanceof Error ? error.message : "Could not load this mesh block.");
    } finally {
      setBlockLoading(false);
    }
  }, []);

  // Highlight blocks matched by a street search.
  const highlightBlocks = useCallback((mbCodes: string[]) => {
    const map = mapRef.current;
    if (!map || !mbCodes.length) return;
    map.setFilter(MESH_SELECTED, ["in", ["get", "mb_code16"], ["literal", mbCodes]]);
    map.setLayoutProperty(MESH_SELECTED, "visibility", "visible");
    map.setPaintProperty(MESH_FILL, "fill-opacity", [
      "case",
      ["in", ["get", "mb_code16"], ["literal", mbCodes]],
      0.85,
      0.15,
    ]);
  }, []);

  // Load a suburb and highlight matching street blocks.
  const openStreetMatch = useCallback(
    async (sa2Code16: string, mbCodes: string[]) => {
      await openSuburb({ sa2_code16: sa2Code16, sa2_name: "", lga_name: "", n_blocks: 0 });
      highlightBlocks(mbCodes);
    },
    [openSuburb, highlightBlocks],
  );

  // Create the Melbourne map and its suburb layers.
  useEffect(() => {
    const container = containerRef.current;
    const mapConfig = resolveMapStyle(accessToken);
    if (!container || !mapConfig.accessToken) return undefined;
    let cancelled = false;

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

    map.on("load", async () => {
      // sources must exist before their layers are added
      map.addSource(SUBURB_SOURCE, { type: "geojson", data: EMPTY_COLLECTION as SourceData });
      map.addSource(MESH_SOURCE, { type: "geojson", data: EMPTY_COLLECTION as SourceData });

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
        id: MESH_FILL,
        type: "fill",
        source: MESH_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "uhi_mean"], 0],
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

      map.on("mouseenter", SUBURB_FILL, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", SUBURB_FILL, () => {
        map.getCanvas().style.cursor = "";
        setHoveredSuburb(null);
      });
      map.on("mousemove", SUBURB_FILL, (event: MapMouseEvent) => {
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
      map.on("click", SUBURB_FILL, (event: MapMouseEvent) => {
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
      map.on("mouseenter", MESH_FILL, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", MESH_FILL, () => { map.getCanvas().style.cursor = ""; });
      map.on("click", MESH_FILL, (event: MapMouseEvent) => {
        // use the rendered feature id to request the detailed metrics on demand
        const code = propertyText(eventProperties(event), "mb_code16");
        if (code) void openBlock(code);
      });

      try {
        // load lightweight suburb outlines for the first view
        const response = await fetch(`${API_BASE}/map/suburbs`);
        if (!response.ok) throw new Error("Melbourne map geometry is unavailable.");
        const data = (await response.json()) as MapFeatureCollection;
        if (cancelled) return;
        (map.getSource(SUBURB_SOURCE) as GeoJSONSource).setData(data as SourceData);
      } catch (error) {
        setMapError(error instanceof Error ? error.message : "Could not load Melbourne suburbs.");
      } finally {
        if (!cancelled) setMapReady(true);
      }
    });

    return () => {
      cancelled = true;
      mapRef.current = null;
      map.remove();
    };
  }, [accessToken, openBlock, openSuburb]);

  // Restore the full Melbourne suburb view.
  function showAllSuburbs() {
    const map = mapRef.current;
    if (!map) return;
    setSuburb(null);
    setSelectedBlock(null);
    setSearchResetToken((token) => token + 1);
    // Clear detailed geometry before restoring the overview.
    (map.getSource(MESH_SOURCE) as GeoJSONSource)?.setData(EMPTY_COLLECTION as SourceData);
    map.setLayoutProperty(SUBURB_FILL, "visibility", "visible");
    map.setLayoutProperty(SUBURB_LINE, "visibility", "visible");
    map.setLayoutProperty(MESH_FILL, "visibility", "none");
    map.setLayoutProperty(MESH_LINE, "visibility", "none");
    map.setLayoutProperty(MESH_SELECTED, "visibility", "none");
    map.setFilter(MESH_SELECTED, ["==", ["get", "mb_code16"], ""]);
    if (map.getLayer(MESH_FILL)) map.setPaintProperty(MESH_FILL, "fill-opacity", 0.8);
    map.flyTo({ center: MELBOURNE_CENTER, zoom: 8.55, duration: 900 });
  }

  return (
    <main className="melbourne-map-page">
      <div ref={containerRef} className="melbourne-map-canvas" aria-label="Interactive urban heat map of metropolitan Melbourne" />

      <section className="map-explorer-panel" aria-label="Map explorer">
        <p className="map-page-eyebrow">Melbourne · 2018 mesh blocks</p>
        <h1>{suburb ? suburb.sa2_name : "See the heat beneath your suburb."}</h1>
        <p className="map-page-intro">
          {suburb
            ? `${suburb.n_blocks.toLocaleString()} mesh blocks in ${suburb.lga_name}. Select a block to inspect its heat and canopy.`
            : "Explore all 54,239 mapped neighbourhood blocks. Choose a suburb on the map or search by name to reveal its local pattern."}
        </p>
        <UnifiedSearch
          key={searchResetToken}
          onSelectSuburb={(result) => void openSuburb(result)}
          onStreetMatch={(sa2Code16, mbCodes) => void openStreetMatch(sa2Code16, mbCodes)}
        />
        {suburb && <button className="map-back-button" type="button" onClick={showAllSuburbs}>← Back to all suburbs</button>}

        {(hoveredSuburb && !suburb) && (
          <div className="suburb-hover-card" aria-live="polite">
            <strong>{hoveredSuburb.sa2_name}</strong>
            <span>{hoveredSuburb.n_blocks.toLocaleString()} mesh blocks · {hoveredSuburb.lga_name}</span>
          </div>
        )}

        {(blockLoading || selectedBlock) && (
          <div className="mesh-detail-card" aria-live="polite">
            {blockLoading && !selectedBlock ? <p>Reading this mesh block…</p> : selectedBlock && (
              <>
                <div className="mesh-detail-heading"><span>Selected mesh block</span><strong>{selectedBlock.block.mb_code16}</strong></div>
                <dl>
                  <div className="metric-item">
                    <dt>Surface heat</dt>
                    <MetricHelp label="About surface heat">2018 satellite surface heat above non-urban land.</MetricHelp>
                    <dd>{selectedBlock.block.uhi_mean == null ? "Not available" : `${selectedBlock.block.uhi_mean.toFixed(1)}°C`}</dd>
                  </div>
                  <div className="metric-item">
                    <dt>Tree canopy</dt>
                    <MetricHelp label="About tree canopy">Tree canopy cover in this block, measured in 2018.</MetricHelp>
                    <dd>{selectedBlock.block.canopy_pct == null ? "Not available" : `${selectedBlock.block.canopy_pct.toFixed(1)}%`}</dd>
                  </div>
                  <div className="metric-item"><dt>Category</dt><dd>{selectedBlock.block.mb_category || "Not classified"}</dd></div>
                  <div className="metric-item"><dt>Population</dt><dd>{selectedBlock.block.persons?.toLocaleString() ?? "Not published"}</dd></div>
                </dl>
              </>
            )}
          </div>
        )}
      </section>

      <div className="map-heat-legend" aria-label="Surface heat legend">
        <span>Cooler</span><i /><span>Hotter</span>
        <small>°C above non-urban baseline</small>
      </div>

      {(!mapReady || loadingSuburb) && <div className="map-page-loading">{loadingSuburb ? "Drawing mesh blocks…" : "Mapping Melbourne…"}</div>}
      {!resolveMapStyle(accessToken).accessToken && <div className="map-page-error">Add a public Mapbox token (pk.*) to frontend/.env.local.</div>}
      {mapError && <div className="map-page-error" role="alert">{mapError}</div>}
    </main>
  );
}

// Show a short explanation for a metric.
function MetricHelp({ children, label }: { children: string; label: string }) {
  return (
    <span className="metric-help" role="img" aria-label={label}>
      ?
      <span className="metric-help-tooltip">{children}</span>
    </span>
  );
}

type StreetStatus =
  | { kind: "match"; count: number; label: string }
  | { kind: "empty"; label: string };

// Search for suburbs or matching street blocks.
function UnifiedSearch({
  onSelectSuburb,
  onStreetMatch,
}: {
  onSelectSuburb: (result: SearchResult) => void;
  onStreetMatch: (sa2Code16: string, mbCodes: string[]) => void;
}) {
  const [query, setQuery] = useState(() => {
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
  const isStreetMode = commaIndex >= 0;
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
      <label htmlFor="unified-search-input">Find a suburb, or type "street, suburb"</label>
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
          placeholder="Try Brunswick, or Smith Street, Ringwood"
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
