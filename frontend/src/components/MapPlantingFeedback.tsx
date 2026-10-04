import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import type { Map } from "mapbox-gl";
import { canopyDensity, canopyPoints, polygonBounds, polygonsFor, selectedBlockPadding, type BlockGeometry } from "../utils/canopyGeometry";
import { queueCoolingPulse } from "../utils/coolingFeedback";
import "./map-planting-feedback.css";

type View = { path: string; points: { x: number; y: number }[]; radius: number; width: number; height: number };

export function MapPlantingFeedback({ mapRef, panelRef, geometry, trees, maxTrees, cooling, revision, interacting, after, reducedMotion }: {
  mapRef: RefObject<Map | null>; panelRef: RefObject<HTMLElement | null>; geometry: BlockGeometry | null;
  trees: number; maxTrees: number; cooling: number; revision: number; interacting: boolean; after: boolean; reducedMotion: boolean;
}) {
  const clipId = useId();
  const polygons = useMemo(() => polygonsFor(geometry), [geometry]);
  const positions = useMemo(() => canopyPoints(polygons), [polygons]);
  const [view, setView] = useState<View | null>(null);
  const [pulse, setPulse] = useState<number | null>(null);
  const consumed = useRef(revision);
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
      setView({ path, points, radius: Math.max(2, Math.min(14, size / 6)), width: map.getContainer().clientWidth, height: map.getContainer().clientHeight });
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
        maxZoom: map.getZoom(), duration: reducedMotion ? 0 : 400, retainPadding: false,
      });
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(panel);
    map.on("resize", reposition);
    return () => { observer.disconnect(); map.off("resize", reposition); };
  }, [mapRef, panelRef, polygons, reducedMotion]);

  useEffect(() => {
    setPulse(null);
    // Switching modes, clearing trees or requesting reduced motion must not replay a stale result.
    return queueCoolingPulse(revision, consumed, after && trees > 0 && !reducedMotion && positions.length > 0, interacting, setPulse);
  }, [revision, interacting, after, trees, reducedMotion, positions]);

  if (!view?.points.length) return null;
  const anchor = view.points[0];
  const labelX = Math.max(94, Math.min(view.width - 94, anchor.x));
  const labelY = Math.max(24, Math.min(view.height - 24, anchor.y - 30));
  return <svg className="map-planting-feedback" width={view.width} height={view.height} aria-hidden="true" focusable="false">
    <defs><clipPath id={clipId}><path d={view.path} clipRule="evenodd" /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}>
      {view.points.map((point, index) => <circle key={index} className="map-canopy-circle" cx={point.x} cy={point.y}
        r={index < density.count ? view.radius * (0.45 + 0.55 * density.ratio) : 0}
        opacity={index < density.count ? 0.35 : 0} style={{ transitionDuration: reducedMotion ? "0ms" : undefined }} />)}
    </g>
    {pulse !== null && !reducedMotion && after && <g key={pulse} className="map-cooling-pulse" onAnimationEnd={() => setPulse(null)}>
      <path d={view.path} className="map-cooling-border" fillRule="evenodd" />
      <circle cx={anchor.x} cy={anchor.y} r={Math.max(20, view.radius * 3)} className="map-cooling-halo" />
      <g transform={`translate(${labelX}, ${labelY})`}>
        <rect x="-87" y="-15" width="174" height="30" rx="15" className="map-cooling-label-background" />
        <text textAnchor="middle" dominantBaseline="central" className="map-cooling-label">{cooling > 0 ? "−" : ""}{cooling.toFixed(2)}°C · modelled cooling</text>
      </g>
    </g>}
  </svg>;
}
