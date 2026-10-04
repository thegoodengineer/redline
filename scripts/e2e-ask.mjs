// Live check: a question in the chat gets an answer and creates no new version.
// Usage: node scripts/e2e-ask.mjs <session> "question"
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const session = process.argv[2] ?? "mic-live";
const question = process.argv[3] ?? "Why does the regulator need a capacitor on its input and on its output, and why is EN tied to VIN?";
const base = process.env.REDLINE_URL ?? "http://localhost:3000";
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/studio?s=${session}`, { waitUntil: "networkidle" });
await page.waitForSelector(".vstrip button");
const before = await page.locator(".vstrip button").count();
const answersBefore = await page.locator(".entry.answer").count();

await page.fill("textarea", question);
await page.click(".btn.primary");
await page.waitForFunction((n) => document.querySelectorAll(".entry.answer, .entry.failed, .review").length > n, answersBefore, { timeout: 400_000 });
await page.waitForTimeout(800);
if (await page.locator(".entry.failed").count()) console.log("turn failed: " + (await page.locator(".entry.failed").last().innerText()).replace(/\n+/g, " | "));
if (await page.locator(".review").count()) console.log("the model edited the design instead of answering: " + (await page.locator(".review .mono").innerText()));
if ((await page.locator(".entry.answer").count()) > answersBefore) {
  console.log("ANSWER: " + (await page.locator(".entry.answer p").last().innerText()));
  console.log("note:   " + (await page.locator(".entry.answer .facts").last().innerText()));
}
console.log(`versions before ${before}, after ${await page.locator(".vstrip button").count()}`);
await page.screenshot({ path: "shots/ask.png" });
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".vstrip button");
console.log(`after reload: ${await page.locator(".entry.answer").count()} answer(s) still in the chat`);
await browser.close();
