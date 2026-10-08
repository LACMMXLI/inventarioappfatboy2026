import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Fatboy Inventarios",
        short_name: "Fatboy",
        lang: "es-MX",
        description: "Control de inventario y conteos por sucursal",
        theme_color: "#111d31",
        background_color: "#f4f6fb",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": process.env.API_TARGET ?? "http://127.0.0.1:3000" },
  },
  build: { chunkSizeWarningLimit: 1000 },
});
