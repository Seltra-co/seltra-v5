import { runBrowserPath } from "./repro-browser-path.mjs";

// DEV-only browser acceptance entry point. Preview lifecycle checks live in
// the same authenticated browser context as the project build flow.
await runBrowserPath();
