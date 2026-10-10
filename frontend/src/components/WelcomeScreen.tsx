import { useEffect, useRef } from "react";

export function WelcomeScreen({ entering, onEnter }: { entering: boolean; onEnter: () => void }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    function enter(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.repeat || event.defaultPrevented || entering) return;
      if (root.current?.closest("[inert]")) return;
      const target = event.target;
      // Let password fields, links and the sound button handle their own Enter.
      if (target !== document.body && target !== root.current) return;
      event.preventDefault();
      onEnter();
    }
    window.addEventListener("keydown", enter);
    return () => window.removeEventListener("keydown", enter);
  }, [entering, onEnter]);

  return <section ref={root} className={`welcome-screen${entering ? " is-entering" : ""}`}
    aria-labelledby="welcome-title" tabIndex={-1}>
    <div className="welcome-brand wordmark" aria-label="Cool Change">
      <span className="wordmark-mark" aria-hidden="true">C</span>
      <span><strong>Cool Change</strong><small>See your street differently</small></span>
    </div>
    <div className="welcome-copy">
      <h1 id="welcome-title">A little shade.<br /><em>A cooler day.</em></h1>
      <div className="welcome-entry">
        <button type="button" onClick={onEnter} disabled={entering}>Step into the story <span aria-hidden="true">→</span></button>
        <span className="welcome-key-hint">or press <kbd>Enter</kbd></span>
      </div>
    </div>
  </section>;
}
