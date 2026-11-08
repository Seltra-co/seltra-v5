import path from "node:path";

const markdownDocs = new Set([
  "readme.md",
  "changelog.md",
  "changes.md",
  "contributing.md",
  "history.md",
  "license.md",
  "code_of_conduct.md",
  "security.md",
]);

export function shouldPruneRuntimeFile(relativePath) {
  const basename = path.basename(relativePath).toLowerCase();
  return /\.map$/.test(basename) || /\.d\.ts$/.test(basename) || markdownDocs.has(basename);
}
