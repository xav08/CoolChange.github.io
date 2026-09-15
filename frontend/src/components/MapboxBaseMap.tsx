import { useEffect, useRef, useState } from "react";
import mapboxgl, { type ExpressionSpecification } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { StoryLayer } from "../data/storyData";
import {
  CLYDE_NORTH,
  clydeNorthFade,
  loadPopulationDensityPoints,
} from "../utils/mapOverlayData";
import { resolveMapStyle } from "../utils/mapStyle";

const HEAT_SOURCE = "coolchange-heat-source";
const CANOPY_SOURCE = "coolchange-canopy-source";
const HEAT_LAYER = "coolchange-heat";
const PARK_LAYER = "coolchange-parks";
const RESERVE_LAYER = "coolchange-national-reserves";
const FUTURE_LAYER = "coolchange-future";

type RgbColour = [number, number, number];

const heatStops = [
  { density: 0, colour: [0, 45, 58], cooledColour: [0, 45, 58], alpha: 0 },
  { density: 0.03, colour: [0, 82, 105], cooledColour: [0, 82, 105], alpha: 0.34 },
  { density: 0.12, colour: [0, 137, 157], cooledColour: [0, 137, 157], alpha: 0.5 },
  { density: 0.25, colour: [0, 181, 177], cooledColour: [0, 181, 177], alpha: 0.62 },
  { density: 0.4, colour: [52, 194, 116], cooledColour: [52, 194, 116], alpha: 0.7 },
  { density: 0.54, colour: [181, 215, 52], cooledColour: [119, 194, 98], alpha: 0.78 },
  { density: 0.68, colour: [255, 209, 37], cooledColour: [74, 184, 123], alpha: 0.86 },
  { density: 0.84, colour: [255, 145, 24], cooledColour: [48, 170, 137], alpha: 0.92 },
  { density: 1, colour: [244, 82, 30], cooledColour: [36, 158, 144], alpha: 0.96 },
] as const;

// blend two colours by a fractional amount
function blendColour(start: readonly number[], end: readonly number[], amount: number): RgbColour {
  return [
    Math.round(start[0] + (end[0] - start[0]) * amount),
    Math.round(start[1] + (end[1] - start[1]) * amount),
    Math.round(start[2] + (end[2] - start[2]) * amount),
  ];
}

// format a colour for mapbox paint rules
function rgba([red, green, blue]: RgbColour, alpha: number) {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

// shift the heat palette as simulated cooling increases
function heatColours(cooling = 0): ExpressionSpecification {
  const colourShift = Math.min(cooling / 0.72, 1);

  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    ...heatStops.flatMap((stop) => [
      stop.density,
      rgba(blendColour(stop.colour, stop.cooledColour, colourShift), stop.alpha),
    ]),
  ] as ExpressionSpecification;
}

type MapboxBaseMapProps = {
  label: string;
  layer: StoryLayer;
  cooling: number;
};

// toggle a map layer when it is available
function setLayerVisibility(map: mapboxgl.Map, layerId: string, visible: boolean) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

// fade heat layers out when the map is too zoomed out
function heatZoomFade(map: mapboxgl.Map) {
  const fullyVisibleAt = 13.2;
  const hiddenAt = 12.6;
  const zoom = map.getZoom();

  if (zoom >= fullyVisibleAt) return 1;
  if (zoom <= hiddenAt) return 0;

  return (zoom - hiddenAt) / (fullyVisibleAt - hiddenAt);
}

// apply the selected story state to map layers
function updateMapLayers(map: mapboxgl.Map, layer: StoryLayer, cooling: number, locationFade = 1) {
  const showHeat = layer === "heat";
  const showFuture = layer === "future";
  const visibleOpacity = locationFade * heatZoomFade(map);

  setLayerVisibility(map, HEAT_LAYER, showHeat);
  setLayerVisibility(map, PARK_LAYER, layer === "canopy");
  setLayerVisibility(map, RESERVE_LAYER, layer === "canopy");
  setLayerVisibility(map, FUTURE_LAYER, showFuture);

  if (map.getLayer(HEAT_LAYER)) {
    map.setPaintProperty(HEAT_LAYER, "heatmap-color", heatColours());
    map.setPaintProperty(HEAT_LAYER, "heatmap-opacity", 0.68 * visibleOpacity);
  }

  if (map.getLayer(FUTURE_LAYER)) {
    map.setPaintProperty(FUTURE_LAYER, "heatmap-color", heatColours(cooling));
    map.setPaintProperty(FUTURE_LAYER, "heatmap-opacity", 0.76 * visibleOpacity);
  }

}

// create and maintain the clyde north map
export function MapboxBaseMap({ label, layer, cooling }: MapboxBaseMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const currentLayerRef = useRef(layer);
  const coolingRef = useRef(cooling);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [layersReady, setLayersReady] = useState(false);
  const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

  // keep current controls without recreating the map
  currentLayerRef.current = layer;
  coolingRef.current = cooling;

  // create mapbox sources, layers, and local overlays
  useEffect(() => {
    const container = containerRef.current;
    const mapConfig = resolveMapStyle(accessToken);
    if (!container || !mapConfig.accessToken) return undefined;

    let cancelled = false;

    const map = new mapboxgl.Map({
      container,
      accessToken: mapConfig.accessToken,
      style: mapConfig.style,
      center: CLYDE_NORTH,
      zoom: 13.5,
      bearing: 0,
      pitch: 0,
      attributionControl: true,
    });

    mapRef.current = map;

    const markerElement = document.createElement("div");
    markerElement.className = "map-location-marker";
    markerElement.setAttribute("aria-label", "Clyde North");

    const markerDot = document.createElement("span");
    const markerLabel = document.createElement("strong");
    markerLabel.textContent = "Clyde North";
    markerElement.append(markerDot, markerLabel);

    const marker = new mapboxgl.Marker({ element: markerElement, anchor: "bottom" })
      .setLngLat(CLYDE_NORTH)
      .addTo(map);

    const handleMapMove = () => {
      updateMapLayers(
        map,
        currentLayerRef.current,
        coolingRef.current,
        clydeNorthFade(map),
      );
    };

    map.on("move", handleMapMove);

    map.on("load", async () => {
      try {
        // load both local overlays before adding map layers
        const [heatPoints, greenAreasResponse] = await Promise.all([
          loadPopulationDensityPoints("/maps/clyde-north-roads.json"),
          fetch("/maps/clyde-north-parks.geojson"),
        ]);

        if (!greenAreasResponse.ok) throw new Error("Could not load the Clyde North green areas");

        const greenAreas = await greenAreasResponse.json();

        if (cancelled) return;

        map.addSource(HEAT_SOURCE, { type: "geojson", data: heatPoints });
        map.addSource(CANOPY_SOURCE, {
          type: "geojson",
          data: greenAreas,
        });

        map.addLayer({
          id: HEAT_LAYER,
          type: "heatmap",
          source: HEAT_SOURCE,
          paint: {
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["get", "intensity"],
              0.2, 0.24,
              0.85, 0.58,
            ],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 12, 0.16, 15, 0.29],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 13, 10, 14, 22, 15, 36],
            "heatmap-color": heatColours(),
            "heatmap-opacity": 0.68,
          },
        });

        // reuse density points for the 2050 scenario
        map.addLayer({
          id: FUTURE_LAYER,
          type: "heatmap",
          source: HEAT_SOURCE,
          layout: { visibility: "none" },
          paint: {
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["get", "intensity"],
              0.2, 0.26,
              0.85, 0.62,
            ],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 12, 0.2, 15, 0.34],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 12, 6, 13, 12, 14, 26, 15, 42],
            "heatmap-color": heatColours(),
            "heatmap-opacity": 0.76,
          },
        });

        map.addLayer({
          id: PARK_LAYER,
          type: "fill",
          source: CANOPY_SOURCE,
          filter: ["==", ["get", "category"], "park"],
          layout: { visibility: "none" },
          paint: {
            "fill-color": "#b8d8c6",
            "fill-opacity": 0.78,
            "fill-outline-color": "#8bbca8",
          },
        });

        map.addLayer({
          id: RESERVE_LAYER,
          type: "fill",
          source: CANOPY_SOURCE,
          filter: ["==", ["get", "category"], "reserve"],
          layout: { visibility: "none" },
          paint: {
            "fill-color": "#69a98f",
            "fill-opacity": 0.9,
            "fill-outline-color": "#1f7b69",
          },
        });

        updateMapLayers(
          map,
          currentLayerRef.current,
          coolingRef.current,
          clydeNorthFade(map),
        );
        setLayersReady(true);
      } catch (error) {
        console.error("Could not prepare the local map layers", error);
      } finally {
        if (!cancelled) setHasLoaded(true);
      }
    });

    return () => {
      cancelled = true;
      map.off("move", handleMapMove);
      marker.remove();
      mapRef.current = null;
      map.remove();
    };
  }, [accessToken]);

  // update visible layers after control changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;
    updateMapLayers(map, layer, cooling, clydeNorthFade(map));
  }, [cooling, layer, layersReady]);

  if (!resolveMapStyle(accessToken).accessToken) {
    return <div className="map-config-message">Add a public Mapbox token (<code>pk.*</code>) to <code>frontend/.env.local</code>.</div>;
  }

  return (
    <div className="mapbox-base" aria-label={label}>
      <div ref={containerRef} className="mapbox-canvas" />
      {!hasLoaded && <div className="map-loading">Loading map and local data</div>}
    </div>
  );
}
