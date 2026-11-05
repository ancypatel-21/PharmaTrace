import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on the LAN too, so the verify page can be opened from a phone during the demo.
    host: true,
    port: 5173,
  },
  test: {
    environment: "node",
  },
});
