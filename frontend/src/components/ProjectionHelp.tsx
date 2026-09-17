import { useId, useState } from "react";
import { daysBand, type ProjectionBand, type WarmingLevel } from "../utils/projections";

export function ProjectionHelp({ band, level, suburbName }: { band: ProjectionBand | undefined; level: WarmingLevel; suburbName: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const explanation = band?.days_lower == null
    ? `A hot-day estimate for ${suburbName} is not available at ${level.toFixed(1)}°C global warming.`
    : `At ${level.toFixed(1)}°C global warming above pre-industrial levels, ${suburbName} is projected to have ${daysBand(band)} days a year reaching 35°C or hotter. It's a yearly range, not consecutive days.`;
  return <div className="projection-help" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" aria-expanded={open} aria-describedby={open ? id : undefined}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
      What does this mean? <span aria-hidden="true">ⓘ</span>
    </button>
    {open && <p id={id} role="tooltip">{explanation}</p>}
  </div>;
}
