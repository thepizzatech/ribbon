// Environment-driven settings, read at call time so tests can change them.
const truthy = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
};

/** Seed the sample household on a brand-new database (development only; default off). */
export function seedSampleData(): boolean {
  return truthy(process.env.SEED_SAMPLE_DATA, false);
}

let warnedEnforce = false;
/**
 * Deprecated alias. ENFORCE_HTTPS=true used to redirect inside the app; the app now speaks plain
 * HTTP and leaves TLS to a reverse proxy. It now means "refuse password sign-in over plain HTTP,
 * even from the home network".
 */
export function enforceHttps(): boolean {
  const on = truthy(process.env.ENFORCE_HTTPS, false);
  if (on && !warnedEnforce) {
    warnedEnforce = true;
    console.warn(
      "[ribbon] ENFORCE_HTTPS is deprecated. Put Ribbon behind an HTTPS reverse proxy and set PUBLIC_URL. " +
        "For now it means: refuse password sign-in over plain HTTP from everywhere. See docs/REVERSE-PROXY.md.",
    );
  }
  return on;
}

/** Allow password sign-in over plain HTTP from addresses outside the private ranges. Default off. */
export function allowInsecureLogin(): boolean {
  return truthy(process.env.ALLOW_INSECURE_LOGIN, false);
}

/** Send Strict-Transport-Security when the request is effectively HTTPS. HSTS=off disables it. */
export function hstsEnabled(): boolean {
  const value = process.env.HSTS?.trim().toLowerCase();
  return !(value === "off" || value === "false" || value === "0" || value === "no");
}

export const DEFAULT_TRUSTED_PROXIES = [
  "127.0.0.0/8",
  "::1/128",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "fc00::/7",
  "100.64.0.0/10",
];

/** CIDR list of peers whose X-Forwarded-* headers are believed. "none" trusts nobody. */
export function trustedProxies(): string[] {
  const raw = process.env.TRUSTED_PROXIES?.trim();
  if (!raw) return DEFAULT_TRUSTED_PROXIES;
  if (raw.toLowerCase() === "none") return [];
  return raw.split(/[\s,]+/).filter(Boolean);
}

/** Optional absolute https URL used as the redirect target (e.g. https://10.0.0.5:8443). */
export function publicUrl(): string | undefined {
  const value = process.env.PUBLIC_URL?.trim().replace(/\/+$/, "");
  return value || undefined;
}

/** Optional code the very first visitor must type to create the owner account. */
export function setupCode(): string | undefined {
  return process.env.SETUP_CODE?.trim() || undefined;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function devAccount() {
  return {
    username: process.env.DEV_USERNAME?.trim() || "admin",
    password: process.env.DEV_PASSWORD?.trim() || "ribbon-dev-password",
  };
}
