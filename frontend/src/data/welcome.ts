export type WelcomePhase = "welcome" | "entering" | "complete";
export const WELCOME_TRANSITION_MS = 3200;
export type WelcomeEntryFrame = { progress: number };
export type WelcomeEntryCallbacks = {
  onEntryReady?: () => void;
  onEntryFrame?: (frame: WelcomeEntryFrame) => void;
  onEntryComplete?: () => void;
  onEntryUnavailable?: () => void;
};

function easeBetween(progress: number, start: number, end: number) {
  const t = Math.max(0, Math.min(1, (progress - start) / (end - start)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Both renderers follow the street's animation clock. Change trees while the
// canopy fills the frame, then reveal the neighbourhood around the same tree.
export function welcomeEntryMotion(progress: number) {
  return {
    approach: easeBetween(progress, 0, 0.3),
    backdrop: easeBetween(progress, 0.24, 0.3),
    dissolve: easeBetween(progress, 0.3, 0.4),
    pullback: easeBetween(progress, 0.3, 1),
    layout: easeBetween(progress, 0.62, 1),
    copy: easeBetween(progress, 0.82, 1),
  };
}

// Direct links to the map, About or a story chapter must keep their destination.
export function shouldShowWelcome(hash: string) {
  return ["", "#", "#top", "#story"].includes(hash);
}

export function initialWelcomePhase(): WelcomePhase {
  // Each full homepage load starts at the welcome. App state alone keeps
  // navigation within an already-open story from replaying it.
  return shouldShowWelcome(window.location.hash) ? "welcome" : "complete";
}
