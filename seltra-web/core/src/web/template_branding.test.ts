import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { brandWebBlankScaffold } from "./template_branding";

let appPath: string | undefined;

afterEach(async () => {
  if (appPath) await fs.rm(appPath, { recursive: true, force: true });
  appPath = undefined;
});

it("brands only the copied blank app when called by the web template path", async () => {
  appPath = await fs.mkdtemp(path.join(os.tmpdir(), "seltra-scaffold-"));
  await fs.mkdir(path.join(appPath, "src", "pages"), { recursive: true });
  await fs.mkdir(path.join(appPath, "src", "components"), { recursive: true });
  await fs.mkdir(path.join(appPath, "public"), { recursive: true });
  await fs.mkdir(path.join(appPath, "assets", "icon"), { recursive: true });
  await fs.writeFile(
    path.join(appPath, "src", "pages", "Index.tsx"),
    "<h1>Welcome to Your Blank App</h1>",
  );
  await fs.writeFile(
    path.join(appPath, "index.html"),
    '<html><head></head><body><div id="root"></div></body></html>',
  );
  const logo = path.join(appPath, "assets", "icon", "seltra-mark.png");
  await fs.writeFile(logo, Buffer.from([137, 80, 78, 71]));
  await fs.writeFile(
    path.join(appPath, "src", "components", "made-with-dyad.tsx"),
    "Made with Dyad",
  );

  await brandWebBlankScaffold(appPath, logo);

  expect(
    await fs.readFile(path.join(appPath, "src", "pages", "Index.tsx"), "utf8"),
  ).toContain("Welcome to Your New App");
  expect(
    await fs.readFile(
      path.join(appPath, "src", "components", "made-with-dyad.tsx"),
      "utf8",
    ),
  ).toContain("Made with Seltra");
  const html = await fs.readFile(path.join(appPath, "index.html"), "utf8");
  expect(html).toContain('href="/seltra-mark.png"');
  expect(html).toContain("Built with Seltra");
  expect(html).toContain('id="seltra-attribution-close"');
  expect(html).toContain('"seltra:build-complete"');
  expect(html).toContain("seltra-attribution-seen");
  expect(html).toContain("window.top===window");
  expect(
    await fs.readFile(path.join(appPath, "public", "seltra-mark.png")),
  ).toEqual(Buffer.from([137, 80, 78, 71]));
});
