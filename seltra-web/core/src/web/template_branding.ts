import fs from "node:fs/promises";
import path from "node:path";

/** Apply Seltra branding to Vite scaffolds copied by the web runtime. */
export async function brandWebBlankScaffold(
  appPath: string,
  seltraLogoPath = path.join(
    process.cwd(),
    "assets",
    "icon",
    "seltra-mark.png",
  ),
): Promise<void> {
  const pagePath = path.join(appPath, "src", "pages", "Index.tsx");
  const badgePath = path.join(
    appPath,
    "src",
    "components",
    "made-with-dyad.tsx",
  );
  const publicPath = path.join(appPath, "public");
  const iconPath = path.join(publicPath, "seltra-mark.png");
  const indexPath = path.join(appPath, "index.html");
  try {
    const page = await fs.readFile(pagePath, "utf8");
    await fs.writeFile(
      pagePath,
      page.replaceAll("Welcome to Your Blank App", "Welcome to Your New App"),
      "utf8",
    );
  } catch {
    // Template may not use the standard starter page.
  }
  try {
    await fs.access(badgePath);
    await fs.writeFile(
      badgePath,
      `export const MadeWithDyad = () => null;\n`,
      "utf8",
    );
  } catch {
    // The persistent HTML attribution below covers templates without this component.
  }

  // Keep the attribution and favicon outside the generated React component tree
  // so normal Builder edits to App.tsx cannot accidentally remove them.
  await fs.mkdir(publicPath, { recursive: true });
  await fs.copyFile(seltraLogoPath, iconPath);
  try {
    const html = await fs.readFile(indexPath, "utf8");
    const favicon =
      '<link rel="icon" type="image/png" href="/seltra-mark.png">';
    const brandedHtml = html
      .replace(/<link[^>]*rel=["']icon["'][^>]*>\s*/gi, "")
      .replace("</head>", `  ${favicon}\n</head>`)
      .replace(
        "</body>",
        `  <div id="seltra-startup-loader" aria-label="Loading app"><img src="/seltra-mark.png" alt="" /></div>
  <style>#seltra-startup-loader{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;background:#fff;opacity:1;transition:opacity .35s ease}#seltra-startup-loader img{width:72px;height:72px;object-fit:contain;animation:seltra-glow 1.8s ease-in-out infinite}@keyframes seltra-glow{0%,100%{filter:drop-shadow(0 0 4px #16a76555);transform:scale(.96)}50%{filter:drop-shadow(0 0 18px #16a765aa);transform:scale(1.04)}}@media(prefers-reduced-motion:reduce){#seltra-startup-loader img{animation:none}}</style>
  <script>(()=>{const loader=document.getElementById("seltra-startup-loader");if(!loader)return;const hide=()=>setTimeout(()=>{loader.style.opacity="0";setTimeout(()=>loader.remove(),400)},120);if(document.readyState==="complete")hide();else window.addEventListener("load",hide,{once:true})})()</script>
  <div id="seltra-attribution" class="seltra-attribution" role="group" aria-label="Powered by Seltra" hidden><img src="/seltra-mark.png" alt="" /><span>Powered by Seltra</span><button id="seltra-attribution-close" type="button" aria-label="Dismiss Powered by Seltra"><span aria-hidden="true">×</span></button></div>
  <style>.seltra-attribution:not([hidden]){position:fixed;z-index:2147483000;right:16px;bottom:16px;display:flex;align-items:center;gap:8px;height:36px;padding:0 7px 0 10px;border:1px solid #3b3b3b;border-radius:8px;background:#191919;color:#fff;font:500 12px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px #0003}.seltra-attribution img{width:16px;height:16px;object-fit:contain}.seltra-attribution button{display:grid;width:20px;height:20px;place-items:center;border:0;border-radius:5px;background:transparent;color:#aaa;font:18px/1 system-ui;cursor:pointer}.seltra-attribution button:hover{background:#ffffff18;color:#fff}</style>
  <script>(()=>{const key="seltra-attribution-seen";const handoff="__seltra_attribution_dismissed";const badge=document.getElementById("seltra-attribution");if(!badge)return;const params=new URLSearchParams(location.search);if(params.get("__seltra_plan")==="premium"){badge.remove();return}const dismissFromHost=params.get(handoff)==="1";if(dismissFromHost){try{localStorage.setItem(key,"1")}catch{}badge.remove();const cleanUrl=new URL(location.href);cleanUrl.searchParams.delete(handoff);history.replaceState(null,"",cleanUrl);return}const reveal=()=>{try{if(localStorage.getItem(key))return;localStorage.setItem(key,"1")}catch{}badge.hidden=false};const close=()=>{try{localStorage.setItem(key,"1")}catch{}badge.remove();if(window.top!==window)window.parent.postMessage({type:"seltra:attribution-dismissed"},"*")};document.getElementById("seltra-attribution-close")?.addEventListener("click",close);if(window.top===window){if(document.readyState==="complete")reveal();else window.addEventListener("load",reveal,{once:true})}else{window.addEventListener("message",event=>{if(event.source===window.parent&&event.data?.type==="seltra:build-complete")reveal()})}})()</script>
</body>`,
      );
    await fs.writeFile(indexPath, brandedHtml, "utf8");
  } catch {
    // Non-Vite templates without index.html cannot receive the HTML attribution.
  }
}
