import * as React from "react";

import { safeStorage } from "./utils";

/** Appearance preference, stored per device. "system" follows the OS setting. */
export type ThemePreference = "dark" | "light" | "system";

const KEY = "oddly.theme";
const media = () => window.matchMedia("(prefers-color-scheme: light)");

export function getThemePreference(): ThemePreference {
  const v = safeStorage.get(KEY);
  return v === "light" || v === "system" || v === "dark" ? v : "dark";
}

function resolve(pref: ThemePreference): "dark" | "light" {
  if (pref === "system") return media().matches ? "light" : "dark";
  return pref;
}

/** Sets `data-theme` on <html>; the CSS tokens switch from there. */
export function applyTheme(pref: ThemePreference) {
  document.documentElement.dataset.theme = resolve(pref);
}

const listeners = new Set<(p: ThemePreference) => void>();

export function setThemePreference(pref: ThemePreference) {
  safeStorage.set(KEY, pref);
  applyTheme(pref);
  listeners.forEach((l) => l(pref));
}

export function useTheme() {
  const [pref, setPref] = React.useState<ThemePreference>(getThemePreference);

  React.useEffect(() => {
    listeners.add(setPref);
    return () => {
      listeners.delete(setPref);
    };
  }, []);

  // Follow OS changes while on "system".
  React.useEffect(() => {
    if (pref !== "system") return;
    const mq = media();
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return { preference: pref, setPreference: setThemePreference };
}
