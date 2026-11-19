import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const serverPort = Number(process.env.PORT ?? 3000);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  root: path.resolve(import.meta.dirname),
  build: { outDir: path.resolve(import.meta.dirname, "dist/public"), emptyOutDir: true },
  // In development the web app runs on :5173 and forwards /api to the server.
  server: { port: 5173, strictPort: true, proxy: { "/api": { target: `http://127.0.0.1:${serverPort}` } } },
});
