import { readFileSync } from "node:fs";

declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;

function fromPackageJson(): string {
  try {
    const text = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    return (JSON.parse(text) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The build bakes these in (vite `define`); tests and plain Node fall back to package.json and env. */
export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : fromPackageJson();
}

export function appCommit(): string {
  const baked = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "";
  return (baked || process.env.GIT_COMMIT || "").slice(0, 7);
}

export function versionInfo() {
  return { version: appVersion(), commit: appCommit() || null };
}
