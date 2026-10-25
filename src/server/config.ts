// Environment-driven settings, read at call time so tests can change them.
const truthy = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
};

/** Seed the sample household on a brand-new database (development only; default off). */
export function seedSampleData(): boolean {
  return truthy(process.env.SEED_SAMPLE_DATA, false);
}

/** Redirect plain HTTP to HTTPS, send HSTS, and mark cookies Secure. */
export function enforceHttps(): boolean {
  return truthy(process.env.ENFORCE_HTTPS, false);
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
