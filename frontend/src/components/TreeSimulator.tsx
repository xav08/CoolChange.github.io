import { useMemo, useState } from "react";
import { HeatMap } from "./HeatMap";

// model an illustrative planting scenario
export function TreeSimulator() {
  const [trees, setTrees] = useState(12);
  // update illustrative values only when tree count changes
  const scenario = useMemo(() => {
    const canopy = 1.3 + trees * 0.36;
    const cooling = Math.min(1.8, trees * 0.046);
    return { canopy: canopy.toFixed(1), cooling: cooling.toFixed(1) };
  }, [trees]);

  return (
    <section className="simulator-section">
      <div className="simulator-copy">
        <p className="eyebrow">Try the idea</p>
        <h2>What if this block planted more shade?</h2>
        <p>Add trees to this illustrative Clyde North scenario. In the real tool, each tree would be translated through the block’s area and local cooling coefficient. The 2050 layer shows why starting in 2026 matters.</p>
        <label htmlFor="trees">Mature trees added <strong>{trees} Trees</strong></label>
        <input id="trees" type="range" min="0" max="36" value={trees} onChange={(event) => setTrees(Number(event.target.value))} />
        <div className="sim-results">
          <div><span>Canopy concept</span><strong>{scenario.canopy}%</strong><small>from 1.3%</small></div>
          <div><span>Cooling concept</span><strong>{scenario.cooling}°C</strong><small>indicative UI only</small></div>
        </div>
        <p className="prototype-note"><span>!</span>This interaction demonstrates the product concept. It is not a validated estimate or planting recommendation.</p>
      </div>
      <HeatMap activeStep={3} trees={trees} compact />
    </section>
  );
}
