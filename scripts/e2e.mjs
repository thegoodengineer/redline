// Real end-to-end pass through the studio with live Gemma calls: draft, break, fix.
// Usage: node scripts/e2e.mjs      (dev server must be running)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.env.REDLINE_URL ?? "http://localhost:3000";
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = async (name) => {
  await page.screenshot({ path: `shots/e2e-${name}.png` });
  console.log(`wrote shots/e2e-${name}.png`);
};
const turnDone = async (version) => {
  const done = `.vstrip button:nth-child(${version})[aria-current="true"]`;
  await page.waitForSelector(`${done}, .entry.failed`, { timeout: 280_000 });
  if (!(await page.$(done))) {
    await shot("failed");
    throw new Error("turn failed: " + (await page.$eval(".entry.failed", (e) => e.innerText)));
  }
  await page.waitForTimeout(2500); // let the checks flip
};
const report = async (label) => {
  const stats = await page.$$eval(".stat", (els) => els.map((e) => e.innerText.replace(/\n/g, " | ")));
  const checks = await page.$$eval(".check", (els) => els.map((e) => e.innerText.replace(/\n/g, " ").replace(/\s+/g, " ")));
  console.log(`\n== ${label} ==  ${page.url()}`);
  for (const s of stats) console.log("  stat:  " + s);
  for (const c of checks) console.log("  check: " + c);
};

await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
await page.click(".examples button:nth-child(3)");
await page.click(".btn.primary");
await page.waitForTimeout(4000);
await shot("1-loading");
await turnDone(1);
await shot("2-v1");
await report("v1 generate");

await page.fill("textarea", "Remove the series resistor and connect the LED straight to the rail.");
await page.click(".btn.primary");
await turnDone(2);
await shot("3-v2-broken");
await report("v2 revise (break it)");

const fixes = await page.$$(".check.fail .btn");
if (fixes.length) {
  await fixes[0].click();
  await page.waitForTimeout(3000);
  await shot("4-fixing");
  await turnDone(3);
  await shot("5-v3-fixed");
  await report("v3 fix this");
} else {
  console.log("\nno failing check to fix in v2");
}

// version strip: go back to v1
await page.click(".vstrip button:nth-child(1)");
await page.waitForTimeout(600);
console.log(`\nback on v1: ${await page.$eval('.vstrip button[aria-current="true"]', (e) => e.innerText)}`);
const download = await page.$eval(".actions a", (a) => a.getAttribute("href"));
const res = await page.request.get(base + download);
const body = await res.text();
console.log(`download ${download}: HTTP ${res.status()}, ${body.length} bytes, starts "${body.slice(0, 10)}"`);
await browser.close();
