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

/** Lets the very first owner be created from a public address without a SETUP_CODE (off by default). */
export function allowPublicSetup(): boolean {
  const value = process.env.ALLOW_PUBLIC_SETUP?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
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

/** Five-field cron for scheduled backups (minute hour day month weekday). "off" disables. Default: daily at 03:00. */
export function backupCron(): string {
  const raw = process.env.BACKUP_CRON?.trim();
  return raw ? raw : "0 3 * * *";
}

/** How many scheduled backups to keep (older ones are deleted). Default 14. */
export function backupKeep(): number {
  const n = Number(process.env.BACKUP_KEEP);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 14;
}

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  autoLinkByEmail: boolean;
  buttonLabel: string;
};

/** Single sign-on settings from the environment, or null when OIDC_ISSUER / OIDC_CLIENT_ID are not both set. */
export function oidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER?.trim().replace(/\/+$/, "");
  const clientId = process.env.OIDC_CLIENT_ID?.trim();
  if (!issuer || !clientId) return null;
  const scopes = new Set((process.env.OIDC_SCOPES?.trim() || "openid profile email").split(/[\s,]+/).filter(Boolean));
  scopes.add("openid");
  return {
    issuer,
    clientId,
    clientSecret: process.env.OIDC_CLIENT_SECRET?.trim() ?? "",
    scopes: [...scopes].join(" "),
    autoLinkByEmail: truthy(process.env.OIDC_AUTO_LINK_BY_EMAIL, false),
    buttonLabel: (process.env.OIDC_BUTTON_LABEL?.trim() || "Sign in with SSO").slice(0, 40),
  };
}

/** Hide the password form. Only takes effect when single sign-on is configured, so it can't lock everyone out by accident. */
export function passwordLoginDisabled(): boolean {
  return truthy(process.env.DISABLE_PASSWORD_LOGIN, false) && oidcConfig() !== null;
}

/** Show the guided tour on every sign-in until it is finished (for testing). */
export function tourAlways(): boolean {
  return truthy(process.env.TOUR_ALWAYS, false);
}

/** The tour is off by default in sample-data development mode; this (or TOUR_ALWAYS) turns it on there. */
export function tourInDev(): boolean {
  return truthy(process.env.TOUR_IN_DEV, false);
}
