import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    headers: {
      // Allow Firebase popup auth — strict COOP blocks window.closed polling
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
      "Cross-Origin-Embedder-Policy": "unsafe-none",
    },
    proxy: {
      // REST routes — hooks use bare paths (no /api prefix)
      "/incidents": { target: "http://localhost:3000", changeOrigin: true },
      "/units":     { target: "http://localhost:3000", changeOrigin: true },
      "/dispatch":  { target: "http://localhost:3000", changeOrigin: true },
      "/protocols": { target: "http://localhost:3000", changeOrigin: true },
      "/recordings":{ target: "http://localhost:3000", changeOrigin: true },
      "/report":    { target: "http://localhost:3000", changeOrigin: true },
      "/mock":      { target: "http://localhost:3000", changeOrigin: true },
      "/health":    { target: "http://localhost:3000", changeOrigin: true },
      // SSE stream
      "/events": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // WebSocket for emergency calls (/call on the backend, /ws/call via legacy proxy)
      "/call": {
        target: "ws://localhost:3000",
        ws: true,
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws/, ""),
      },
      // Catch-all for any /api/* prefixed calls
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
