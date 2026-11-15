import { defineConfig } from "vite";
import seltraComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: process.env.VITE_HMR_HOST ? {
      host: process.env.VITE_HMR_HOST,
      clientPort: Number(process.env.VITE_HMR_CLIENT_PORT),
      protocol: process.env.VITE_HMR_PROTOCOL as "ws" | "wss",
      path: process.env.VITE_HMR_PATH,
    } : undefined,
  },
  plugins: [seltraComponentTagger(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
