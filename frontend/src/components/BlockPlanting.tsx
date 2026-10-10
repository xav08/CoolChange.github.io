import { calculatePlanting, type PlantingModel } from "../utils/planting";
import { MetricHelp } from "./MetricHelp";
import { AnimatedMetric } from "./AnimatedMetric";
import { useId, type ReactNode } from "react";
import { plantingMilestones } from "../utils/plantingMilestones";
import "./planting-feedback.css";

export function BlockPlanting({ model, trees, onChange, onInteractionChange, suburbCanopy = null, mapControls }: {
  model: PlantingModel | null; trees: number; onChange: (trees: number) => void;
  onInteractionChange?: (active: boolean) => void; suburbCanopy?: number | null;
  mapControls?: ReactNode;
}) {
  const milestoneId = useId();
  if (!model) return <><p className="planting-note">We don't have a tree estimate for this block yet. Try another block nearby.</p>{mapControls}</>;
  const result = calculatePlanting(model, trees);
  const milestones = plantingMilestones(model, suburbCanopy);
  const atCeiling = result.trees >= model.max_trees;
  const heat = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}°C`;
  const addedCanopy = result.canopy - model.baseline_canopy_pct;
  const suburbTarget = milestones[0];
  const hasSuburbAverage = suburbCanopy != null && Number.isFinite(suburbCanopy);
  const meetsSuburbAverage = hasSuburbAverage && model.baseline_canopy_pct >= suburbCanopy;

  return <section className="block-planting" aria-label="Tree planting simulator">
    <div className="planting-slider-label"><div className="planting-count-heading"><label htmlFor="added-trees">Trees to add</label>
      <MetricHelp label="About mature tree simulation">Try a number of trees to estimate their canopy and cooling once fully grown. Open Model details for the assumptions and estimate limit.</MetricHelp>
    </div>
      <output htmlFor="added-trees" aria-live="off">{result.trees.toLocaleString()} <span className="planting-tree-unit">{result.trees === 1 ? "tree" : "trees"}</span></output>
    </div>
    <div className="planting-slider-row">
      <button type="button" aria-label="Remove one added tree" disabled={result.trees === 0} onClick={() => onChange(result.trees - 1)}>−</button>
      <input id="added-trees" type="range" min="0" max={model.max_trees} step="1" value={result.trees}
        disabled={model.max_trees === 0} aria-valuetext={`${result.trees} added trees${atCeiling ? ", estimate limit" : ""}`} aria-describedby={milestoneId}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); onInteractionChange?.(true); }}
        onPointerUp={() => onInteractionChange?.(false)} onPointerCancel={() => onInteractionChange?.(false)}
        onLostPointerCapture={() => onInteractionChange?.(false)}
        onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) onInteractionChange?.(true); }}
        onKeyUp={() => onInteractionChange?.(false)} onBlur={() => onInteractionChange?.(false)}
        onChange={event => onChange(Number(event.target.value))} />
      <button type="button" aria-label="Add one tree" disabled={atCeiling} onClick={() => onChange(result.trees + 1)}>+</button>
    </div>
    <div className="planting-slider-scale"><span>0</span>
      {milestones.filter(item => item.trees < model.max_trees).map(item => <i aria-hidden="true" key={item.trees} style={{ left: `${item.trees / model.max_trees * 100}%` }} />)}
      <span id={milestoneId}>{model.max_trees.toLocaleString()} estimate limit</span>
    </div>
    {hasSuburbAverage && <div className="planting-milestones">
      <button type="button" disabled={!suburbTarget} aria-pressed={!!suburbTarget && result.trees === suburbTarget.trees}
        onClick={() => { if (suburbTarget) onChange(suburbTarget.trees); }}
        aria-label={`Suburb average: ${suburbCanopy.toFixed(1)}% canopy${suburbTarget ? `, add ${suburbTarget.trees} trees` : ""}`}>
        <span>Suburb average</span><strong>{suburbTarget ? `${suburbTarget.trees.toLocaleString()} trees` : `${suburbCanopy.toFixed(1)}% canopy`}</strong>
      </button>
      {!suburbTarget && <p className="planting-target-note">{meetsSuburbAverage
        ? "This block already meets the suburb average."
        : "The suburb average is beyond this block’s estimate limit."}</p>}
    </div>}
    {model.unavailable_reason ? <p className="planting-note" role="status">{model.unavailable_reason}</p>
      : atCeiling && <p className="planting-ceiling" role="status">You've reached the estimate limit for this block. See Model details below.</p>}
    <div className="planting-cooling">
      <div><span>Estimated cooling</span><strong><AnimatedMetric value={result.cooling} decimals={2} unit="°C" negative={result.cooling > 0} /></strong></div>
    </div>
    <dl className="planting-result-rows" aria-label="Before to after planting">
      <div className="planting-canopy-result">
        <dt>Tree canopy</dt>
        <dd>
          <svg viewBox="0 0 64 64" aria-hidden="true" className="planting-canopy-ring">
            <circle cx="32" cy="32" r="24" className="planting-ring-track" />
            <circle cx="32" cy="32" r="24" pathLength="100" strokeDasharray={`${model.baseline_canopy_pct} 100`} className="planting-ring-baseline" />
            {addedCanopy > 0 && <circle cx="32" cy="32" r="24" pathLength="100" strokeDasharray={`${addedCanopy} 100`} strokeDashoffset={-model.baseline_canopy_pct} className="planting-ring-added" />}
          </svg>
          <div><span className="planting-canopy-values"><span>{model.baseline_canopy_pct.toFixed(1)}%</span><span aria-hidden="true">→</span><span className="metric-screen-reader"> to </span><strong><AnimatedMetric value={result.canopy} unit="%" /></strong></span>
            <span className="planting-canopy-change">+{addedCanopy.toFixed(1)}%</span>
          </div>
        </dd>
      </div>
    </dl>
    <p className="planting-impact metric-screen-reader" aria-live="polite" aria-atomic="true">{result.trees === 0
      ? "No trees added. Showing this block's baseline."
      : `${result.trees.toLocaleString()} mature trees: canopy ${model.baseline_canopy_pct.toFixed(1)}% to ${result.canopy.toFixed(1)}%, with ${result.cooling.toFixed(2)}°C estimated cooling. Modelled, in 2018 conditions.`}</p>
    {model.source_kind !== "local" && <p className="planting-borrowed-note">Uses an estimate from a nearby block. <span>Details below.</span></p>}
    {mapControls}
    <details className="block-details planting-model-details">
      <summary>Model details</summary>
      <p>These results describe fully grown trees in 2018 climate conditions. Growth takes time; this is not a forecast for 2050.</p>
      <dl className="planting-model-facts">
        <div><dt>Surface heat</dt><dd>{heat(model.baseline_heat_c)} → {heat(result.heat)}</dd></div>
        <div><dt>Approx. 95% model range</dt><dd>{result.range ? `${heat(result.range[0])} to ${heat(result.range[1])}` : result.trees === 0 ? "Add trees to see the range" : "Range unavailable"}</dd></div>
        <div><dt>Estimate limit</dt><dd>{model.max_trees.toLocaleString()} trees · {model.canopy_ceiling_pct.toFixed(1)}% canopy</dd></div>
      </dl>
      <p>Each tree adds {model.crown_area_m2.toFixed(1)} m² of mature canopy, assuming all trees survive and their crowns do not overlap. The limit comes from the model's supported canopy range. Planting space has not been assessed.</p>
      <p>The range reflects model uncertainty and has not been checked against real planting results. Weather, growth and local conditions can put actual temperatures outside it. Surface heat is measured above non-urban land, not air temperature.</p>
      <p className="planting-illustration-note">Tree crowns on the map show a canopy scenario. Their number and positions are illustrative, not a planting plan.</p>
      {model.source_kind !== "local" && <p>The selected block's baseline and area are retained. The cooling estimate and range come from {model.source_kind === "adjacent" ? "adjoining" : "the nearest usable"} block {model.source_mb_code16}. Extra uncertainty from borrowing this estimate is not included.</p>}
    </details>
  </section>;
}
