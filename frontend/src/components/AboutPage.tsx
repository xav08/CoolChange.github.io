// list the external datasets used by the project
const sources = [
  {
    code: "D1",
    title: "Metropolitan Melbourne Urban Heat Islands and Urban Vegetation 2018",
    organisation: "Department of Transport and Planning, Victoria",
    href: "https://plan-gis.mapshare.vic.gov.au/arcgis/rest/services/CoolingGreening/CoolingGreening/MapServer/55",
  },
  {
    code: "D2",
    title: "Temperature extremes: days per year ≥ 35 °C by global warming level",
    organisation: "Australian Climate Service",
    href: "https://services-ap1.arcgis.com/Xoz8Es66HpfM8jP9/arcgis/rest/services/temperature_hazardvariables__proj_gwls__classified_aus__mm/FeatureServer/1",
  },
  {
    code: "D3",
    title: "Census Mesh Block Counts 2016",
    organisation: "Australian Bureau of Statistics · cat. 2074.0",
    href: "https://www.abs.gov.au/",
  },
  {
    code: "D4",
    title: "SEIFA 2016, SA1 indexes",
    organisation: "Australian Bureau of Statistics · cat. 2033.0.55.001",
    href: "https://www.abs.gov.au/",
  },
];

// present project context, limits, and data sources
export function AboutPage() {
  return (
    <main className="about-page">
      <section className="about-hero">
        <p className="eyebrow">About Cool Change</p>
        <h1>See the heat.<br />Change the street.</h1>
        <p>Cool Change helps Melburnians understand how heat and greenery vary across the places they know. It turns open data into a clearer starting point for local climate conversations.</p>
      </section>

      <div className="about-content">
        <section className="about-section">
          <p className="about-section-label">Why we exist</p>
          <div>
            <h2>Heat is local.</h2>
            <p>Melbourne is warming, but heat is not felt equally across the city. Shade, trees, streets and land cover all shape the conditions of a neighbourhood. Cool Change makes those patterns easier to explore at suburb and mesh-block scale.</p>
          </div>
        </section>

        <section className="about-section">
          <p className="about-section-label">Our data</p>
          <div>
            <h2>Built from public data.</h2>
            <p>We bring together Victorian, Australian Climate Service and ABS datasets. These sources let us map surface heat, vegetation, population context and future heat extremes across metropolitan Melbourne.</p>
            <ul className="about-sources">
              {sources.map((source) => (
                <li key={source.code}>
                  <span>{source.code}</span>
                  <a href={source.href} target="_blank" rel="noreferrer">
                    <strong>{source.title}</strong>
                    <small>{source.organisation} ↗</small>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="about-section">
          <p className="about-section-label">Limitations</p>
          <div>
            <h2>Data is a starting point, not the whole story.</h2>
            <ul className="about-notes">
              <li>The surface-heat map uses 2018 satellite-derived land-surface data. It is not live weather or air temperature.</li>
              <li>The heat measure is a mid-morning temperature deviation from a non-urban baseline, not the hottest temperature of the day.</li>
              <li>Mesh blocks are statistical areas. They help reveal neighbourhood patterns but do not describe an individual home or person.</li>
              <li>Future heat bands describe climate projections, not a precise forecast for a particular street or year.</li>
            </ul>
          </div>
        </section>

        <section className="about-section">
          <p className="about-section-label">Privacy &amp; use</p>
          <div>
            <h2>Designed for respectful local decisions.</h2>
            <p>Cool Change does not ask for personal information to explore the map. The information is intended to support curiosity, community discussion and evidence-informed action; it is not intended to judge individual homes, streets or communities.</p>
          </div>
        </section>

        <section className="about-team">
          <p className="eyebrow">Built by</p>
          <h2>Fox in the Shell</h2>
          <p>Created for Monash University FIT5120.</p>
        </section>
      </div>
    </main>
  );
}
