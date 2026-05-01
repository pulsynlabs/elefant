import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [svelte(), tailwindcss()],
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
      $features: path.resolve("./src/features"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: false,
    host: host || true,
    hmr: host
      ? {
          protocol: "ws",
          host,
    port: 1420,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      '/health': { target: 'http://localhost:1337', ws: true },
      '/api': { target: 'http://localhost:1337', ws: true },
      '/tools': { target: 'http://localhost:1337', ws: true },
    },
  },
}));
