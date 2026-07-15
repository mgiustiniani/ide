import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { manualChunks, monacoChunkSizeWarningLimit } from "../../config/vite/manualChunks";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: monacoChunkSizeWarningLimit,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
