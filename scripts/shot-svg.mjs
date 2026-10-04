// Render a run's design.svg to PNG, cropped to the drawn content (layout.json).
// Usage: node scripts/shot-svg.mjs runs/<session>/v<n> [out.png]
// Uses the installed Microsoft Edge through Playwright, so no browser download.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/shot-svg.mjs <run dir> [out.png]");
  process.exit(2);
}
const out = resolve(process.argv[3] ?? join(dir, "design.png"));
const layout = JSON.parse(readFileSync(join(dir, "layout.json"), "utf8"));
const m = 6;
const c = layout.content;
const box = [c.x - m, c.y - m, c.w + 2 * m, c.h + 2 * m];
const svg = readFileSync(join(dir, "design.svg"), "utf8")
  .replace(/^[\s\S]*?<svg/, "<svg")
  .replace(/width="[^"]+" height="[^"]+" viewBox="[^"]+"/, `viewBox="${box.join(" ")}"`);

const width = 1400;
const height = Math.round((width * box[3]) / box[2]);
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width, height } });
await page.setContent(
  `<body style="margin:0;background:#fff">${svg.replace("<svg", `<svg style="display:block;width:${width}px;height:${height}px"`)}</body>`,
);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out} (${width}x${height})`);
