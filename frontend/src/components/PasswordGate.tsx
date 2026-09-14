import { useState, type ReactNode, type FormEvent } from "react";

const SESSION_KEY = "coolchange_unlocked";
const SITE_PASSWORD = import.meta.env.VITE_SITE_PASSWORD;

export function PasswordGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === "true"
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input === SITE_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "true");
      setUnlocked(true);
    } else {
      setError(true);
    }
  };

  if (unlocked) return <>{children}</>;

  return (
    <>
      {/* Rendered underneath so the real app is present (for layout/perf)
          but visually dimmed and non-interactive until unlocked. */}
      <div style={{ filter: "blur(4px)", pointerEvents: "none", userSelect: "none" }}>
        {children}
      </div>

      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{
            background: "white",
            padding: "2rem",
            borderRadius: "12px",
            width: "min(90vw, 360px)",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>This site is password protected</h2>
          <input
            type="password"
            autoFocus
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(false);
            }}
            placeholder="Enter password"
            style={{
              padding: "0.6rem 0.75rem",
              borderRadius: "8px",
              border: error ? "1px solid #d33" : "1px solid #ccc",
              fontSize: "1rem",
            }}
          />
          {error && (
            <span style={{ color: "#d33", fontSize: "0.85rem" }}>Incorrect password</span>
          )}
          <button
            type="submit"
            style={{
              padding: "0.6rem",
              borderRadius: "8px",
              border: "none",
              background: "#1a1a1a",
              color: "white",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            Unlock
          </button>
        </form>
      </div>
    </>
  );
}