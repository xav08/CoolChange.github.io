import type { Map } from "mapbox-gl";
import type { Theme } from "../hooks/useTheme";

type PaintProperty = Parameters<Map["setPaintProperty"]>[1];
type Paint = { id: string; property: PaintProperty; light: ReturnType<Map["getPaintProperty"]>; dark: string };
const basePaint = new WeakMap<Map, Paint[]>();

// Restyle the basemap in place so selected suburbs, feature state and planting
// survive theme changes. Data layers and their quantitative colours are excluded.
export function applyMapTheme(map: Map, theme: Theme) {
  let paints = basePaint.get(map);
  if (!paints) {
    paints = [];
    for (const layer of map.getStyle()?.layers ?? []) {
      if (/^(melbourne-|suburb-|coolchange-)/.test(layer.id)) continue;
      const add = (property: PaintProperty, dark: string) => paints!.push({ id: layer.id, property, dark, light: map.getPaintProperty(layer.id, property) });
      const water = /water|ocean/.test(layer.id);
      const park = /park|landcover|landuse|national/.test(layer.id);
      if (layer.type === "background") add("background-color", "#18231f");
      if (layer.type === "fill") add("fill-color", water ? "#101e29" : park ? "#24372c" : "#27312d");
      if (layer.type === "fill-extrusion") add("fill-extrusion-color", "#35413a");
      if (layer.type === "line") add("line-color", water ? "#243d4a" : /road|street|bridge|tunnel/.test(layer.id) ? "#424d46" : "#34453c");
      if (layer.type === "symbol" && layer.layout?.["text-field"]) {
        add("text-color", "#c1d0c6");
        add("text-halo-color", "#18231f");
      }
    }
    basePaint.set(map, paints);
  }
  for (const paint of paints) {
    if (map.getLayer(paint.id)) map.setPaintProperty(paint.id, paint.property, theme === "dark" ? paint.dark : paint.light);
  }
}
