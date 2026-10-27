import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "ribbon-theme";

function read(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const listeners = new Set<() => void>();

/** The browser chrome (status bar, address bar) follows the page background, including when the theme is chosen by hand. */
export const THEME_COLOR: Record<Theme, string> = { light: "#f5f5f7", dark: "#030712" };

export function setThemeColor(theme: Theme) {
  let meta = document.getElementById("theme-color-live") as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement("meta");
    meta.id = "theme-color-live";
    meta.name = "theme-color";
    document.head.insertBefore(meta, document.head.firstChild);
  }
  meta.content = THEME_COLOR[theme];
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  setThemeColor(theme);
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
