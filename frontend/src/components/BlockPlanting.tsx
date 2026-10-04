import { calculatePlanting, type PlantingModel } from "../utils/planting";
import { MetricHelp } from "./MetricHelp";
import { AnimatedMetric } from "./AnimatedMetric";
import { useId } from "react";
import { plantingMilestones } from "../utils/plantingMilestones";
import { HoldBefore } from "./HoldBefore";
import "./planting-feedback.css";

export function BlockPlanting({ model, trees, onChange, onInteractionChange, suburbCanopy = null, previewBefore = false, previewEnabled = false, onPreview }: {
  model: PlantingModel | null;
  trees: number;
  onChange: (trees: number) => void;
  onInteractionChange?: (active: boolean) => void;
  suburbCanopy?: number | null;
  previewBefore?: boolean;
  previewEnabled?: boolean;
  onPreview?: (active: boolean) => void;
}) {
  const milestoneId = useId();
  if (!model) return <p className="planting-note">Tree simulation data is unavailable for this block.</p>;
  const result = calculatePlanting(model, trees);
  const milestones = plantingMilestones(model, suburbCanopy);
  const atCeiling = result.trees >= model.max_trees;
  const heat = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}°C`;
  return (
    <section className="block-planting" aria-label="Tree planting simulator">
      <div className="planting-heading">
        <h2>Add trees</h2>
        <MetricHelp label="About mature tree simulation">{`Each tree adds ${model.crown_area_m2.toFixed(1)} m² of mature canopy, assuming full survival and no crown overlap. This explores mature trees under the 2018 baseline climate conditions. It is not immediate cooling or a 2050 forecast. The ceiling is the local model's supported canopy range, not assessed planting space.`}</MetricHelp>
      </div>
      <p className="planting-intro">Explore how mature tree canopy could change this block.</p>
      <div className="planting-slider-label"><label htmlFor="added-trees">Trees added</label><output htmlFor="added-trees" aria-live="off">{result.trees.toLocaleString()} <span className="planting-tree-unit">{result.trees === 1 ? "tree" : "trees"}</span></output></div>
      <div className="planting-slider-row">
        <button type="button" aria-label="Remove one added tree" disabled={result.trees === 0} onClick={() => onChange(result.trees - 1)}>−</button>
        <input id="added-trees" type="range" min="0" max={model.max_trees} step="1" value={result.trees}
          disabled={model.max_trees === 0} aria-valuetext={`${result.trees} added trees${atCeiling ? ", model-supported maximum" : ""}`} aria-describedby={milestoneId}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); onInteractionChange?.(true); }}
          onPointerUp={() => onInteractionChange?.(false)}
          onPointerCancel={() => onInteractionChange?.(false)}
          onLostPointerCapture={() => onInteractionChange?.(false)}
          onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) onInteractionChange?.(true); }}
          onKeyUp={() => onInteractionChange?.(false)} onBlur={() => onInteractionChange?.(false)}
          onChange={event => onChange(Number(event.target.value))} />
        <button type="button" aria-label="Add one tree" disabled={atCeiling} onClick={() => onChange(result.trees + 1)}>+</button>
      </div>
      <div className="planting-slider-scale" aria-hidden="true"><span>0</span>
        {milestones.filter(item => item.trees < model.max_trees).map(item => <i key={item.trees} style={{ left: `${item.trees / model.max_trees * 100}%` }} />)}
        <strong className={atCeiling ? "is-limit" : ""}>{model.max_trees} max</strong>
      </div>
      <div className="planting-milestones" id={milestoneId}>
        {milestones.map(item => <button key={item.trees} type="button" onClick={() => onChange(item.trees)}>
          <span>{item.labels.join(" / ")}</span><strong>{item.trees} trees</strong>
        </button>)}
        <p className={atCeiling ? "is-limit" : ""}>Model-supported maximum: {model.max_trees} trees. This is an estimate limit, not assessed planting capacity.</p>
      </div>
      {model.unavailable_reason ? <p className="planting-note" role="status">{model.unavailable_reason}</p> : atCeiling ? (
        <p className="planting-ceiling" role="status">You've reached this block's tree limit for this estimate. Adding more would take tree cover above {model.canopy_ceiling_pct.toFixed(1)}%, where we don't have enough data to estimate cooling.</p>
      ) : <p className="planting-note">Move the slider to explore mature tree cover.</p>}
      <p className="planting-impact" aria-live="polite" aria-atomic="true">{result.trees === 0
        ? "No trees added. This block is showing its baseline canopy and surface heat."
        : `${result.trees.toLocaleString()} mature ${result.trees === 1 ? "tree could" : "trees could"} raise canopy from ${model.baseline_canopy_pct.toFixed(1)}% to ${result.canopy.toFixed(1)}%, with ${result.cooling.toFixed(2)}°C modelled cooling.`}</p>
      <div className="planting-cooling"><span>Modelled cooling</span><strong><AnimatedMetric value={result.cooling} decimals={2} unit="°C" negative /></strong></div>
      <dl className="planting-result-rows" aria-label="Before to after planting">
        <div><dt>Canopy</dt><dd><span>{model.baseline_canopy_pct.toFixed(1)}%</span><span aria-hidden="true">→</span><span className="metric-screen-reader"> to </span><strong><AnimatedMetric value={result.canopy} unit="%" /></strong></dd></div>
        <div><dt>Surface heat</dt><dd><span>{heat(model.baseline_heat_c)}</span><span aria-hidden="true">→</span><span className="metric-screen-reader"> to </span><strong><AnimatedMetric value={result.heat} decimals={2} unit="°C" /></strong></dd></div>
      </dl>
      <p className="planting-reference">Surface heat above the non-urban baseline</p>
      {onPreview && <HoldBefore active={previewBefore} enabled={previewEnabled && trees > 0} onPreview={onPreview} />}
      <p className="planting-illustration-note">Map circles illustrate mature canopy density, not individual trees or assessed planting locations.</p>
      <div className="planting-range">
        <span>Approx. 95% model range</span>
        <MetricHelp label="About the model range">This range shows uncertainty in the estimated surface heat after adding trees. The 95% figure comes from the model and has not been checked against real planting results. Weather, tree growth and local conditions can put actual temperatures outside this range.</MetricHelp>
        <strong>{result.range ? `${heat(result.range[0])} to ${heat(result.range[1])}` : result.trees === 0 ? "Add trees to see the range" : "Range unavailable"}</strong>
      </div>
      {model.source_kind !== "local" && <div className="planting-fallback">
        <span>Estimate from a nearby block</span>
        <MetricHelp label="About the nearby estimate">{`The selected block has no supported local estimate. Its baseline and area are retained; the coefficient and model range come from ${model.source_kind === "adjacent" ? "adjoining" : "the nearest usable"} block ${model.source_mb_code16}. The ceiling also respects that model's canopy range. Additional uncertainty from borrowing this estimate is not included.`}</MetricHelp>
      </div>}
    </section>
  );
}
