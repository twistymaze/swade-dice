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
    },
  },
});
