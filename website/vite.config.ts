import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  base: "/",
  server: {
    host: "::",
    port: 5273,
    proxy: {
      // Studio talks to the local engine backend (web/server.js, default :8088).
      // Override with AO_BACKEND when running the backend on another port.
      "/api": {
        target: process.env.AO_BACKEND || "http://localhost:8088",
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) {
            return "vendor-framer-motion";
          }
          if (/[\\/]node_modules[\\/](recharts|d3-|victory-vendor|internmap)/.test(id)) {
            return "vendor-charts";
          }
          if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id)) {
            return "vendor-radix";
          }
          return undefined;
        },
      },
    },
  },
});
