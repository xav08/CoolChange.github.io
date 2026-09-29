export type FrameClock = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
  now: () => number;
};

const browserClock: FrameClock = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
  now: () => performance.now(),
};

// Every replacement starts at the currently displayed value; cancellation prevents stale frames.
export function tween(duration: number, update: (progress: number) => void, clock = browserClock) {
  if (duration <= 0) { update(1); return () => {}; }
  const start = clock.now();
  let cancelled = false;
  let frame: number;
  const tick = (now: number) => {
    if (cancelled) return;
    const progress = Math.min(1, Math.max(0, (now - start) / duration));
    update(1 - (1 - progress) ** 3);
    if (progress < 1) frame = clock.request(tick);
  };
  frame = clock.request(tick);
  return () => { cancelled = true; clock.cancel(frame); };
}

export type HeatState = { heat: number; baseline: number };

// Feature-state changes need explicit interpolation: a paint transition alone
// cannot tween each block's data-driven heat value.
export function animateHeatStates(
  current: Map<string, HeatState>, targets: Map<string, HeatState>, duration: number,
  write: (code: string, heat: number) => void, clear: (code: string) => void,
  clock?: FrameClock,
) {
  const changes = new Map<string, { from: number; to: number; baseline: number }>();
  for (const code of new Set([...current.keys(), ...targets.keys()])) {
    const target = targets.get(code);
    const previous = current.get(code);
    const baseline = target?.baseline ?? previous!.baseline;
    changes.set(code, { from: previous?.heat ?? baseline, to: target?.heat ?? baseline, baseline });
  }
  if (!changes.size) return () => {};
  return tween(duration, progress => {
    for (const [code, { from, to, baseline }] of changes) {
      const heat = progress === 1 ? to : from + (to - from) * progress;
      if (progress === 1 && !targets.has(code)) { clear(code); current.delete(code); }
      else { write(code, heat); current.set(code, { heat, baseline }); }
    }
  }, clock);
}
