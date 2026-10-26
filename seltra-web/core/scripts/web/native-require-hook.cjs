const Module = require("node:module");
const path = require("node:path");

const nativeRoot = path.resolve(__dirname, "../../runtime/native");
const nativeAnchor = new Module(path.join(nativeRoot, "package.json"), module);
nativeAnchor.filename = path.join(nativeRoot, "package.json");
nativeAnchor.paths = Module._nodeModulePaths(nativeRoot);
const nativeModules = new Set([
  "better-sqlite3",
  "node-pty",
  "dugite",
  "@vscode/ripgrep",
  "ssh2",
]);
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveRuntimeNative(
  request,
  parent,
  isMain,
  options,
) {
  if (nativeModules.has(request)) {
    return originalResolveFilename.call(
      this,
      request,
      nativeAnchor,
      false,
      options,
    );
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
