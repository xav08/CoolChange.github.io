import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MeshblockDetail } from "./MelbourneMapPage";
import { MetricHelp } from "./MetricHelp";
import { AnimatedMetric } from "./AnimatedMetric";
import { compactInsight, comparisonScale, heatTone, metricValue, relativeInsight, type MetricKind } from "../utils/blockInsights";
import "./selected-block.css";

const tabs = ["Overview", "Compare", "Plant"] as const;
export type BlockTab = typeof tabs[number];
const streetTitle = (name: string) => name === name.toUpperCase()
  ? name.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase()) : name;
const isAvailable = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);

function LocalComparison({ kind, value, reference, label }: { kind: MetricKind; value: number | null; reference: number | null | undefined; label: string }) {
  return <div className="block-insight">
    <span className="block-insight-label">{kind === "heat" ? "Surface heat" : "Tree canopy"}</span>
    <strong className={kind === "heat" ? "heat-value" : undefined} data-tone={kind === "heat" ? heatTone(value, reference) : undefined}>{compactInsight(value, reference, kind)}</strong>
    <span className="metric-screen-reader">{relativeInsight(value, reference, kind) ?? "Comparison unavailable"} compared with the {label.toLowerCase()}.</span>
  </div>;
}

export function SelectedBlockPanel({ detail, suburb, heat, canopy, modelled, tab, onTab, onBack, children }: {
  detail: MeshblockDetail;
  suburb: { uhi_mean?: number | null; canopy_mean?: number | null } | null;
  heat: number | null; canopy: number | null; modelled: boolean; tab: BlockTab;
  onTab: (tab: BlockTab) => void; onBack: () => void; children: ReactNode;
}) {
  const id = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [comparisonKind, setComparisonKind] = useState<MetricKind>("heat");
  const council = detail.comparisons.find(row => row.area_type === "LGA");
  const metro = detail.comparisons.find(row => row.area_type === "METRO");
  const hasSuburb = suburb?.uhi_mean != null || suburb?.canopy_mean != null;
  const local = hasSuburb
    ? { label: "Suburb average", heat: suburb?.uhi_mean, canopy: suburb?.canopy_mean }
    : { label: "Council average", heat: council?.uhi_mean, canopy: council?.canopy_mean };
  const rows = [
    { label: "Your block", heat, canopy }, local,
    ...(hasSuburb && council ? [{ label: "Council average", heat: council.uhi_mean, canopy: council.canopy_mean }] : []),
    { label: "Melbourne average", heat: metro?.uhi_mean, canopy: metro?.canopy_mean },
    { label: "Coolest council block", heat: detail.coolest_in_lga?.uhi_mean, canopy: detail.coolest_in_lga?.canopy_pct },
  ];
  const scale = comparisonScale(rows.map(row => row[comparisonKind]), comparisonKind);
  const zeroPosition = scale.position(0);
  const selected = comparisonKind === "heat" ? heat : canopy;
  const title = detail.streets[0] ? streetTitle(detail.streets[0]) : `Block ${detail.block.mb_code16}`;

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault(); onTab(tabs[next]); tabRefs.current[next]?.focus();
  }

  return <div className="selected-block-panel">
    <header className="selected-block-header">
      <button className="map-back-button" type="button" onClick={onBack}>← {detail.block.sa2_name || "All suburbs"}</button>
      <h1>{title}</h1>
      <p>{detail.block.lga_name}{detail.streets.length > 1 ? ` · +${detail.streets.length - 1} ${detail.streets.length === 2 ? "street" : "streets"}` : ""}</p>
    </header>
    {tab === "Overview" && <dl className="selected-block-metrics">
      <div><dt>Surface heat</dt>
        <MetricHelp label="About surface heat">{modelled ? "Estimated surface heat after your added trees reach maturity, compared with non-urban land in 2018 conditions." : "2018 satellite surface heat above non-urban land. This measures the ground, not the air."}</MetricHelp>
        <dd>{!isAvailable(heat) ? "Not available" : <AnimatedMetric value={heat} unit="°C" />}</dd>
      </div>
      <div><dt>Tree canopy</dt>
        <MetricHelp label="About tree canopy">{`${modelled ? "Existing canopy plus the estimated mature canopy of your added trees." : "The share of this block covered by tree crowns in 2018."} Coverage gaps subtract these values: 20% versus 15% is a +5% gap in the share of land covered by trees.`}</MetricHelp>
        <dd>{!isAvailable(canopy) ? "Not available" : <AnimatedMetric value={canopy} unit="%" />}</dd>
      </div>
    </dl>}
    <div className="block-tabs" role="tablist" aria-label="Selected block information">
      {tabs.map((name, index) => <button key={name} ref={node => { tabRefs.current[index] = node; }}
        type="button" role="tab" id={`${id}-${name}`} aria-controls={`${id}-${name}-panel`}
        aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
        onKeyDown={event => navigateTabs(event, index)} onClick={() => onTab(name)}>{name}</button>)}
    </div>
    <section role="tabpanel" id={`${id}-Overview-panel`} aria-labelledby={`${id}-Overview`} hidden={tab !== "Overview"} tabIndex={0} className="block-tab-content">
      <p className="block-insight-context">Compared with the {local.label.toLowerCase()}</p>
      <LocalComparison kind="heat" value={heat} reference={local.heat} label={local.label} />
      <LocalComparison kind="canopy" value={canopy} reference={local.canopy} label={local.label} />
      <div className="block-plant-cta">
        <button type="button" onClick={() => { onTab("Plant"); tabRefs.current[2]?.focus(); }}>See what trees could change <span aria-hidden="true">→</span></button>
      </div>
      <details className="block-details">
        <summary>Block details</summary>
        <dl className="selected-block-meta">
          <div><dt>Streets</dt><dd>{detail.streets.length ? detail.streets.map(streetTitle).join(", ") : "No street names available"}</dd></div>
          <div><dt>Land use</dt><dd>{detail.block.mb_category || "Not classified"}</dd></div>
          <div><dt>People</dt><dd>{detail.block.persons == null ? "Not published" : detail.block.persons.toLocaleString()}</dd></div>
          <div><dt>Block</dt><dd>{detail.block.mb_code16}</dd></div>
        </dl>
      </details>
    </section>
    <section role="tabpanel" id={`${id}-Compare-panel`} aria-labelledby={`${id}-Compare`} hidden={tab !== "Compare"} tabIndex={0} className="block-tab-content">
      <div className="block-comparison-switch" role="group" aria-label="Comparison metric">
        <button type="button" aria-pressed={comparisonKind === "heat"} onClick={() => setComparisonKind("heat")}>Surface heat</button>
        <button type="button" aria-pressed={comparisonKind === "canopy"} onClick={() => setComparisonKind("canopy")}>Tree canopy</button>
      </div>
      <section className="block-comparison-section" aria-label={comparisonKind === "heat" ? "Surface heat comparisons" : "Tree canopy comparisons"}>
        <p className="block-comparison-caption"><strong className={comparisonKind === "heat" ? "heat-value" : undefined} data-tone={comparisonKind === "heat" ? heatTone(selected, local.heat) : undefined}>{compactInsight(selected, local[comparisonKind], comparisonKind)}</strong> vs the {local.label.toLowerCase()}</p>
        <dl>{rows.map((row, index) => <div className={`block-comparison-row${index === 0 ? " is-selected" : ""}`} key={row.label}>
          <dt>{row.label}</dt><dd>{metricValue(row[comparisonKind], comparisonKind)}
            {index > 0 && <span className="metric-screen-reader">{relativeInsight(selected, row[comparisonKind], comparisonKind) ?? "Difference unavailable"}</span>}
          </dd>
          <div className="block-comparison-bar" aria-hidden="true">
            {scale.min < 0 && <span className="block-comparison-zero" style={{ left: `${zeroPosition}%` }} />}
            {isAvailable(row[comparisonKind]) && <span className="block-comparison-fill" style={{
              left: `${Math.min(zeroPosition, scale.position(row[comparisonKind]))}%`,
              width: `${Math.abs(scale.position(row[comparisonKind]) - zeroPosition)}%`,
            }} />}
          </div>
        </div>)}</dl>
        <div className="block-comparison-axis" aria-hidden="true"><span>{metricValue(scale.min, comparisonKind)}</span>
          {scale.min < 0 && scale.max > 0 && <span className="block-comparison-axis-zero" style={{ left: `${zeroPosition}%` }}>0</span>}
          <span>{metricValue(scale.max, comparisonKind)}</span></div>
      </section>
      <details className="block-details"><summary>About these comparisons</summary>
        <p>Council and Melbourne averages cover residential blocks in 2018. The coolest block is the council block with the lowest surface heat.</p>
        <p>Canopy coverage gaps subtract the two percentages. For example, 20% versus 15% gives a +5% gap in the share of land covered by trees.</p>
        <p>Surface heat is measured above non-urban land. It is not air temperature.</p>
      </details>
    </section>
    <section role="tabpanel" id={`${id}-Plant-panel`} aria-labelledby={`${id}-Plant`} hidden={tab !== "Plant"} tabIndex={0} className="block-tab-content">{children}</section>
  </div>;
}
