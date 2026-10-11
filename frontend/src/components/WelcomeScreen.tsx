import { useEffect, type RefObject } from "react";
import { WelcomeCanopy } from "./WelcomeCanopy";

export function WelcomeScreen({ entering, transitioning, unavailable, onEnter, screenRef: root }: { entering: boolean; transitioning: boolean; unavailable: boolean; onEnter: () => void; screenRef: RefObject<HTMLElement | null> }) {
  useEffect(() => {
    function enter(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.repeat || event.defaultPrevented || entering) return;
      if (root.current?.closest("[inert]")) return;
      const target = event.target;
      // Let focused controls handle their own Enter.
      if (target !== document.body && target !== root.current) return;
      event.preventDefault();
      onEnter();
    }
    window.addEventListener("keydown", enter);
    return () => window.removeEventListener("keydown", enter);
  }, [entering, onEnter, root]);

  return <section ref={root} className={`welcome-screen${transitioning ? " is-entering" : ""}${unavailable ? " is-unavailable" : ""}`}
    aria-labelledby="welcome-title" tabIndex={-1}>
    <WelcomeCanopy />
    <div className="welcome-brand wordmark" aria-label="Cool Change">
      <span className="wordmark-mark" aria-hidden="true">C</span>
      <span><strong>Cool Change</strong><small>See your street differently</small></span>
    </div>
    <div className="welcome-copy">
      <h1 id="welcome-title">A little shade.<br /><em>A cooler day.</em></h1>
      <p className="welcome-description">See how trees can cool your neighbourhood.</p>
      <div className="welcome-entry">
        <button type="button" onClick={onEnter} disabled={entering}>Step into the shade <span aria-hidden="true">→</span></button>
        <span className="welcome-key-hint">or press <kbd>Enter</kbd></span>
      </div>
    </div>
  </section>;
}
