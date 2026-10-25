/** Version info baked in at build time (see vite.config.ts). */
export const APP_VERSION: string = __APP_VERSION__;
export const APP_COMMIT: string = __APP_COMMIT__;

export function versionLabel(): string {
  return APP_COMMIT ? `v${APP_VERSION} (${APP_COMMIT})` : `v${APP_VERSION}`;
}
