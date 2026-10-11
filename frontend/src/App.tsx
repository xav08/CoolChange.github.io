import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AboutPage } from "./components/AboutPage";
import { Header } from "./components/Header";
import { StoryPage } from "./components/StoryPage";
import { useCurrentPage } from "./hooks/useCurrentPage";
import { PasswordGate } from "./components/PasswordGate";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { initialWelcomePhase, welcomeEntryMotion, type WelcomeEntryFrame } from "./data/welcome";
import "./welcome.css";

// The story does not need to download Mapbox until the visitor opens the map.
const MelbourneMapPage = lazy(() => import("./components/MelbourneMapPage").then(module => ({ default: module.MelbourneMapPage })));

// choose the page that matches the current url hash
export default function App() {
  const page = useCurrentPage();
  const [welcome, setWelcome] = useState(initialWelcomePhase);
  const [entryReady, setEntryReady] = useState(false);
  const [entryUnavailable, setEntryUnavailable] = useState(false);
  const welcomeScreen = useRef<HTMLElement>(null);
  const storyContent = useRef<HTMLDivElement>(null);
  const artOrigin = useRef<DOMRect | null>(null);
  const enteredByVisitor = useRef(false);
  const showingWelcome = page === "story" && welcome !== "complete";

  const enterStory = useCallback(() => {
    if (welcome !== "welcome") return;
    enteredByVisitor.current = true;
    window.scrollTo({ top: 0, behavior: "instant" });
    setWelcome("entering");
  }, [welcome]);

  const onEntryReady = useCallback(() => setEntryReady(true), []);
  const onEntryComplete = useCallback(() => setWelcome("complete"), []);
  const onEntryUnavailable = useCallback(() => {
    setEntryReady(true);
    setEntryUnavailable(true);
  }, []);
  const onEntryFrame = useCallback((frame: WelcomeEntryFrame) => {
    const screen = welcomeScreen.current;
    const art = screen?.querySelector<HTMLElement>(".welcome-art");
    if (!screen || !art) return;
    artOrigin.current ??= art.getBoundingClientRect();
    const origin = artOrigin.current;
    const motion = welcomeEntryMotion(frame.progress);
    const scale = Math.exp(Math.log(5.6) * motion.approach);
    const dx = (window.innerWidth / 2 - (origin.left + origin.width * 0.56)) * motion.approach;
    const dy = (window.innerHeight / 2 - (origin.top + origin.height * 0.37)) * motion.approach;
    art.style.transformOrigin = "56% 37%";
    art.style.transform = `translate(${dx}px, calc(-50% + ${dy}px)) scale(${scale})`;
    art.style.opacity = String(1 - motion.dissolve);
    screen.style.setProperty("--welcome-backdrop", String(1 - motion.backdrop));
    storyContent.current?.style.setProperty("--entry-copy", String(motion.copy));
  }, []);

  useEffect(() => {
    if (!showingWelcome) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [showingWelcome]);

  useEffect(() => {
    if (welcome !== "entering" || !entryUnavailable) return;
    const timer = window.setTimeout(onEntryComplete, 450);
    return () => { window.clearTimeout(timer); };
  }, [welcome, entryUnavailable, onEntryComplete]);

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
        <div ref={storyContent} className={`site-content${showingWelcome ? ` welcome-content${welcome === "entering" ? " is-entering" : ""}${entryUnavailable ? " is-unavailable" : ""}` : ""}`} inert={showingWelcome}>
          <Header page={page} />
          <Suspense fallback={<main role="status" style={{ padding: "160px 8vw", minHeight: "100svh" }}>Loading your map…</main>}>
            {page === "about" ? <AboutPage /> : page === "map" ? <MelbourneMapPage /> : <StoryPage welcome={welcome} onEntryReady={onEntryReady} onEntryFrame={onEntryFrame} onEntryComplete={onEntryComplete} onEntryUnavailable={onEntryUnavailable} />}
          </Suspense>
        </div>
        {showingWelcome && <WelcomeScreen screenRef={welcomeScreen} entering={welcome === "entering"} transitioning={entryReady} unavailable={entryUnavailable} onEnter={enterStory} />}
      </PasswordGate>
    </>
  );
}
