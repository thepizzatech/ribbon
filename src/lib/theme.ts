import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "ribbon-theme";

function read(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const listeners = new Set<() => void>();

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    listeners.delete(listener);
    observer.disconnect();
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "light");
}
