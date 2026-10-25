// Install-to-home-screen support. The service worker only registers on secure contexts (HTTPS or localhost).
import { useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/version";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

let started = false;
export function initPwa(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  if ("serviceWorker" in navigator && window.isSecureContext) {
    const register = () => void navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(APP_VERSION)}`, { scope: "/" }).catch(() => undefined);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }
}

export type InstallState = {
  /** Browser offers a one-tap install. */
  canPrompt: boolean;
  installed: boolean;
  secure: boolean;
  ios: boolean;
  prompt: () => Promise<void>;
};

export function useInstall(): InstallState {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
  return {
    canPrompt: deferred !== null,
    installed: standalone,
    secure: typeof window !== "undefined" && window.isSecureContext,
    ios: typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent),
    prompt: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice.catch(() => undefined);
      deferred = null;
      notify();
    },
  };
}
