import path from "node:path";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shim = path.join(root, "src/web/electron-shim/index.ts");

await build({
  absWorkingDir: root,
  entryPoints: ["src/web/runtime_main.ts"],
  outfile: "dist/runtime/runtime_main.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  target: "node24",
  sourcemap: true,
  tsconfig: "tsconfig.app.json",
  alias: { electron: shim },
  loader: { ".md": "text", ".txt": "text" },
  external: [
    "better-sqlite3",
    "node-pty",
    "dugite",
    "@vscode/ripgrep",
    "ssh2",
    "dyad-keychain-reader",
  ],
  plugins: [
    {
      name: "runtime-safe-storage-require",
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => {
          const importPath = args.path.slice(0, -"?raw".length);
          const resolvedPath = importPath.startsWith("@/")
            ? path.join(root, "src", importPath.slice(2))
            : path.resolve(args.resolveDir, importPath);
          return { path: resolvedPath };
        });
        build.onLoad({ filter: /safe_storage_legacy\.ts$/ }, (args) => ({
          contents: fsSync
            .readFileSync(args.path, "utf8")
            .replace("createRequire(import.meta.url)", "createRequire(__filename)"),
          loader: "ts",
        }));
      },
    },
  ],
});

fsSync.rmSync(path.join(root, "dist/runtime/package.json"), { force: true });

console.log("Built dist/runtime/runtime_main.js");
