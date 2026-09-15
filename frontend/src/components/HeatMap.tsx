import { useEffect, useState } from "react";
import { mapLayers, type StoryLayer } from "../data/storyData";
import { MapboxBaseMap } from "./MapboxBaseMap";

type HeatMapProps = {
  activeStep: number;
  trees?: number;
  compact?: boolean;
};

// map each story step to its default layer
function mapLayerForStep(step: number): StoryLayer {
  if (step === 1) return "canopy";
  if (step === 3) return "future";
  return "heat";
}

// render the interactive story map and layer controls
export function HeatMap({ activeStep, trees = 0, compact = false }: HeatMapProps) {
  const [layer, setLayer] = useState<StoryLayer>(() => mapLayerForStep(activeStep));
  // cap the simulator input to the map colour range
  const cooling = Math.min(trees / 46, 0.72);
  const legend = mapLayers[layer];

  // reset the selected layer as the story changes
  useEffect(() => {
    setLayer(mapLayerForStep(activeStep));
  }, [activeStep]);

  // build state classes for the map shell
  const mapClass = ["map-shell", compact && "map-shell-compact", `step-${activeStep}`, `layer-${layer}`]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={mapClass}>
      <div className="map-surface">
        <MapboxBaseMap
          label="Interactive Mapbox map of Clyde North, Victoria"
          layer={layer}
          cooling={cooling}
        />
      </div>

      <div className="map-glass map-label"><span className="pulse-dot" />{legend.label}</div>
      <div className="map-tools" aria-label="Map layers">
        <button className={layer === "heat" ? "active" : ""} onClick={() => setLayer("heat")} type="button" aria-pressed={layer === "heat"}><span className="tool-icon heat-icon" />2026 heat</button>
        <button className={layer === "canopy" ? "active" : ""} onClick={() => setLayer("canopy")} type="button" aria-pressed={layer === "canopy"}><span className="tool-icon canopy-icon" />Canopy</button>
        <button className={layer === "future" ? "active" : ""} onClick={() => setLayer("future")} type="button" aria-pressed={layer === "future"}><span className="tool-icon future-icon" />2050 heat</button>
      </div>

      <div className="heat-scale"><span>{legend.low}</span><i /><span>{legend.high}</span></div>
      {legend.note && <p className="map-data-note">{legend.note}</p>}
      <p className="map-credit">Density proxy only · © Mapbox © OpenStreetMap</p>
    </div>
  );
}
