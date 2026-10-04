// Playwright screenshots of the running app at 1440, 1024 and 400 wide.
// Usage: node scripts/shots.mjs <name> <path-with-query> [click=<selector> | hover=<selector> | type=<text> | wait=<ms>]...
//   e.g. node scripts/shots.mjs studio-v2 "/studio?s=live"
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [name, path, ...steps] = process.argv.slice(2);
if (!name || !path) {
  console.error("usage: node scripts/shots.mjs <name> <path> [steps]");
  process.exit(2);
}
const base = process.env.REDLINE_URL ?? "http://localhost:3000";
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
for (const [w, h] of [
  [1440, 900],
  [1024, 768],
  [400, 800],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  for (const step of steps) {
    const [verb, ...rest] = step.split("=");
    const sel = rest.join("=");
    if (verb === "click") await page.click(sel);
    else if (verb === "hover") await page.hover(sel);
    else if (verb === "type") await page.fill("textarea", sel);
    else if (verb === "wait") await page.waitForTimeout(Number(sel));
    await page.waitForTimeout(400);
  }
  const file = `shots/${name}-${w}.png`;
  await page.screenshot({ path: file });
  console.log(`wrote ${file}`);
  await page.close();
}
await browser.close();
