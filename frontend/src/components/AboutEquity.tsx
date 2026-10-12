import { useEffect, useId, useRef, useState } from "react";
import { equityAreaCount, equityCanopy, equityHeatGap } from "../data/equityCanopy";
import "./about-equity.css";

type ChartView = "compare" | "all";

function CanopyChart({ view }: { view: ChartView }) {
  const container = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const irsdId = useId();
  const [explainIrsd, setExplainIrsd] = useState(false);
  const [width, setWidth] = useState(400);
  const [activeDecile, setActiveDecile] = useState<number | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const compare = view === "compare";
  const rows = compare ? [equityCanopy[0], equityCanopy[equityCanopy.length - 1]] : equityCanopy;
  const height = 322;
  const left = width < 360 ? 48 : 64;
  const right = 12;
  const top = 44;
  const bottom = compare ? 84 : 65;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = height - top - bottom;
  const ceiling = Math.ceil(Math.max(...equityCanopy.map(group => group.canopy)) / 5) * 5;
  const step = plotWidth / rows.length;
  const y = (value: number) => top + plotHeight * (1 - value / ceiling);
  const activeIndex = rows.findIndex(group => group.decile === activeDecile);
  const active = rows[activeIndex];
  const tooltipLeft = Math.max(8, Math.min(width - 248, left + step * (activeIndex + 0.5) - 120));

  return (
    <div className="equity-chart-block">
      <div ref={container} className="equity-chart" role="group" aria-label="Population-weighted tree canopy by socio-economic disadvantage">
        <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
          <text x={left} y={20} className="equity-axis">Land covered by trees (%)</text>
          {[0, 10, 20].map(tick => (
            <g key={tick}>
              <line x1={left} x2={compare && tick > 0 ? left + 5 : width - right} y1={y(tick)} y2={y(tick)} className="equity-grid" />
              <text x={left - 13} y={y(tick) + 4} textAnchor="end" className="equity-axis">{tick}</text>
            </g>
          ))}
          {rows.map((group, index) => {
            const cx = left + step * (index + 0.5);
            const barWidth = step * (compare ? 0.4 : 0.56);
            return (
              <g key={group.decile}>
                <rect x={cx - barWidth / 2} y={y(group.canopy)} width={barWidth} height={y(0) - y(group.canopy)}
                  className={`equity-bar${group.decile === 1 ? " equity-bar-first" : ""}${activeDecile === group.decile ? " is-active" : ""}`} />
                {compare ? <>
                  <text x={cx} y={y(group.canopy) - 13} textAnchor="middle" className={`equity-chart-number${width < 360 ? " is-small" : ""}`}>{group.canopy.toFixed(1)}%</text>
                  <text x={cx} y={height - bottom + 21} textAnchor="middle">{group.decile === 1 ? "Most" : "Least"}</text>
                  <text x={cx} y={height - bottom + 37} textAnchor="middle">disadvantaged</text>
                  <text x={cx} y={height - bottom + 55} textAnchor="middle" className="equity-axis">{group.areas} areas</text>
                </> : <>
                  <text x={cx} y={height - bottom + 21} textAnchor="middle">{group.decile}</text>
                  {(width > 440 || group.decile === 1 || group.decile === 10) && <text x={cx} y={y(group.canopy) - 10} textAnchor="middle" className="equity-bar-value">{group.canopy.toFixed(1)}%</text>}
                </>}
              </g>
            );
          })}
          {!compare && <>
            <text x={left} y={height - 22} className="equity-axis">Most<tspan x={left} dy={16}>disadvantaged</tspan></text>
            <text x={width - right} y={height - 22} textAnchor="end" className="equity-axis">Least<tspan x={width - right} dy={16}>disadvantaged</tspan></text>
          </>}
        </svg>
        {rows.map((group, index) => (
          <button key={group.decile} type="button" className="equity-chart-hit"
            style={{ left: left + step * index, top, width: step, height: plotHeight + (compare ? 58 : 23) }}
            aria-label={`Decile ${group.decile}${group.decile === 1 ? ", most disadvantaged" : group.decile === 10 ? ", least disadvantaged" : ""}: ${group.canopy.toFixed(1)}% canopy, ${group.areas} areas, ${group.residents.toLocaleString("en-AU")} residents`}
            aria-describedby={activeDecile === group.decile ? tooltipId : undefined}
            onPointerEnter={() => setActiveDecile(group.decile)}
            onPointerLeave={event => { if (document.activeElement !== event.currentTarget) setActiveDecile(null); }}
            onFocus={() => setActiveDecile(group.decile)} onBlur={() => setActiveDecile(null)}
            onClick={() => setActiveDecile(group.decile)}
            onKeyDown={event => { if (event.key === "Escape") setActiveDecile(null); }}
          />
        ))}
        {active && <div id={tooltipId} role="tooltip" className="equity-chart-tooltip" style={{ left: tooltipLeft }}>
          <strong>Group {active.decile}: {active.canopy.toFixed(1)}% tree cover</strong>
          <span>{active.areas} areas · {active.residents.toLocaleString("en-AU")} residents</span>
        </div>}
      </div>
      {!compare && <>
        <div className="equity-axis-help">
          <span>National IRSD decile</span>
          <button type="button" aria-expanded={explainIrsd} aria-controls={irsdId}
            onClick={() => setExplainIrsd(open => !open)}>
            {explainIrsd ? "Close explanation" : "What is IRSD?"}
          </button>
        </div>
        <div id={irsdId} className="equity-irsd-explanation" hidden={!explainIrsd}>
          <p><strong>IRSD measures disadvantage in an area.</strong> The ABS Index of Relative Socio-economic Disadvantage combines Census indicators such as low income, unemployment and education.</p>
          <p>A <strong>decile</strong> is one of ten groups ranked across Australia: <strong>1 = most disadvantaged</strong>, <strong>10 = least disadvantaged</strong>. These bars show the Melbourne areas in each group, so group sizes differ.</p>
          <a href="https://www.abs.gov.au/ausstats/abs%40.nsf/Lookup/by%20Subject/2033.0.55.001~2016~Main%20Features~IRSD~19" target="_blank" rel="noreferrer">Read the ABS definition</a>
        </div>
      </>}
    </div>
  );
}

export function AboutEquity() {
  const [view, setView] = useState<ChartView>("compare");
  const headingId = useId();
  const chartId = useId();

  return (
    <section className="about-equity" aria-labelledby={headingId}>
      <h2 id={headingId}>More hardship, less tree cover.</h2>
      <p className="equity-intro">Melbourne areas facing the least social and economic hardship have <strong>about 3 times the tree cover</strong> of those facing the most.</p>
      <div className="equity-layout">
        <figure className="equity-photo">
          <img src={`${import.meta.env.BASE_URL}images/tree-lined-path.jpg`}
            alt="Real photograph of leafy trees arching over a sunlit path" width={960} height={1440} loading="lazy" decoding="async" />
          <figcaption>Tree-lined path · <a href="https://commons.wikimedia.org/wiki/File:Tree-lined_alley_(Unsplash).jpg" target="_blank" rel="noreferrer">Studio Dekorasyon</a> · <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer">CC0</a></figcaption>
        </figure>
        <div className="equity-data">
          <div className="equity-toolbar">
            <h3>Compare tree cover</h3>
            <div className="equity-view-switch" role="group" aria-label="Canopy comparison view">
              <button type="button" aria-pressed={view === "compare"} aria-controls={chartId} onClick={() => setView("compare")}>The gap</button>
              <button type="button" aria-pressed={view === "all"} aria-controls={chartId} onClick={() => setView("all")}>All groups</button>
            </div>
          </div>
          <div id={chartId}><CanopyChart key={view} view={view} /></div>
          <p className="equity-heat"><strong>{equityHeatGap.toFixed(1)}°C cooler</strong><span>Land surfaces in the least disadvantaged group,<br />compared with the most disadvantaged group.</span></p>
        </div>
      </div>
      <div className="equity-footer"><span>{equityAreaCount} Melbourne areas · 2018 tree cover &amp; heat data</span></div>
      <details className="equity-method">
        <summary>About the data</summary>
        <p>Groups use the ABS SEIFA 2016 Index of Relative Socio-economic Disadvantage (IRSD) at SA2 level. National decile 1 is most disadvantaged; 10 is least disadvantaged. Group sizes vary within Melbourne.</p>
        <p>The analysis includes {equityAreaCount} SA2 areas with a published IRSD score and at least 500 residents in the study area. The figures shown are rounded group averages.</p>
        <p>These patterns show an association, not proof that disadvantage causes lower tree cover or higher temperatures. Geography also matters. The canopy correlation with IRSD is +0.46 overall and +0.32 within the same region. Results describe areas, rather than individual households.</p>
        <p>Sources: Victorian metropolitan Melbourne heat and vegetation data (2018), ABS Census population (2016), and ABS SEIFA SA2 indexes (2016). Analysis: Cool Change, Iteration 3, Epic 7.</p>
      </details>
      <span className="equity-sr-only" aria-live="polite">{view === "all" ? "Showing all ten disadvantage groups." : "Comparing the most and least disadvantaged groups."}</span>
    </section>
  );
}
