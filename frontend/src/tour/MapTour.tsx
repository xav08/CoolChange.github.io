import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { resolveTourDemo } from "./tourDemo";
import { fewTrees, intersectRect, milestoneTrees, padRect, placeCard, unionRects, type Rect } from "./tourLogic";
import { TOUR_CHAPTERS, tourSteps } from "./tourSteps";
import type { TourController, TourDemo, TourScene, TourState, TourStep, TourTarget } from "./tourTypes";
import "./map-tour.css";

const WAIT_LIMIT_MS = 12000;

function waitUntil(get: () => TourState, ready: (state: TourState) => boolean, cancelled: () => boolean) {
  const start = performance.now();
  return new Promise<void>(resolve => {
    const tick = () => {
      if (cancelled() || ready(get()) || performance.now() - start > WAIT_LIMIT_MS) resolve();
      else window.setTimeout(tick, 60);
    };
    tick();
  });
}

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

// Move the map page into the state a step needs. Each change waits for its data
// before the next, so later steps never act on a half-loaded map.
async function applyScene(scene: TourScene | undefined, demo: TourDemo, c: TourController, get: () => TourState, cancelled: () => boolean) {
  if (!scene) return;
  const wait = (ready: (state: TourState) => boolean) => waitUntil(get, ready, cancelled);
  const suburbCode = demo.suburb.sa2_code16;

  if (scene.future !== undefined && get().future !== scene.future) {
    c.setFuture(scene.future);
    await wait(s => s.future === scene.future && (s.future ? s.projectionStatus === "ready" || s.projectionStatus === "error" : !s.suburbCode || s.meshReady));
  }
  if (cancelled()) return;
  if (scene.warming !== undefined && get().warming !== scene.warming) {
    c.setWarming(scene.warming);
    await wait(s => s.warming === scene.warming);
  }
  if (scene.suburb === "none" && (get().suburbCode || get().blockCode)) {
    c.showAll();
    await wait(s => !s.suburbCode && !s.blockCode);
  }
  if (scene.suburb === "demo" && (get().suburbCode !== suburbCode || (!get().future && !get().meshReady))) {
    c.openSuburb(demo.suburb, demo.suburb.sa2_name);
    await wait(s => s.suburbCode === suburbCode && (s.future || s.meshReady));
  }
  if (cancelled()) return;
  if (scene.block === "none" && get().blockCode) {
    c.closeBlock();
    await wait(s => !s.blockCode);
  }
  if (scene.highlight === false && get().highlighted) {
    c.clearHighlight();
    await wait(s => !s.highlighted);
  }
  if (scene.highlight === true && !get().highlighted) {
    c.streetSearch(demo.streetQuery);
    await wait(s => s.highlighted > 0 && s.meshReady);
  }
  if (cancelled()) return;
  const block = scene.block === "primary" ? demo.primary : scene.block === "secondary" ? demo.secondary : null;
  if (block && get().blockCode !== block) {
    c.openBlock(block);
    await wait(s => s.blockCode === block && !s.blockLoading);
  }
  if (scene.tab && get().tab !== scene.tab) {
    c.setTab(scene.tab);
    await wait(s => s.tab === scene.tab);
  }
  if (scene.trees && get().blockCode) {
    const s = get();
    const target = scene.trees === "zero" ? 0
      : scene.trees === "few" ? fewTrees(s.maxTrees, s.milestones.map(item => item.trees))
      : milestoneTrees(s.maxTrees, s.milestones);
    if (s.trees !== target) {
      c.setTrees(target);
      await wait(next => next.trees === target);
    }
  }
  if (cancelled()) return;
  if (scene.comparison && get().comparison !== scene.comparison) c.setComparison(scene.comparison);
  if (scene.sheet) c.setSheet(scene.sheet);
  await nextFrame();
  if (scene.openPlantedList) c.openPlantedList();
  // Let the panel and camera settle before measuring the spotlight.
  await new Promise(resolve => window.setTimeout(resolve, 380));
}

function visible(element: Element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function measureTarget(target: TourTarget, demo: TourDemo, c: TourController, viewport: Rect): Rect | null {
  if (target.kind === "none") return null;
  if (target.kind === "suburb") {
    const rect = c.suburbRect();
    return rect ? intersectRect(padRect(rect, 8), viewport) : null;
  }
  if (target.kind === "block") {
    const code = target.which === "primary" ? demo.primary : demo.secondary;
    const rect = code ? c.blockRect(code) : null;
    return rect ? intersectRect(padRect(rect, 10, 44), viewport) : null;
  }
  const rects = target.selectors.flatMap(selector => [...document.querySelectorAll(selector)]).filter(visible).map(element => {
    const rect = element.getBoundingClientRect();
    const box: Rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    // Clip to the scrolling panel so the spotlight never sits over hidden content.
    const scroller = element.closest(".map-explorer-content");
    if (!scroller) return box;
    const area = scroller.getBoundingClientRect();
    return intersectRect(box, { left: area.left, top: area.top, width: area.width, height: area.height });
  }).filter((rect): rect is Rect => rect !== null);
  const union = unionRects(rects);
  return union ? intersectRect(padRect(union, 8), viewport) : null;
}

// Scroll the explorer panel just enough to show the whole target (or its top, if taller).
function revealInPanel(selectors: string[], smooth: boolean) {
  const elements = selectors.flatMap(selector => [...document.querySelectorAll(selector)]).filter(visible);
  const scroller = elements[0]?.closest(".map-explorer-content");
  if (!scroller) return;
  const union = unionRects(elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }));
  if (!union) return;
  const area = scroller.getBoundingClientRect();
  const above = union.top < area.top;
  const below = union.top + union.height > area.bottom;
  if (!above && !below) return;
  const delta = above || union.height > area.height ? union.top - area.top - 12 : union.top + union.height - area.bottom + 12;
  scroller.scrollBy({ top: delta, behavior: smooth ? "smooth" : "auto" });
}

function text(value: TourStep["title"], demo: TourDemo | null, state: TourState) {
  if (typeof value === "string") return value;
  return demo ? value(demo, state) : "";
}

export function MapTour({ state, controller }: { state: TourState; controller: TourController }) {
  const reduced = useReducedMotion();
  const titleId = useId();
  const bodyId = useId();
  const stateRef = useRef(state);
  const run = useRef(0);
  const baseline = useRef<boolean | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [demo, setDemo] = useState<TourDemo | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [applying, setApplying] = useState(true);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [cardSize, setCardSize] = useState({ width: 360, height: 280 });
  const step = tourSteps[index];

  useLayoutEffect(() => { stateRef.current = state; });

  useEffect(() => {
    controller.begin();
  }, [controller]);

  // Find the demo suburb and blocks once the map's suburb outlines are loaded.
  useEffect(() => {
    if (!state.mapReady || demo || error) return;
    const request = new AbortController();
    resolveTourDemo(controller.apiBase, controller.suburbSummary, request.signal)
      .then(result => {
        if (!result.primary) throw new Error("No demo block");
        setDemo(result);
      })
      .catch(() => { if (!request.signal.aborted) setError("The tour couldn't load its example street. Check your connection and try again."); });
    return () => request.abort();
  }, [state.mapReady, demo, error, controller]);

  // Set up the map for the current step.
  useEffect(() => {
    if (!demo) return;
    const token = ++run.current;
    baseline.current = null;
    setApplying(true);
    setRect(null);
    void applyScene(tourSteps[index].scene, demo, controller, () => stateRef.current, () => run.current !== token)
      .then(() => { if (run.current === token) setApplying(false); });
  }, [index, demo, controller]);

  // Follow the target while the map moves or the panel scrolls.
  useEffect(() => {
    if (applying || !demo) return;
    const current = tourSteps[index].target;
    // The panel can still be re-rendering, so check again as it settles.
    const timers = current.kind === "element"
      ? [0, 450, 900].map((delay, attempt) => window.setTimeout(() => revealInPanel(current.selectors, attempt === 0 && !reduced), delay))
      : [];
    let frame = 0;
    let last = "";
    const measure = () => {
      const next = measureTarget(current, demo, controller, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
      const key = next ? [next.left, next.top, next.width, next.height].map(Math.round).join(",") : "none";
      if (key !== last) { last = key; setRect(next); }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => { cancelAnimationFrame(frame); timers.forEach(window.clearTimeout); };
  }, [applying, index, demo, controller, reduced]);

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(() => setCardSize({ width: 360, height: card.offsetHeight }));
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!applying) headingRef.current?.focus({ preventScroll: true });
  }, [applying, index]);

  // Action steps move on by themselves once the visitor does the thing.
  const done = !!(demo && !applying && step.action?.done(state, demo));
  useEffect(() => {
    if (applying || !step.action) return;
    if (baseline.current === null) { baseline.current = done; return; }
    if (!done) { baseline.current = false; return; }
    if (baseline.current !== false) return;
    const timer = window.setTimeout(() => setIndex(current => current === index ? Math.min(current + 1, tourSteps.length - 1) : current), reduced ? 150 : 700);
    return () => window.clearTimeout(timer);
  }, [done, applying, index, step.action, reduced]);

  function finish() { controller.end(); }
  function next() { setIndex(current => Math.min(current + 1, tourSteps.length - 1)); }
  function back() { setIndex(current => Math.max(current - 1, 0)); }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target && target !== document.body && !cardRef.current?.contains(target)) return;
      controller.end();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [controller]);

  const last = index === tourSteps.length - 1;
  const first = index === 0;
  const busy = !demo || applying;
  const placement = placeCard(step.target.kind === "none" ? null : rect, viewport, cardSize);
  const hint = demo && !applying && step.action?.hint ? step.action.hint(state, demo) : null;
  const chapter = step.chapter;
  const eyebrow = chapter === 0 ? "Guided tour" : chapter === 5 ? "Tour complete" : `Chapter ${chapter} of 4 · ${TOUR_CHAPTERS[chapter]}`;
  const primaryLabel = first ? (demo ? "Start the tour" : "Getting ready…") : last ? "Explore the map" : step.action?.label ?? "Next";
  const progress = (index / (tourSteps.length - 1)) * 100;

  return (
    <div className={`tour-layer${reduced ? " is-reduced" : ""}`}>
      {!error && step.target.kind === "none" && <div className="tour-backdrop" aria-hidden="true" />}
      {!error && rect && step.target.kind !== "none" && (
        <div className={`tour-spotlight${step.target.kind === "block" ? " is-block" : ""}`} aria-hidden="true"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
      )}
      <div ref={cardRef} className={`tour-card is-${placement.placement}${busy ? " is-busy" : ""}`} role="dialog" aria-modal="false"
        aria-labelledby={titleId} aria-describedby={bodyId} aria-busy={busy}
        style={{ left: placement.left, top: placement.top, width: placement.width }}>
        <div className="tour-card-top">
          <p className="tour-eyebrow">{error ? "Guided tour" : eyebrow}</p>
          <button type="button" className="tour-close" onClick={finish} aria-label="End the tour">×</button>
        </div>
        {error ? <>
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>The tour can't start right now.</h2>
          <p id={bodyId} className="tour-body">{error}</p>
          <div className="tour-actions"><span /><button type="button" className="tour-primary" onClick={finish}>Close</button></div>
        </> : <>
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>{text(step.title, demo, state)}</h2>
          <p id={bodyId} className="tour-body">{demo ? text(step.body, demo, state) : "Finding an example street to show you…"}</p>
          {applying && demo && <p className="tour-status" role="status"><span className="tour-spinner" aria-hidden="true" />Setting up the map…</p>}
          {!applying && hint && <p className="tour-hint" role="status">{hint}</p>}
          {!applying && !hint && step.action && <p className="tour-try">Try it yourself, or press <strong>{step.action.label ?? "Next"}</strong>.</p>}
          {!first && !last && <div className="tour-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>}
          <div className="tour-actions">
            {first ? <button type="button" className="tour-secondary" onClick={finish}>Not now</button>
              : last ? <button type="button" className="tour-secondary" onClick={() => setIndex(0)}>Replay</button>
              : <span className="tour-count">{index} of {tourSteps.length - 2}</span>}
            <div>
              {!first && !last && <button type="button" className="tour-secondary" onClick={back} disabled={busy}>Back</button>}
              <button type="button" className="tour-primary" onClick={last ? finish : next} disabled={busy}>{primaryLabel}</button>
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}
