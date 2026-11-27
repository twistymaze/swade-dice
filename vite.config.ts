import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

const entry = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.glb", "**/*.hdr"],
  server: {
    cors: true,
  },
  build: {
    sourcemap: true,
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
