import "./styles/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { applyTheme, getThemePreference } from "./lib/theme";

// Before the first render, so the app never flashes the wrong theme.
applyTheme(getThemePreference());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
