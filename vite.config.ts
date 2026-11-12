import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev we proxy so the browser never hits CORS; a packaged build talks to
// the edition's own origin (src/edition.ts).
const BIRDBRAIN_ORIGIN = process.env.BIRDBRAIN_ORIGIN || "https://birdbrain.wtf";

// y-collab relay (Yjs websocket) for shared notes. Runs as a local process
// service on Zo; the browser reaches it through this dev proxy so there's no
// CORS and nothing to configure. In a Tauri build, set VITE_COLLAB_URL to the
// public wss endpoint instead.
const COLLAB_ORIGIN = process.env.COLLAB_ORIGIN || "http://127.0.0.1:52790";

// `tauri ios/android dev` sets TAURI_DEV_HOST to the LAN address the phone uses
// to reach this dev server; HMR has to point back at that host or the device
// can't open the websocket. Unset (plain web/desktop dev) keeps the defaults.
const tauriHost = process.env.TAURI_DEV_HOST;


// A group we are onboarding gets a demo written for it (src/demo/packs/<id>.json,
// infra/skills/onboarding-demo). Only its own build carries it, so no other
// edition's bundle can name the group or show what we wrote for it.
const PACK = path.join(__dirname, "src", "demo", "packs", `${process.env.VITE_EDITION ?? ""}.json`);
const pack = process.env.VITE_EDITION && existsSync(PACK) ? readFileSync(PACK, "utf8") : "null";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __PACK__: pack },
  clearScreen: false,
  server: {
    host: tauriHost || true,
    port: 5273,
    strictPort: true,
    hmr: tauriHost
      ? { protocol: "ws", host: tauriHost, port: 5274 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    proxy: {
      "/api/birdbrain": {
        target: BIRDBRAIN_ORIGIN,
        changeOrigin: true,
        secure: true,
      },
      // Sense-making vault (the work with Matt): notes capture into core/vault.
      "/api/sensemaking": {
        target: BIRDBRAIN_ORIGIN,
        changeOrigin: true,
        secure: true,
      },
      // Decent Pay (Bloque) wallet proxy lives on the same Decent origin.
      "/api/wallet": {
        target: BIRDBRAIN_ORIGIN,
        changeOrigin: true,
        secure: true,
      },
      // Codename routes: updater manifest, invite graph, feedback backlog.
      "/api/murmur": {
        target: BIRDBRAIN_ORIGIN,
        changeOrigin: true,
        secure: true,
      },
      // Chaos Sessions: next-session schedule for the meet plugin.
      "/api/chaOS": {
        target: BIRDBRAIN_ORIGIN,
        changeOrigin: true,
        secure: true,
      },
      // Shared notes: websocket → local Yjs relay. Strip /yjs so the relay's
      // room name is just the path it receives (e.g. /yjs/my-note → /my-note).
      "/yjs": {
        target: COLLAB_ORIGIN,
        ws: true,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/yjs/, ""),
      },
    },
  },
});
