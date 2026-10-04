// Live check of the edit loop in the studio: ask for a change, see the review bar,
// click a part to mention it, then undo. Dev server must be running.
// Usage: node scripts/e2e-edit.mjs <session>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const session = process.argv[2] ?? "any-7805";
const base = process.env.REDLINE_URL ?? "http://localhost:3000";
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/studio?s=${session}`, { waitUntil: "networkidle" });
await page.waitForSelector(".vstrip button");
const before = await page.locator(".vstrip button").count();
console.log(`versions before: ${before}`);

// click a part on the sheet: its ref lands in the chat box
await page.locator(".sheet .hit").first().click({ force: true });
console.log(`after clicking a part, chat box holds: "${await page.inputValue("textarea")}"`);

await page.fill("textarea", "Change the output capacitor to 47uF and add a second LED with its own resistor on the 12 V input rail.");
await page.click(".btn.primary");
await page.waitForSelector(".review, .entry.failed", { timeout: 300_000 });
if (await page.locator(".entry.failed").count()) {
  console.log("turn failed: " + (await page.locator(".entry.failed").last().innerText()).replace(/\n+/g, " | "));
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(2500);
console.log(`review bar: ${await page.locator(".review .mono").innerText()}`);
console.log(`chat: ${(await page.locator(".entry.result").last().innerText()).replace(/\n+/g, " | ")}`);
for (const c of await page.locator(".check").allInnerTexts()) console.log("  check: " + c.replace(/\s+/g, " "));
await page.screenshot({ path: "shots/edit-review.png" });

await page.click(".review .btn:has-text('Undo')");
await page.waitForTimeout(1200);
console.log(`after Undo: versions shown ${await page.locator(".vstrip button").count()}, current ${await page.locator('.vstrip button[aria-current="true"]').innerText()}`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".vstrip button");
console.log(`after reload: versions shown ${await page.locator(".vstrip button").count()}`);
await browser.close();
