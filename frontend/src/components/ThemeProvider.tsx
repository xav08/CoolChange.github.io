import { useEffect, useState, type ReactNode } from "react";
import { ThemeContext, THEME_KEY, type Theme } from "../hooks/useTheme";

export function ThemeProvider({ children, initial }: { children: ReactNode; initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#101d19" : "#173e2f");
  }, [theme]);
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* Keep working without persistence. */ }
  }
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
