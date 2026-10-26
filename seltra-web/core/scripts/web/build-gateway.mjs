import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "server/src/main.ts")],
  outfile: "server/dist/main.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  sourcemap: true,
  tsconfigRaw: {
    compilerOptions: {
      baseUrl: root,
      paths: { "@/*": ["src/*"] },
    },
  },
  external: ["@nestjs/*", "@prisma/client", "http-proxy", "jose", "reflect-metadata", "rxjs", "ws", "zod"],
});
console.log("Built server/dist/main.mjs");
