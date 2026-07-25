import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  test: {
    // Cryptographic exchange, PDF/XLSX generation and Windows filesystem
    // integrity checks can exceed Vitest's 5 s default under Defender/CI.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 4177,
    proxy: {
      "/api": "http://127.0.0.1:4178",
    },
  },
});
