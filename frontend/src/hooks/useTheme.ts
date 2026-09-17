import { createContext, useContext } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "coolchange-theme";
export const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({ theme: "light", toggleTheme: () => {} });

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* Storage can be unavailable in private browsing. */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() { return useContext(ThemeContext); }
