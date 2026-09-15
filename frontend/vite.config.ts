import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// configure the local frontend server
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // forward frontend api calls to the local backend
    proxy: { "/api": "http://localhost:3001" },
  },
});
