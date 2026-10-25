import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

// Dev: `vite dev` (port 8080). Production: `vite build` emits a standalone
// Node server at .output/server/index.mjs (Nitro node-server preset).
export default defineConfig(({ command }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    ...(command === "build"
      ? [nitro({ preset: "node-server", serverDir: "./server" })]
      : []),
    viteReact(),
  ],
}));
