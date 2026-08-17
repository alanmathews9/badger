import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// In dev the frontend runs on Vite and the agent runs on src/server.mjs, so
// /api is proxied rather than opened up with CORS. In production the same
// Node server serves this build, and the proxy is simply unused.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.BADGER_PORT ?? 4000}`,
        changeOrigin: true,
      },
    },
  },
});
