import { useTheme } from "../hooks/useTheme";

// provide site navigation
export function Header({ page }: { page: "story" | "map" | "about" }) {
  const { theme, toggleTheme } = useTheme();
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
          <button className="theme-toggle" type="button" onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {theme === "dark" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
                : <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z" />}
            </svg>
          </button>
        </nav>
      </div>
    </header>
  );
}
