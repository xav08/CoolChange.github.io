// provide site navigation
export function Header({ page }: { page: "story" | "map" | "about" }) {
  return (
    <header className="site-header">
      <div className="nav-shell">
        <a className="wordmark" href="#top" aria-label="Cool Change home">
          <span className="wordmark-mark" aria-hidden="true">C</span>
          <span>
            <strong>Cool Change</strong>
            <small>See your street differently</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#story" aria-current={page === "story" ? "page" : undefined}>The story</a>
          <a className="nav-cta" href="#map" aria-current={page === "map" ? "page" : undefined}>Explore the map <span aria-hidden="true">↗</span></a>
          <a className="nav-about" href="#about" aria-current={page === "about" ? "page" : undefined}>About</a>
        </nav>
      </div>
    </header>
  );
}
