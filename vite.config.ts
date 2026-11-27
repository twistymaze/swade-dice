import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

const entry = (file: string) => fileURLToPath(new URL(file, import.meta.url));

/** Origins allowed to read the dev server cross-origin. */
export const OWLBEAR_ORIGINS = ["https://www.owlbear.rodeo", "https://owlbear.rodeo"];

/**
 * Content Security Policy for the production pages (C-09). OBR loads each page in an iframe from
 * the extension origin and talks to it with postMessage, so the pages only need their own origin:
 * - script-src 'wasm-unsafe-eval': Rapier compiles its WebAssembly module.
 * - style-src 'unsafe-inline': MUI/Emotion inject style elements. Google Fonts (Inter, OD-10).
 * - img/media/connect 'self' data: blob:: GLTF embedded textures (blob:), inlined small assets
 *   (data:), and textures, models, HDR and audio fetched from the build.
 * frame-ancestors is not set: a meta CSP ignores it (header only).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

/**
 * Adds the CSP as a meta element to every HTML entry in the production build only. The dev
 * server needs inline scripts and the HMR websocket, so it gets no policy.
 */
export function cspPlugin(policy = CONTENT_SECURITY_POLICY): Plugin {
  return {
    name: "swade-csp",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler: () => [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: policy },
          injectTo: "head-prepend",
        },
      ],
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), cspPlugin()],
  assetsInclude: ["**/*.glb", "**/*.hdr"],
  server: {
    // OBR (https://www.owlbear.rodeo) fetches the dev manifest and assets cross-origin from
    // localhost:5173. Allow only the Owlbear origins, not every site (C-10).
    cors: { origin: OWLBEAR_ORIGINS },
  },
  build: {
    // Maps are written for debugging but not linked from the bundles (C-10).
    sourcemap: "hidden",
    rollupOptions: {
      input: {
        main: entry("./index.html"),
        background: entry("./background.html"),
        popover: entry("./popover.html"),
      },
      output: {
        // Long-lived vendor chunks: app changes do not invalidate the cached
        // libraries. Rapier stays in the lazy physics chunk.
        codeSplitting: {
          groups: [
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "vendor-three", test: /node_modules[\\/](three|three-stdlib|@react-three[\\/](fiber|drei))[\\/]/ },
            { name: "vendor-mui", test: /node_modules[\\/](@mui[\\/](?!x-)|@emotion[\\/])/ },
          ],
        },
      },
    },
  },
});
