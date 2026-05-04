import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

/** Vite plugin that marks @capacitor/* packages as external so they are
 *  never resolved at build time. These packages live in mobile/node_modules/
 *  and are only loaded via dynamic import when isCapacitorRuntime is true. */
function capacitorExternal() {
  return {
    name: 'capacitor-external',
    resolveId(id: string) {
      if (id.startsWith('@capacitor/')) {
        return { id, external: true };
      }
      return null;
    },
  };
}

export default defineConfig(async () => ({
  plugins: [svelte(), tailwindcss(), capacitorExternal()],
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
      '/v1/research': { target: 'http://localhost:1337', ws: true },
    },
  },
}));
