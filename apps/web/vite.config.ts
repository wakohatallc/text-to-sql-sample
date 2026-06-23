import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * React SPAのVite設定である。
 *
 * ローカル開発ではAPI系pathをHono APIサーバへproxyする。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/auth": "http://127.0.0.1:3001",
      "/me": "http://127.0.0.1:3001",
      "/chat-threads": "http://127.0.0.1:3001"
    }
  }
});
