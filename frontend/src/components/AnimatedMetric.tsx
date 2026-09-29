import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { tween } from "../utils/plantingMotion";

export function AnimatedMetric({ value, decimals = 1, unit = "", negative = false }: {
  value: number; decimals?: number; unit?: string; negative?: boolean;
}) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(value);
  const current = useRef(value);
  const element = useRef<HTMLSpanElement>(null);
  const format = (number: number) => `${negative && Number(number.toFixed(decimals)) > 0 ? "−" : ""}${number.toFixed(decimals)}${unit}`;

  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    const highlight = !reduced ? element.current?.animate(
      [{ backgroundColor: "transparent" }, { backgroundColor: "rgba(100, 160, 100, 0.18)", offset: 0.3 }, { backgroundColor: "transparent" }],
      { duration: 320, easing: "ease-out" },
    ) : undefined;
    const cancel = tween(reduced ? 0 : 250, progress => {
      const next = progress === 1 ? value : from + (value - from) * progress;
      current.current = next;
      setVisible(next);
    });
    return () => { cancel(); highlight?.cancel(); };
  }, [value, reduced]);

  // Assistive technology gets the actual result, never intermediate animation frames.
  return <span className="animated-metric" ref={element}>
    <span aria-hidden="true">{format(reduced ? value : visible)}</span>
    <span className="metric-screen-reader">{format(value)}</span>
  </span>;
}
