import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    watch: {
      usePolling: process.env.CODEX_SANDBOX === "seatbelt",
    },
  },
});
