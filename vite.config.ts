import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Dev: `vite dev` (port 8080). Production: `vite build` emits a standalone
// Node server at .output/server/index.mjs (Nitro node-server preset).
export default defineConfig(({ command }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Short git SHA, passed in as a build arg by Docker/CI (empty when unknown).
    __APP_COMMIT__: JSON.stringify((process.env.GIT_COMMIT ?? "").slice(0, 7)),
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    ...(command === "build"
      ? [nitro({ preset: "node-server", serverDir: "./server" })]
      : []),
    viteReact(),
  ],
}));
