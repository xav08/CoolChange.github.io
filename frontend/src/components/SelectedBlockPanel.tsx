import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { MeshblockDetail } from "./MelbourneMapPage";
import { MetricHelp } from "./MetricHelp";
import { AnimatedMetric } from "./AnimatedMetric";
import { metricValue, relativeInsight } from "../utils/blockInsights";
import "./selected-block.css";

const tabs = ["Overview", "Compare", "Plant"] as const;
export type BlockTab = typeof tabs[number];

export function SelectedBlockPanel({ detail, suburb, heat, canopy, modelled, tab, onTab, onBack, children }: {
  detail: MeshblockDetail;
  suburb: { uhi_mean?: number | null; canopy_mean?: number | null } | null;
  heat: number | null;
  canopy: number | null;
  modelled: boolean;
  tab: BlockTab;
  onTab: (tab: BlockTab) => void;
  onBack: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const council = detail.comparisons.find(row => row.area_type === "LGA");
  const metro = detail.comparisons.find(row => row.area_type === "METRO");
  const hasSuburb = suburb?.uhi_mean != null || suburb?.canopy_mean != null;
  const local = hasSuburb
    ? { label: "Suburb average", heat: suburb?.uhi_mean, canopy: suburb?.canopy_mean }
    : { label: `${council?.area_name || detail.block.lga_name} council average`, heat: council?.uhi_mean, canopy: council?.canopy_mean };
  const rows = [
    { label: "Your block", heat, canopy },
    local,
    ...(hasSuburb && council ? [{ label: `${council.area_name} council average`, heat: council.uhi_mean, canopy: council.canopy_mean }] : []),
    { label: "Melbourne average", heat: metro?.uhi_mean, canopy: metro?.canopy_mean },
    { label: "Coolest council block", heat: detail.coolest_in_lga?.uhi_mean, canopy: detail.coolest_in_lga?.canopy_pct },
  ];

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onTab(tabs[next]);
    tabRefs.current[next]?.focus();
  }

  return <div className="selected-block-panel">
    <header className="selected-block-header">
      <button className="map-back-button" type="button" onClick={onBack}>← {detail.block.sa2_name || "All suburbs"}</button>
      <h1>{detail.streets.length ? detail.streets.join(" / ") : `Block ${detail.block.mb_code16}`}</h1>
      <p>{detail.block.sa2_name} · {detail.block.lga_name}</p>
    </header>
    <dl className="selected-block-metrics">
      <div>
        <dt>{modelled ? "Modelled heat" : "Surface heat"}</dt>
        <MetricHelp label="About surface heat">{modelled ? "Modelled surface heat after mature tree planting, relative to non-urban land, using the 2018 baseline climate conditions." : "2018 satellite surface heat above non-urban land. This is not air temperature."}</MetricHelp>
        <dd>{heat == null ? "Not available" : <AnimatedMetric value={heat} unit="°C" />}</dd>
      </div>
      <div>
        <dt>Tree canopy</dt>
        <MetricHelp label="About tree canopy">{modelled ? "Baseline tree canopy plus the modelled mature canopy of your added trees." : "Tree canopy cover in this block, measured in 2018."}</MetricHelp>
        <dd>{canopy == null ? "Not available" : <AnimatedMetric value={canopy} unit="%" />}</dd>
      </div>
    </dl>
    <p className="selected-block-meta">{detail.block.mb_category || "Not classified"} · {detail.block.persons == null ? "Population not published" : `${detail.block.persons.toLocaleString()} ${detail.block.persons === 1 ? "person" : "people"}`}</p>
    {modelled && <p className="selected-block-context">Showing your mature-canopy scenario · modelled estimate</p>}
    <div className="block-tabs" role="tablist" aria-label="Selected block information">
      {tabs.map((name, index) => <button key={name} ref={node => { tabRefs.current[index] = node; }}
        type="button" role="tab" id={`${id}-${name}`} aria-controls={`${id}-${name}-panel`}
        aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
        onKeyDown={event => navigateTabs(event, index)} onClick={() => onTab(name)}>{name}</button>)}
    </div>
    <section role="tabpanel" id={`${id}-Overview-panel`} aria-labelledby={`${id}-Overview`} hidden={tab !== "Overview"} tabIndex={0} className="block-tab-content">
      <p className="block-insight-intro">{modelled ? "How your modelled scenario compares" : "How this block compares with its surroundings"}</p>
      {(["heat", "canopy"] as const).map(kind => {
        const insight = relativeInsight(kind === "heat" ? heat : canopy, local[kind], kind);
        return <p key={kind} className="block-insight">{insight ? <><strong>{insight}</strong><span>{insight.startsWith("About") ? "as" : "than"} the {local.label.toLowerCase()}.</span></> : <span>{kind === "heat" ? "Surface heat" : "Tree canopy"} comparison is unavailable.</span>}</p>;
      })}
      <div className="block-plant-cta"><h2>What could trees change?</h2>
        <button type="button" onClick={() => { onTab("Plant"); tabRefs.current[2]?.focus(); }}>Explore a greener scenario <span aria-hidden="true">→</span></button>
      </div>
    </section>
    <section role="tabpanel" id={`${id}-Compare-panel`} aria-labelledby={`${id}-Compare`} hidden={tab !== "Compare"} tabIndex={0} className="block-tab-content">
      <p className="block-comparison-note">{modelled ? "Your modelled block against 2018 benchmarks." : "2018 baseline comparisons."} Council and Melbourne averages cover residential blocks. Differences describe your block relative to each row. pp = percentage points.</p>
      {(["heat", "canopy"] as const).map(kind => <section className="block-comparison-section" key={kind} aria-label={kind === "heat" ? "Surface heat comparisons" : "Tree canopy comparisons"}>
        <h2>{kind === "heat" ? "Surface heat" : "Tree canopy"}</h2>
        <dl>{rows.map((row, index) => <div className="block-comparison-row" key={row.label}>
          <dt>{row.label}</dt><dd><strong>{metricValue(row[kind], kind)}</strong>
            {index > 0 && <span>{relativeInsight(kind === "heat" ? heat : canopy, row[kind], kind)?.replace("percentage points", "pp").replace(" tree canopy", " canopy") ?? "Difference unavailable"}</span>}
          </dd>
        </div>)}</dl>
      </section>)}
    </section>
    <section role="tabpanel" id={`${id}-Plant-panel`} aria-labelledby={`${id}-Plant`} hidden={tab !== "Plant"} tabIndex={0} className="block-tab-content">{children}</section>
  </div>;
}
