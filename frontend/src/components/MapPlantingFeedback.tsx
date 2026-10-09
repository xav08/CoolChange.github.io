import { useEffect, useId, useMemo, useState, type RefObject } from "react";
import type { Map } from "mapbox-gl";
import { canopyDensity, canopyMarkerSize, canopyPoints, polygonBounds, polygonsFor, selectedBlockPadding, type BlockGeometry } from "../utils/canopyGeometry";
import "./map-planting-feedback.css";

type View = { path: string; points: { x: number; y: number }[]; blockSize: number; width: number; height: number };

export function MapPlantingFeedback({ mapRef, panelRef, geometry, trees, maxTrees, after, reducedMotion }: {
  mapRef: RefObject<Map | null>; panelRef: RefObject<HTMLElement | null>; geometry: BlockGeometry | null;
  trees: number; maxTrees: number; after: boolean; reducedMotion: boolean;
}) {
  const clipId = useId();
  const polygons = useMemo(() => polygonsFor(geometry), [geometry]);
  const positions = useMemo(() => canopyPoints(polygons), [polygons]);
  const [view, setView] = useState<View | null>(null);
  const density = canopyDensity(after ? trees : 0, maxTrees);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const project = () => {
      const projected = polygons.map(polygon => polygon.map(ring => ring.map(point => map.project(point))));
      const path = projected.flatMap(polygon => polygon.map(ring => ring.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ") + " Z")).join(" ");
      const points = positions.map(point => map.project(point));
      const flat = projected.flat(2);
      const size = flat.length ? Math.min(Math.max(...flat.map(p => p.x)) - Math.min(...flat.map(p => p.x)), Math.max(...flat.map(p => p.y)) - Math.min(...flat.map(p => p.y))) : 0;
      setView({ path, points, blockSize: size, width: map.getContainer().clientWidth, height: map.getContainer().clientHeight });
    };
    project();
    map.on("move", project);
    map.on("resize", project);
    return () => { map.off("move", project); map.off("resize", project); };
  }, [mapRef, polygons, positions]);

  useEffect(() => {
    const map = mapRef.current;
    const panel = panelRef.current;
    const bounds = polygonBounds(polygons);
    if (!map || !panel || !bounds) return;
    const reposition = () => {
      const canvas = map.getContainer().getBoundingClientRect();
      const rectangle = panel.getBoundingClientRect();
      // A full sheet intentionally covers the map; keep the previous camera until it reopens.
      if (canvas.width <= 760 && rectangle.top - canvas.top < 260) return;
      map.fitBounds(bounds, {
        padding: selectedBlockPadding(canvas.width, canvas.height, { right: rectangle.right - canvas.left, bottom: rectangle.bottom - canvas.top, top: rectangle.top - canvas.top }),
        maxZoom: Math.max(map.getZoom(), 15.5), duration: reducedMotion ? 0 : 400, retainPadding: false,
      });
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(panel);
    map.on("resize", reposition);
    return () => { observer.disconnect(); map.off("resize", reposition); };
  }, [mapRef, panelRef, polygons, reducedMotion]);

  if (!view?.points.length) return null;
  return <svg className="map-planting-feedback" width={view.width} height={view.height} aria-hidden="true" focusable="false">
    <defs><clipPath id={clipId}><path d={view.path} clipRule="evenodd" /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
      {view.points.map((point, index) => {
        const size = canopyMarkerSize(view.points.slice(0, density.count), index, view.blockSize);
        return <image key={index} href="/images/map-tree-crown.png" className="map-tree-crown"
          x={point.x - size / 2} y={point.y - size / 2} width={size} height={size}
          opacity={index < density.count && size >= 3 ? 1 : 0}
          style={{ transitionDuration: reducedMotion ? "0ms" : undefined }} />;
      })}
    </g>
  </svg>;
}
