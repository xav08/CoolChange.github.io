// introduce the project story
export function Hero() {
  return (
    <section className="hero" id="top">
      <p className="eyebrow">Melbourne / A story for 2050</p>
      <h1>A cooler street starts with what we can see.</h1>
      <p className="hero-copy">
        The heat is uneven. The evidence is public. Cool Change turns it into a story residents can use to argue for a greener neighbourhood.
      </p>
      <a className="hero-cta" href="#story">
        Follow the heat <span aria-hidden="true">↓</span>
      </a>
      <div className="hero-orbit orbit-one" />
      <div className="hero-orbit orbit-two" />
    </section>
  );
}

// explain the local heat problem
export function LeadCopy() {
  return (
    <section className="lead-copy">
      <p className="eyebrow">The problem beneath the weather</p>
      <p className="lede">
        Extreme heat harms more Australians than all other natural hazards combined. But the people in the hottest neighbourhoods often have the least power to cool the homes and streets around them.
      </p>
    </section>
  );
}
