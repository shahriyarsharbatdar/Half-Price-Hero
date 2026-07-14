import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Local dev only — the deployed build talks to the API via VITE_API_URL
    // instead (see src/HalfPriceHero.jsx), since Vite's dev proxy doesn't
    // exist in the static build Vercel serves.
    proxy: { "/api": "http://localhost:3001" },
  },
});
