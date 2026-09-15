import type { Map } from "mapbox-gl";

type OverlayPoint = {
  type: "Feature";
  properties: {
    intensity: number;
    kind: "road";
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
};

export type OverlayPointCollection = {
  type: "FeatureCollection";
  features: OverlayPoint[];
};

type RoadDensityFile = {
  points: [number, number, number][];
};

export const CLYDE_NORTH: [number, number] = [145.327, -38.119];

// load road density points for the local heat overlay
export async function loadPopulationDensityPoints(url: string): Promise<OverlayPointCollection> {
  const response = await fetch(url);

  if (!response.ok) throw new Error("Could not load the Clyde North density data");

  const data = await response.json() as RoadDensityFile;
  // expand the compact density file into geojson features
  const features: OverlayPoint[] = data.points.map(([longitude, latitude, intensity]) => ({
    type: "Feature",
    properties: { intensity, kind: "road" },
    geometry: {
      type: "Point",
      coordinates: [longitude, latitude],
    },
  }));

  return { type: "FeatureCollection", features };
}

// fade the overlay when the map leaves clyde north
export function clydeNorthFade(map: Map) {
  const centre = map.getCenter();
  // adjust longitude to match local map distance
  const longitudeDistance = (centre.lng - CLYDE_NORTH[0]) * 0.79;
  const latitudeDistance = centre.lat - CLYDE_NORTH[1];
  const distance = Math.hypot(longitudeDistance, latitudeDistance);
  const fullOpacityRadius = 0.025;
  const hiddenRadius = 0.055;

  if (distance <= fullOpacityRadius) return 1;
  if (distance >= hiddenRadius) return 0;

  return 1 - (distance - fullOpacityRadius) / (hiddenRadius - fullOpacityRadius);
}
