type Timer = { set: (callback: () => void, delay: number) => number; clear: (id: number) => void };
const browserTimer: Timer = { set: (callback, delay) => window.setTimeout(callback, delay), clear: id => window.clearTimeout(id) };

export function queueCoolingPulse(revision: number, consumed: { current: number }, enabled: boolean, interacting: boolean,
  emit: (revision: number) => void, timer: Timer = browserTimer,
) {
  if (!enabled) { consumed.current = revision; return () => {}; }
  if (interacting || consumed.current === revision) return () => {};
  let cancelled = false;
  const id = timer.set(() => {
    if (cancelled) return;
    consumed.current = revision;
    emit(revision);
  }, 250);
  return () => { cancelled = true; timer.clear(id); };
}
