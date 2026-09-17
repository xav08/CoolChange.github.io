import { WARMING_LEVELS, bandLabel, projectionColor, warmingLabel, type ProjectionData, type WarmingLevel } from "../utils/projections";
import "../projections.css";

export function ProjectionControls({ future, onToggle, level, onLevel }: {
  future: boolean; onToggle: () => void; level: WarmingLevel; onLevel: (level: WarmingLevel) => void;
}) {
  return <aside className="projection-controls" aria-label="2050 vision controls">
    <div className="projection-switch-row">
      <div><span className="projection-kicker">A future worth planting for</span><strong id="vision-label">Toggle 2050 vision</strong></div>
      <button type="button" role="switch" aria-checked={future} aria-labelledby="vision-label"
        aria-describedby="vision-state" className={`vision-switch${future ? " is-future" : ""}`} onClick={onToggle}>
        <span className="vision-switch-thumb" /><span aria-hidden="true">☀️</span><span aria-hidden="true">🌳</span>
      </button>
    </div>
    <p id="vision-state">{future ? "Future heat · without planting action" : "Current map · explore tree planting"}</p>
    {future && <fieldset className="warming-selector"><legend>Global warming level</legend>
      <div>{WARMING_LEVELS.map(value => <button key={value} type="button" aria-pressed={value === level} onClick={() => onLevel(value)}>{warmingLabel(value)}</button>)}</div>
    </fieldset>}
  </aside>;
}

export function ProjectionLegend({ data }: { data: ProjectionData }) {
  return <aside className="projection-legend" aria-label="Projected extreme heat legend">
    <strong>Days/year ≥35°C</strong><span>National warming class bands</span>
    <ul>{data.bands.map(band => <li key={`${band.days_lower}-${band.days_upper}-${band.days_label}`}>
      <i style={{ background: projectionColor(band, data.scale) }} /><span>{bandLabel(band)}</span>
    </li>)}</ul>
  </aside>;
}
