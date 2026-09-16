import { useId, useState } from "react";

export function MetricHelp({ children, label }: { children: string; label: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={`metric-help${open ? " is-open" : ""}`}>
      <button type="button" aria-label={label} aria-describedby={id} aria-expanded={open}
        onClick={() => setOpen(value => !value)} onBlur={() => setOpen(false)}
        onKeyDown={event => { if (event.key === "Escape") { setOpen(false); event.currentTarget.blur(); } }}>?</button>
      <span id={id} role="tooltip" className="metric-help-tooltip">{children}</span>
    </span>
  );
}
