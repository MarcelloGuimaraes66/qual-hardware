import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
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
