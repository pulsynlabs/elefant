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
  // Target modern Chromium (WebKitGTK 2.52 ships a recent V8/Blink).
  // Avoids unnecessary transpilation of modern JS syntax.
  esbuild: {
    target: "chrome120",
  },
  // Tauri packages use Tauri-specific globals (__TAURI__) and must not be
  // pre-bundled by Vite. Excluding them prevents the 504 "Outdated Optimize
  // Dep" errors and the cascading text/html MIME type + WebSocket failures.
  optimizeDeps: {
    exclude: [
      "@tauri-apps/api",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/api/webviewWindow",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-fs",
      "@tauri-apps/plugin-process",
      "@tauri-apps/plugin-shell",
      "@tauri-apps/plugin-store",
    ],
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
      '/v1/fieldnotes': { target: 'http://localhost:1337', ws: true },
    },
  },
}));
