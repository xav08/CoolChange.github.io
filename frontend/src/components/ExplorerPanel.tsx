import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { sheetAfterDrag, sheetSizes, type SheetSize } from "../utils/explorerSheet";
import "./explorer-sheet.css";

const query = "(max-width: 760px)";
function subscribe(notify: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

export function ExplorerPanel({ panelRef, className, selectionKey, title, summary, onCollapse, children }: {
  panelRef: RefObject<HTMLElement | null>; className: string; selectionKey: string;
  title: string; summary: string; onCollapse: () => void; children: ReactNode;
}) {
  const mobile = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
  const [size, setSize] = useState<SheetSize>("half");
  const drag = useRef<{ y: number; size: SheetSize } | null>(null);
  const dragged = useRef(false);
  const id = useId();
  useEffect(() => { setSize("half"); }, [selectionKey]);

  function resize(next: SheetSize) {
    if (next === "collapsed") onCollapse();
    setSize(next);
  }

  return <section ref={panelRef} className={className} aria-label="Map explorer" data-sheet={size}>
    <div className="mobile-sheet-header">
      <button type="button" className="sheet-drag-handle" aria-label="Resize information panel" aria-expanded={size !== "collapsed"} aria-controls={id}
        onPointerDown={event => { drag.current = { y: event.clientY, size }; dragged.current = false; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={event => {
          if (!drag.current) return;
          const delta = event.clientY - drag.current.y;
          dragged.current = Math.abs(delta) >= 40;
          resize(sheetAfterDrag(drag.current.size, delta));
          drag.current = null;
        }}
        onPointerCancel={() => { drag.current = null; dragged.current = true; }}
        onClick={() => { if (!dragged.current) resize(size === "collapsed" ? "half" : size === "half" ? "full" : "collapsed"); dragged.current = false; }}
        onKeyDown={event => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); resize(sheetAfterDrag(size, event.key === "ArrowUp" ? -60 : 60)); }
          if (event.key === "Escape") resize("collapsed");
        }}><span aria-hidden="true" /></button>
      <div className="sheet-size-controls" role="group" aria-label="Information panel size">
        {sheetSizes.map(value => <button key={value} type="button" aria-pressed={value === size} onClick={() => resize(value)}>{value === "collapsed" ? "Map" : value === "half" ? "Half" : "Full"}</button>)}
      </div>
      {size === "collapsed" && <button className="sheet-summary" type="button" onClick={() => resize("half")} aria-expanded={false} aria-controls={id}>
        <strong>{title}</strong><span>{summary}</span>
      </button>}
    </div>
    <div id={id} className="map-explorer-content" hidden={mobile && size === "collapsed"}>{children}</div>
  </section>;
}
