import { storyFacts, journeySteps } from "../data/storyData";
import { HeatMap } from "./HeatMap";

type StoryStepsProps = { activeStep: number };

// pair story cards with the changing map state
export function StorySteps({ activeStep }: StoryStepsProps) {
  return (
    <section className="scrolly" id="story">
      <div className="sticky-map-wrap"><HeatMap activeStep={activeStep} /></div>
      <div className="story-steps">
        {storyFacts.map((fact, index) => (
          <article className={`story-step ${activeStep === index ? "is-active" : ""}`} data-story-step={index} key={fact.id}>
            <p className="chapter">{fact.kicker}</p>
            <h2>{fact.title}</h2>
            <p>{fact.body}</p>
            <div className="stat-line"><strong>{fact.stat}</strong><span>{fact.label}</span></div>
          </article>
        ))}
      </div>
    </section>
  );
}

// highlight one local mesh-block example
export function CaseStudy() {
  return (
    <section className="case-study">
      <div className="case-heading"><p className="eyebrow">A closer look / Clyde North</p><h2>One hot block tells a much larger story.</h2></div>
      <div className="case-grid">
        <div className="case-number"><strong>+15.7°C</strong><span>surface temperature deviation</span></div>
        <div className="case-number"><strong>1.3%</strong><span>tree canopy cover</span></div>
        <div className="case-copy">
          <p>These figures describe a mesh block, not a person or a property. They make a visible deficit measurable, and therefore possible to change.</p>
        </div>
      </div>
    </section>
  );
}

// compare planting time with mature canopy
export function TreeTimeline() {
  return (
    <section className="two-clocks">
      <div className="clock-copy"><p className="chapter">The two clocks</p><h2>2026 is halfway to 2050.</h2><p>Urban trees need decades to mature. Waiting for hotter summers before planting means waiting too long for shade.</p></div>
      <div className="timeline" aria-label="Timeline from planting in 2026 to mature canopy in 2050">
        <div className="timeline-line" />
        <div className="year"><i /><strong>2026</strong><span>plant</span></div>
        <div className="tree-growth"><span className="tree-ring ring-one" /><span className="tree-ring ring-two" /><span className="tree-ring ring-three" /></div>
        <div className="year"><i /><strong>2050</strong><span>shade</span></div>
      </div>
    </section>
  );
}

// describe the evidence-led user journey
export function EvidenceSection() {
  return (
    <section className="evidence-section">
      <div className="evidence-heading"><p className="eyebrow">From a static report to local agency</p><h2>The data already exists. The bridge does not.</h2><p>Cool Change connects four actions in one understandable journey.</p></div>
      <ol className="journey-list">
        {journeySteps.map(([number, title, description]) => <li key={number}><span>{number}</span><div><strong>{title}</strong><p>{description}</p></div></li>)}
      </ol>
    </section>
  );
}
