import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const ReactCompilerConfig = {};
const bridgePlugin: Plugin = {
  name: "seltra-web-bridge",
  enforce: "pre",
  transform(code, id) {
    if (id.replaceAll("\\", "/").endsWith("/src/renderer.tsx")) {
      return `import "/src/web/client/install_bridge.ts";\n${code}`;
    }
  },
};

export default defineConfig({
  root: process.cwd(),
  plugins: [
    bridgePlugin,
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ],
  resolve: { alias: { "@": path.resolve(process.cwd(), "./src") } },
  build: { outDir: "dist-web", emptyOutDir: true },
  server: {
    watch: {
      ignored: [
        "**/userData/**",
        "**/e2e-tests/**",
        "**/node_modules/**",
        "**/.vite/**",
        "**/out/**",
      ],
    },
  },
});
