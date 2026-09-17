import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./theme.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { initialTheme } from "./hooks/useTheme";

const theme = initialTheme();
document.documentElement.dataset.theme = theme;

// mount the application in the browser root
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider initial={theme}><App /></ThemeProvider>
  </StrictMode>,
);
