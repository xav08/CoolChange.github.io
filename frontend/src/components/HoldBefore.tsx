import { useEffect } from "react";
import "./hold-before.css";

export function HoldBefore({ active, enabled, onPreview }: { active: boolean; enabled: boolean; onPreview: (active: boolean) => void }) {
  useEffect(() => {
    if (!enabled) onPreview(false);
    const release = () => onPreview(false);
    const visibility = () => { if (document.hidden) release(); };
    window.addEventListener("blur", release);
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      release();
      window.removeEventListener("blur", release);
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, onPreview]);

  return <div className="hold-before">
    <button type="button" disabled={!enabled} aria-pressed={active}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        onPreview(true);
      }}
      onPointerUp={() => onPreview(false)} onPointerCancel={() => onPreview(false)}
      onLostPointerCapture={() => onPreview(false)} onBlur={() => onPreview(false)}
      onKeyDown={event => {
        if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (!event.repeat) onPreview(true); }
        if (event.key === "Escape") onPreview(false);
      }}
      onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); onPreview(false); } }}
      onContextMenu={event => event.preventDefault()}>Hold to see before</button>
    <p role="status">{active ? "Showing before. Release to return." : "Release to return to your trees."}</p>
  </div>;
}
