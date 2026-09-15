import { useEffect, useState } from "react";

// return the story card currently in view
export function useActiveStoryStep() {
  const [activeStep, setActiveStep] = useState(0);

  // observe story cards after the page mounts
  useEffect(() => {
    const steps = Array.from(document.querySelectorAll<HTMLElement>("[data-story-step]"));
    if (!steps.length) return undefined;

    // track the story card most visible in the viewport
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisibleStep = entries
          .filter((entry) => entry.isIntersecting)
          .sort((first, second) => second.intersectionRatio - first.intersectionRatio)[0];

        if (mostVisibleStep) {
          setActiveStep(Number(mostVisibleStep.target.getAttribute("data-story-step")) || 0);
        }
      },
      { rootMargin: "-28% 0px -36%", threshold: [0, 0.25, 0.5, 0.75] },
    );

    steps.forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, []);

  return activeStep;
}
