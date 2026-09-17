import { useState, type FormEvent } from "react";

// collect a place query before opening the map
export function AddressExplorer() {
  const [query, setQuery] = useState("Clayton VIC 3168");

  // save the query and open the map page
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // keep the query while moving from the story to the map
    if (query.trim()) sessionStorage.setItem("coolchange-suburb-query", query.trim());
    window.location.hash = "map";
  }

  return (
    <section className="explore-section" id="explore">
      <div className="explore-intro"><p className="eyebrow">Start where you live</p><h2>Explore an address.</h2><p>Take a glance at your local suburb. Enter the place you know best and start noticing how heat and shade may shape the streets around you. It is a simple first step towards understanding the area you care about.</p></div>
      <form className="address-form" onSubmit={handleSubmit}>
        <label htmlFor="address">Melbourne address or suburb</label>
        <div className="input-row"><input id="address" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Start typing an address…" autoComplete="street-address" /><button type="submit">Explore <span aria-hidden="true">↗</span></button></div>
      </form>
    </section>
  );
}
