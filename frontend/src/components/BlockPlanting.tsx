import { calculatePlanting, type PlantingModel } from "../utils/planting";
import { MetricHelp } from "./MetricHelp";

export function BlockPlanting({ model, trees, onChange }: {
  model: PlantingModel | null;
  trees: number;
  onChange: (trees: number) => void;
}) {
  if (!model) return <p className="planting-note">Tree simulation data is unavailable for this block.</p>;
  const result = calculatePlanting(model, trees);
  const atCeiling = result.trees >= model.max_trees;
  const heat = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}°C`;
  return (
    <section className="block-planting" aria-label="Tree planting simulator">
      <div className="planting-heading">
        <div><span className="planting-eyebrow">Explore a cooler block</span><h2>Add trees</h2></div>
        <MetricHelp label="About mature tree simulation">Each tree adds 50.3 m² of mature canopy, assuming full survival and no crown overlap. This explores mature trees under the 2018 baseline climate conditions. It is not immediate cooling or a 2050 forecast. The ceiling is the local model's supported canopy range, not assessed planting space.</MetricHelp>
      </div>
      <div className="planting-slider-label"><label htmlFor="added-trees">Trees added</label><output htmlFor="added-trees">{result.trees.toLocaleString()} <span className="planting-tree-unit">{result.trees === 1 ? "tree" : "trees"}</span></output></div>
      <div className="planting-slider-row">
        <button type="button" aria-label="Remove one added tree" disabled={result.trees === 0} onClick={() => onChange(result.trees - 1)}>−</button>
        <input id="added-trees" type="range" min="0" max={model.max_trees} step="1" value={result.trees}
          disabled={model.max_trees === 0} aria-valuetext={`${result.trees} added trees`}
          onChange={event => onChange(Number(event.target.value))} />
        <button type="button" aria-label="Add one tree" disabled={atCeiling} onClick={() => onChange(result.trees + 1)}>+</button>
      </div>
      {model.unavailable_reason ? <p className="planting-note" role="status">{model.unavailable_reason}</p> : atCeiling ? (
        <p className="planting-ceiling" role="status">You've reached this block's tree limit for this estimate. Adding more would take tree cover above {model.canopy_ceiling_pct.toFixed(1)}%, where we don't have enough data to estimate cooling.</p>
      ) : <p className="planting-note">Move the slider to explore mature tree cover.</p>}
      <div className="planting-comparison" aria-label="Before and after planting">
        <div className="planting-comparison-head"><span /><span>Before</span><span>After</span></div>
        <div><span>Tree canopy</span><span>{model.baseline_canopy_pct.toFixed(1)}%</span><strong>{result.canopy.toFixed(1)}%</strong></div>
        <div><span>Surface heat</span><span>{heat(model.baseline_heat_c)}</span><strong>{heat(result.heat)}</strong></div>
      </div>
      <p className="planting-reference">Surface heat above the non-urban baseline</p>
      <div className="planting-cooling" aria-live="polite" aria-atomic="true"><span>Modelled cooling</span><strong>{result.cooling.toFixed(2)}°C</strong></div>
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
