// provide site navigation
export function Header() {
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
          <a href="#story">The story</a>
          <a className="nav-cta" href="#map">Explore the map <span aria-hidden="true">↗</span></a>
          <a className="nav-about" href="#about">About</a>
        </nav>
      </div>
    </header>
  );
}
