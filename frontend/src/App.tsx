import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AboutPage } from "./components/AboutPage";
import { Header } from "./components/Header";
import { StoryPage } from "./components/StoryPage";
import { useCurrentPage } from "./hooks/useCurrentPage";
import { PasswordGate } from "./components/PasswordGate";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { initialWelcomePhase, WELCOME_TRANSITION_MS } from "./data/welcome";
import "./welcome.css";

// The story does not need to download Mapbox until the visitor opens the map.
const MelbourneMapPage = lazy(() => import("./components/MelbourneMapPage").then(module => ({ default: module.MelbourneMapPage })));

// choose the page that matches the current url hash
export default function App() {
  const page = useCurrentPage();
  const [welcome, setWelcome] = useState(initialWelcomePhase);
  const enteredByVisitor = useRef(false);
  const showingWelcome = page === "story" && welcome !== "complete";

  const enterStory = useCallback(() => {
    if (welcome !== "welcome") return;
    enteredByVisitor.current = true;
    window.scrollTo({ top: 0, behavior: "instant" });
    setWelcome("entering");
  }, [welcome]);

  useEffect(() => {
    if (!showingWelcome) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [showingWelcome]);

  useEffect(() => {
    if (welcome !== "entering") return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : WELCOME_TRANSITION_MS;
    const timer = window.setTimeout(() => {
      setWelcome("complete");
    }, duration);
    return () => { window.clearTimeout(timer); };
  }, [welcome]);

  useEffect(() => {
    if (showingWelcome || !enteredByVisitor.current || page !== "story") return;
    enteredByVisitor.current = false;
    const heading = document.getElementById("top-title");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }, [showingWelcome, page]);

  return (
    <>
      <PasswordGate>
        <div className={`site-content${showingWelcome ? ` welcome-content${welcome === "entering" ? " is-entering" : ""}` : ""}`} inert={showingWelcome}>
          <Header page={page} />
          <Suspense fallback={<main role="status" style={{ padding: "160px 8vw", minHeight: "100svh" }}>Loading your map…</main>}>
            {page === "about" ? <AboutPage /> : page === "map" ? <MelbourneMapPage /> : <StoryPage welcome={welcome} />}
          </Suspense>
        </div>
        {showingWelcome && <WelcomeScreen entering={welcome === "entering"} onEnter={enterStory} />}
      </PasswordGate>
    </>
  );
}
