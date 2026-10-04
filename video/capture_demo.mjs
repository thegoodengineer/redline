// Stage 5: record the product. Each beat replays part of the recorded session in demo/
// through the real studio (?demo=1&film=1), so it runs by itself with no API or KiCad calls.
// The app must be running: npm run dev.
//   node video/capture_demo.mjs            all beats
//   node video/capture_demo.mjs ask fix    only those
// Output: renders/capture_<beat>.webm and assets/demo.json with timestamps used as cut points.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, VIDEO } from "./lib.mjs";

const APP = process.env.REDLINE_URL ?? "http://localhost:3000";
// A 1371x771 page scaled to 1920x1080 is the app at 140% zoom, so text reads on a phone.
const VIEW = { width: 1371, height: 771 };
const SEND = ".composer .btn.primary:not([disabled])";

// Recorded steps in demo/: 1 draft (v1), 2 answer, 3 edit (v2), 4 break (v3), 5 fix (v4).
const BEATS = {
  draft: {
    start: 0,
    async run(page, mark) {
      await page.waitForTimeout(1900); // the sentence types itself
      mark("send");
      await page.click(SEND);
      await page.waitForSelector(".sheet", { timeout: 20000 });
      mark("sheet");
      await page.waitForSelector(".check.pass", { timeout: 20000 });
      await page.waitForTimeout(3200); // checks flip to pass one by one
      mark("checks");
      await page.waitForTimeout(2600);
    },
  },
  ask: {
    start: 1,
    async run(page, mark) {
      await page.waitForTimeout(1700);
      mark("send");
      await page.click(SEND);
      await page.waitForSelector(".entry.answer", { timeout: 20000 });
      mark("answer");
      await page.waitForTimeout(1700);
      mark("short-forms");
      await page.evaluate(() => {
        const box = document.querySelector(".checks");
        const target = document.querySelector(".glossary");
        const to = target.offsetTop - box.offsetTop;
        const from = box.scrollTop;
        const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / 1400);
          box.scrollTop = from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      await page.waitForTimeout(4200);
    },
  },
  edit: {
    start: 2,
    async run(page, mark) {
      await page.waitForTimeout(1700);
      mark("send");
      await page.click(SEND);
      await page.waitForSelector(".review", { timeout: 20000 });
      mark("review");
      await page.waitForTimeout(3600);
      await page.hover(".review .keep");
      await page.waitForTimeout(700);
      mark("keep");
      await page.click(".review .keep");
      await page.waitForTimeout(2200);
    },
  },
  fix: {
    start: 3,
    async run(page, mark) {
      await page.waitForTimeout(900);
      mark("send");
      await page.click(SEND);
      await page.waitForSelector(".check.fail", { timeout: 20000 });
      mark("fail");
      await page.waitForTimeout(1700);
      await page.hover(".check.fail .btn");
      await page.waitForTimeout(600);
      mark("fix");
      await page.click(".check.fail .btn");
      await page.waitForFunction(() => document.querySelectorAll(".vstrip button").length === 4, null, { timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector(".check.wait") && !document.querySelector(".check.fail"), null, { timeout: 20000 });
      mark("pass");
      await page.waitForTimeout(3000);
    },
  },
};

const only = process.argv.slice(2);
mkdirSync(join(VIDEO, "renders"), { recursive: true });
mkdirSync(join(VIDEO, "assets"), { recursive: true });
const logFile = join(VIDEO, "assets", "demo.json");
const log = existsSync(logFile) ? JSON.parse(readFileSync(logFile, "utf8")) : {};
const browser = await launch();

for (const [beat, def] of Object.entries(BEATS)) {
  if (only.length && !only.includes(beat)) continue;
  const tmp = join(VIDEO, "renders", `tmp-${beat}`);
  // Recorded at the page's own size; assemble.py scales it up to 1920x1080 (the same as zooming the app to 140%).
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: tmp, size: VIEW } });
  const t0 = Date.now();
  const page = await context.newPage();
  await page.goto(`${APP}/studio?demo=1&film=1&start=${def.start}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".composer textarea");
  await page.waitForTimeout(400);
  // Everything before this moment is page load; the assembler cuts it.
  const offset = (Date.now() - t0) / 1000;
  const events = [];
  const mark = (label) => events.push({ t: Number(((Date.now() - t0) / 1000 - offset).toFixed(2)), label });
  await def.run(page, mark);
  const length = Number(((Date.now() - t0) / 1000 - offset).toFixed(2));
  const video = page.video();
  await context.close();
  const out = join(VIDEO, "renders", `capture_${beat}.webm`);
  rmSync(out, { force: true });
  renameSync(await video.path(), out);
  rmSync(tmp, { recursive: true, force: true });
  log[beat] = { offset: Number(offset.toFixed(2)), length, events };
  console.log(`${beat.padEnd(6)} ${length.toFixed(1)} s  ${events.map((e) => `${e.label}@${e.t}`).join("  ")}`);
}
await browser.close();
writeFileSync(logFile, JSON.stringify(log, null, 2) + "\n");
