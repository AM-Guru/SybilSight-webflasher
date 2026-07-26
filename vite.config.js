import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    proxy: {
      // The production deployment carries the immutable, hash-pinned firmware
      // archive separately from this source tree. Keep the local catalog file
      // local, but resolve its versioned binary/metadata paths from production
      // so hardware tests never receive Vite's index.html fallback.
      "/firmware-updates/source-files/2": {
        target: "https://webflasher.sybilsight.com",
        changeOrigin: true,
      },
    },
    watch: {
      usePolling: process.env.CODEX_SANDBOX === "seatbelt",
    },
  },
});
