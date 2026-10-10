export type WelcomePhase = "welcome" | "entering" | "complete";
export const WELCOME_TRANSITION_MS = 1400;

// Direct links to the map, About or a story chapter must keep their destination.
export function shouldShowWelcome(hash: string) {
  return ["", "#", "#top", "#story"].includes(hash);
}

export function initialWelcomePhase(): WelcomePhase {
  // Each full homepage load starts at the welcome. App state alone keeps
  // navigation within an already-open story from replaying it.
  return shouldShowWelcome(window.location.hash) ? "welcome" : "complete";
}
