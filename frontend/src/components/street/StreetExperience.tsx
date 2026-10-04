import { useEffect, useRef, useState } from "react";
import { INITIAL_STORY_TREES, MAX_STORY_TREES, clampTreeCount, streetChapters } from "../../data/streetStory";
import { useTheme } from "../../hooks/useTheme";
import type { StreetSceneController } from "./createStreetScene";

const poster = `${import.meta.env.BASE_URL}images/street-story.webp`;

export function StreetExperience() {
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<StreetSceneController | null>(null);
  const { theme } = useTheme();
  const [trees, setTrees] = useState(INITIAL_STORY_TREES);
  const [before, setBefore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [stills, setStills] = useState<string[]>([]);
  const latest = useRef({ theme, trees, before });

  useEffect(() => {
    latest.current = { ...latest.current, theme, trees };
    controller.current?.setTheme(theme);
    controller.current?.setTrees(trees, reduced);
  }, [theme, trees, reduced]);

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
        localController = createStreetScene(surface!, { ...latest.current, reduced, onFailure: fail });
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
  }, [reduced]);

  const isStatic = reduced || status === "fallback";
  const world = (
    <div className={`street-world ${status === "ready" ? "is-ready" : ""}`}>
      <img className="street-poster" src={poster} alt="A miniature neighbourhood with houses, a bus stop and trees along a shared street" fetchPriority="high" />
      <canvas ref={canvas} aria-hidden="true" className="street-canvas" />
      {status === "loading" && <span className="street-loading" role="status">Loading the street…</span>}
    </div>
  );

  return (
    <section ref={root} className={`street-experience ${isStatic ? "is-static" : ""}`} aria-label="A continuous neighbourhood story">
      {!isStatic && <div className="street-stage" aria-hidden="true">
        {world}
      </div>}

      <div className="street-beats">
        {streetChapters.map((chapter, index) => (
          <article key={chapter.id} id={chapter.id} className={`street-beat street-beat-${index}`} aria-labelledby={`${chapter.id}-title`}>
            {isStatic && index < 5 && <img className="street-still" src={stills[index] || poster} alt={chapter.object} loading={index === 0 ? "eager" : "lazy"} />}
            {isStatic && index === 5 && <div className="street-static-world">{world}</div>}
            <div className="street-copy">
              {index === 0 && <p className="street-intro-label">Cool Change / The street we share</p>}
              {index === 0
                ? <h1 id={`${chapter.id}-title`}>A cooler street<br /> starts with what<br /> we can <em>see.</em></h1>
                : <h2 id={`${chapter.id}-title`}>{chapter.title}</h2>}
              <p className="street-body">{chapter.body}</p>

              {index === 0 && <a className="street-text-link" href="#street-heat">Take a closer look <span aria-hidden="true">↘</span></a>}
              {index === 1 && <div className="street-observation"><span className="street-heat-swatch" /><p>Exposed surfaces hold the warmth.<br /><small>Colour shows the idea, not a measured temperature.</small></p></div>}
              {index === 2 && <div className="street-observation"><span className="street-shade-swatch" /><p>Canopy overhead.<br /><small>A place in the shade below.</small></p></div>}
              {index === 3 && <p className="street-aside">Small local changes can begin with a shared conversation.</p>}
              {index === 4 && <div className="street-years"><span>2026<small>A beginning</small></span><i aria-hidden="true" /><span>2050<small>Room to grow</small></span></div>}

              {index === 5 && <div className="street-planting">
                <label htmlFor="street-trees"><span>Trees you add</span><output htmlFor="street-trees">{trees.toString().padStart(2, "0")}</output></label>
                <input id="street-trees" type="range" min="0" max={MAX_STORY_TREES} step="1" value={trees} onChange={event => { setTrees(clampTreeCount(Number(event.target.value))); setBefore(false); }} aria-describedby="street-comparison-note" />
                <div className="street-slider-ends"><span>A few small changes</span><span>A greener street</span></div>
                <div className="street-comparison" role="group" aria-label="Compare canopy shade">
                  <button type="button" aria-pressed={before} disabled={status !== "ready"} onClick={() => setBefore(true)}>Before planting</button>
                  <button type="button" aria-pressed={!before} disabled={status !== "ready"} onClick={() => setBefore(false)}>With your trees</button>
                </div>
                <p id="street-comparison-note" className="street-comparison-note" aria-live="polite">{status === "fallback" ? "Live shade preview unavailable. Your tree count is saved for this visit." : before ? `Showing the street without your ${trees} added trees. Your selection is saved.` : trees === 0 ? "No added trees yet. Watch the footpath beside the bus stop as you plant." : "Watch the orange retreat where the canopy reaches. Uncovered surfaces stay warm."}</p>
                <div className="street-thermal-legend" aria-label="Illustrative surface colours">
                  <span><i className="street-heat-swatch" aria-hidden="true" />Exposed heat</span>
                  <span><i className="street-canopy-swatch" aria-hidden="true" />Canopy shade</span>
                </div>
                {status === "fallback" && <p className="street-fallback-feedback" role="status">{trees} additional {trees === 1 ? "tree" : "trees"} imagined for this street.</p>}
                <a className="street-text-link" href="#explore">Now find your neighbourhood <span aria-hidden="true">↗</span></a>
              </div>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
