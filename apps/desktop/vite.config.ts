import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  manualChunks,
  monacoChunkSizeWarningLimit,
} from "../../config/vite/manualChunks";

const require = createRequire(new URL("../../packages/ui/package.json", import.meta.url));
const tailwindcss = require("tailwindcss");
const autoprefixer = require("autoprefixer");
const tailwindConfig = fileURLToPath(
  new URL("../../packages/ui/tailwind.config.ts", import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss({ config: tailwindConfig }), autoprefixer()],
    },
  },
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: monacoChunkSizeWarningLimit,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
