import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.SELTRA_ALLOW_BARE_VITE !== "1") {
  console.error(
    "This starts only the renderer; use npm run web:dev for the complete browser app.",
  );
  process.exitCode = 1;
} else {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const vite = path.join(root, "node_modules/vite/bin/vite.js");
  const child = spawn(
    process.execPath,
    [vite, "--config", "vite.web.config.mts", ...process.argv.slice(2)],
    { cwd: root, stdio: "inherit", env: process.env },
  );

  child.once("error", (error) => {
    console.error("Could not start Vite:", error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
