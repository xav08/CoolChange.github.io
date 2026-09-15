import { mkdir, writeFile } from "node:fs/promises";

// define the clyde north area requested from openstreetmap
const bounds = "-38.16,145.28,-38.08,145.38";
const query = `
[out:json][timeout:30];
(
  way["leisure"="park"](${bounds});
  relation["leisure"="park"](${bounds});
  way["leisure"="nature_reserve"](${bounds});
  relation["leisure"="nature_reserve"](${bounds});
  way["boundary"="protected_area"](${bounds});
  relation["boundary"="protected_area"](${bounds});
);
out geom;
`;

// close and normalise polygon rings
function closeRing(points) {
  if (points.length < 3) return null;

  const ring = points.map(({ lon, lat }) => [lon, lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];

  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);

  const signedArea = ring.slice(0, -1).reduce((area, point, index) => {
    const nextPoint = ring[index + 1];
    return area + point[0] * nextPoint[1] - nextPoint[0] * point[1];
  }, 0);

  // use the expected outer ring direction
  if (signedArea < 0) ring.reverse();
  return ring.length >= 4 ? ring : null;
}

// convert one polygon ring into a geojson feature
function featureFromRing(ring, tags, id) {
  const category = tags.boundary === "protected_area"
    || tags.leisure === "nature_reserve"
    || /reserve/i.test(tags.name || "")
    ? "reserve"
    : "park";

  return {
    type: "Feature",
    properties: {
      id,
      name: tags.name || "Unnamed green space",
      category,
    },
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
  };
}

// request green-space geometry from openstreetmap
const response = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "CoolChange university project",
  },
  body: new URLSearchParams({ data: query }),
});

if (!response.ok) throw new Error(`Overpass request failed with ${response.status}`);

const data = await response.json();
// convert returned ways and relations into polygons
const features = [];

for (const element of data.elements) {
  if (element.type === "way" && element.geometry) {
    const ring = closeRing(element.geometry);
    if (ring) features.push(featureFromRing(ring, element.tags || {}, element.id));
  }

  if (element.type === "relation" && element.members) {
    // keep outer polygons from each relation
    for (const member of element.members) {
      if (member.role !== "outer" || !member.geometry) continue;
      const ring = closeRing(member.geometry);
      if (ring) features.push(featureFromRing(ring, element.tags || {}, element.id));
    }
  }
}

// save the generated geojson beside other map assets
const collection = { type: "FeatureCollection", features };
const outputDirectory = new URL("../public/maps/", import.meta.url);

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  new URL("clyde-north-parks.geojson", outputDirectory),
  `${JSON.stringify(collection)}\n`,
);

console.log(`Saved ${features.length} park and reserve polygons`);
