import { useEffect, useRef, useState, type CSSProperties } from "react";
import { plantingSites, streetChapters, togglePlantingSite } from "../../data/streetStory";
import { useTheme } from "../../hooks/useTheme";
import type { StreetSceneController } from "./createStreetScene";
import { HoldBefore } from "../HoldBefore";
import type { WelcomePhase } from "../../data/welcome";

export function StreetExperience({ welcome = "complete" }: { welcome?: WelcomePhase }) {
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<StreetSceneController | null>(null);
  const { theme } = useTheme();
  const [selected, setSelected] = useState<number[]>([]);
  const [growth, setGrowth] = useState(0);
  const [hasGrown, setHasGrown] = useState(false);
  const [afternoon, setAfternoon] = useState(false);
  const [active, setActive] = useState(false);
  const markers = useRef<(HTMLButtonElement | null)[]>([]);
  const [feedback, setFeedback] = useState("Tap + to plant");
  const [before, setBefore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [stills, setStills] = useState<string[]>([]);
  const staticWelcome = reduced && welcome !== "complete";
  const latest = useRef({ theme, selected, growth, afternoon, before, welcome: welcome === "welcome" });

  useEffect(() => {
    latest.current.welcome = welcome === "welcome";
    controller.current?.setWelcome(welcome === "welcome");
  }, [welcome]);

  useEffect(() => {
    latest.current = { ...latest.current, theme, selected, growth, afternoon };
    controller.current?.setTheme(theme);
    controller.current?.setPlanting(selected, growth, afternoon);
  }, [theme, selected, growth, afternoon]);

  useEffect(() => {
    latest.current.before = before;
    controller.current?.setBefore(before);
  }, [before]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let disposeTimeline = () => {};
    let localController: StreetSceneController | null = null;
    const surface = canvas.current;
    const container = root.current;
    if (!surface || !container) return;

    async function initialise() {
      try {
        const [{ createStreetScene }, { gsap }, { ScrollTrigger }] = await Promise.all([
          import("./createStreetScene"), import("gsap"), import("gsap/ScrollTrigger"),
        ]);
        if (cancelled) return;
        gsap.registerPlugin(ScrollTrigger);
        const fail = () => {
          if (cancelled) return;
          disposeTimeline();
          localController?.dispose();
          controller.current = null;
          setStatus("fallback");
        };
        localController = createStreetScene(surface!, { ...latest.current, reduced, onFailure: fail,
          onProject(index, x, y, visible) {
            const marker = markers.current[index];
            if (!marker) return;
            marker.style.left = x + "%";
            marker.style.top = y + "%";
            marker.style.visibility = visible ? "visible" : "hidden";
          },
        });
        controller.current = localController;
        if (reduced) {
          setStills(localController.getStillViews());
          localController.setProgress(5);
        } else {
          const motion = { progress: 0 };
          const context = gsap.context(() => {
            gsap.to(motion, {
              progress: 5.65,
              ease: "none",
              onUpdate: () => {
                localController?.setProgress(Math.max(0, motion.progress - 0.65));
              },
              scrollTrigger: {
                trigger: container, start: "top top", end: "bottom bottom", scrub: true,
                invalidateOnRefresh: true,
              },
            });
          }, container!);
          disposeTimeline = () => context.revert();
          ScrollTrigger.refresh();
        }
        setStatus("ready");
      } catch {
        if (!cancelled) {
          disposeTimeline();
          localController?.dispose();
          controller.current = null;
          setStatus("fallback");
        }
      }
    }
    void initialise();
    return () => {
      cancelled = true;
      disposeTimeline();
      localController?.dispose();
      controller.current = null;
    };
  }, [reduced, staticWelcome]);

  useEffect(() => {
    const chapter = root.current?.querySelector("#street-plant");
    if (!chapter) return;
    const observer = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { rootMargin: "-15% 0px -25% 0px" });
    observer.observe(chapter);
    return () => observer.disconnect();
  }, []);

  function plant(index: number) {
    if (before || status !== "ready") return;
    const exists = selected.includes(index);
    setSelected(current => togglePlantingSite(current, index));
    setFeedback(exists ? "Choose another spot" : selected.length >= 5 ? "Five planted. Move a tree?" : selected.length === 4 ? "Five trees. Your cooler street." : plantingSites.find(site => site.index === index)?.label + " planted");
  }

  const isStatic = reduced || status === "fallback";
  const world = (
    <div className={`street-world ${status === "ready" ? "is-ready" : ""} ${active ? "is-planting" : ""}`}>
      <canvas ref={canvas} aria-hidden="true" className="street-canvas" />
      <div className="street-planting-spots" hidden={!active || status !== "ready" || before} role="group" aria-label="Choose where to plant your five trees">
        {plantingSites.map(({ label: site, index }) => <button key={index} ref={element => { markers.current[index] = element; }} type="button"
          className={"street-spot " + (selected.includes(index) ? "is-planted" : "")}
          aria-label={(selected.includes(index) ? "Remove tree: " : "Plant tree: ") + site}
          aria-pressed={selected.includes(index)} disabled={!selected.includes(index) && selected.length === 5}
          onClick={() => plant(index)}><span aria-hidden="true">{selected.includes(index) ? "−" : "+"}</span><small>{site}</small></button>)}
      </div>
      {status === "loading" && <span className="street-loading" role="status">Loading the street…</span>}
    </div>
  );

  return (
    <section ref={root} className={`street-experience ${isStatic ? "is-static" : ""}`} aria-label="A continuous neighbourhood story">
      {(!isStatic || welcome !== "complete") && <div className="street-stage">
        {world}
      </div>}

      <div className="street-beats">
        {streetChapters.map((chapter, index) => (
          <article key={chapter.id} id={chapter.id} className={`street-beat street-beat-${index}`} aria-labelledby={`${chapter.id}-title`}>
            {isStatic && index < 5 && stills[index] && <img className="street-still" src={stills[index]} alt={chapter.object} loading={index === 0 ? "eager" : "lazy"} />}
            {isStatic && index === 5 && welcome === "complete" && <div className="street-static-world">{world}</div>}
            <div className="street-copy">
              {index === 0 && <p className="street-intro-label">Cool Change / The street we share</p>}
              {index === 0
                ? <h1 id={`${chapter.id}-title`}>A cooler street<br /> starts with what<br /> we can <em>see.</em></h1>
                : <h2 id={`${chapter.id}-title`}>{chapter.title}</h2>}
              {index !== 5 && <p className="street-body">{chapter.body}</p>}

              {index === 0 && <a className="street-text-link" href="#street-heat">Take a closer look <span aria-hidden="true">↘</span></a>}
              {index === 1 && <div className="street-observation"><span className="street-heat-swatch" /><p>Exposed surfaces hold the warmth.<br /><small>Colour shows the idea, not a measured temperature.</small></p></div>}
              {index === 2 && <div className="street-observation"><span className="street-shade-swatch" /><p>Canopy overhead.</p></div>}
              {index === 3 && <p className="street-aside">Start with your street. Imagine what you could grow together.</p>}
              {index === 4 && <div className="street-years"><span>2026<small>Planted</small></span><i aria-hidden="true" /><span>2050<small>Grow to mature</small></span></div>}

              {index === 5 && <div className="street-planting">
                <div className="street-tree-budget" aria-label={selected.length + " of 5 trees planted"}>
                  <div className="street-seeds" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} className={index < selected.length ? "is-used" : ""} />)}</div>
                  <span><strong>{5 - selected.length}</strong> to plant</span>
                  <button className="street-reset" type="button" disabled={!selected.length || status !== "ready"} onClick={() => { setSelected([]); setGrowth(0); setHasGrown(false); setBefore(false); setFeedback("Tap + to plant"); }}>Reset</button>
                </div>
                <p className="street-plant-hint" role="status">{status === "fallback" ? "3D preview unavailable" : status === "loading" ? "Loading the street…" : feedback}</p>
                <fieldset className="street-simulator-controls" disabled={status !== "ready"}>
                  <div className={`street-growth-control ${selected.length > 0 && !hasGrown && !before && active ? "needs-growth" : ""}`} style={{ "--growth-fill": `${growth * 100}%` } as CSSProperties}>
                  <label htmlFor="street-growth"><span>Drag to grow <b className="street-growth-arrows" aria-hidden="true">↔</b></span><output htmlFor="street-growth">{growth === 0 ? "Young" : growth === 1 ? "Mature" : "Growing"}</output></label>
                  <input id="street-growth" disabled={selected.length === 0} type="range" min="0" max="1" step="0.01" value={growth} onChange={event => { setGrowth(Number(event.target.value)); setHasGrown(true); setBefore(false); }} aria-valuetext={Math.round(growth * 100) + "% of mature size"} />
                  <div className="street-slider-ends"><span>Young</span><span>Mature</span></div>
                  </div>
                  <div className="street-daylight" role="group" aria-label="Time of day">
                    <button type="button" aria-pressed={!afternoon} onClick={() => setAfternoon(false)}><i className="street-sun morning" aria-hidden="true" />Morning</button>
                    <button type="button" aria-pressed={afternoon} onClick={() => setAfternoon(true)}><i className="street-sun afternoon" aria-hidden="true" />Afternoon</button>
                  </div>
                  <div className="street-comparison">
                    <HoldBefore active={before} enabled={status === "ready" && selected.length > 0 && active} onPreview={setBefore} />
                  </div>
                </fieldset>
                <div className="street-thermal-legend" aria-label="Heat and shade">
                  <span><i className="street-heat-swatch" aria-hidden="true" />Heat</span>
                  <span><i className="street-canopy-swatch" aria-hidden="true" />Shade</span>
                </div>
                <a className="street-text-link" href="#explore">Explore your neighbourhood <span aria-hidden="true">↗</span></a>
              </div>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
