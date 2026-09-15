// define the map interpretation notes
const trustNotes = [
  ["Surface heat, not human exposure", "The satellite passed at about 9:50am. The result describes land surface temperature, not afternoon air temperature or dangerous night time heat."],
  ["Association, not a guarantee", "Canopy and cooler surface temperature are associated. Modelled cooling is indicative and must carry uncertainty."],
  ["Context, never a suburb ranking", "The story frames heat as a local deficit that can be closed. It is never a property attribute or a score attached to a community."],
];

// explain what the story can and cannot show
export function TrustSection() {
  return (
    <section className="trust-section">
      <div><p className="eyebrow">Trust the number</p><h2>What this story can and cannot tell us.</h2></div>
      <div className="trust-list">
        {trustNotes.map(([title, description], index) => <details key={title} open={index === 0}><summary>{title}</summary><p>{description}</p></details>)}
      </div>
    </section>
  );
}
