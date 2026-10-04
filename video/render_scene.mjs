// Stage 4: record one motion-graphics scene.
//   node video/render_scene.mjs <scene> <seconds> <out.webm>
// The scene's animations start when the page is ready; the time before that is
// written to <out>.json as "offset" so the assembler can cut it off.
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serve } from "./lib.mjs";

export async function renderScene(scene, secs, out, base, browser) {
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${dirname(out)}/tmp-${scene}`;
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } } });
  const t0 = Date.now();
  const page = await context.newPage();
  await page.goto(`${base}/video/scenes/scenes.html?scene=${scene}&hold=1`);
  await page.evaluate(() => window.sceneReady);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const offset = (Date.now() - t0) / 1000;
  await page.evaluate(() => document.body.classList.add("go"));
  await page.waitForTimeout(secs * 1000);
  const video = page.video();
  await context.close();
  rmSync(out, { force: true });
  renameSync(await video.path(), out);
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(`${out}.json`, JSON.stringify({ scene, seconds: secs, offset }));
  return offset;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [scene, secs, out] = process.argv.slice(2);
  if (!scene || !secs || !out) {
    console.error("usage: node video/render_scene.mjs <scene> <seconds> <out.webm>");
    process.exit(2);
  }
  const server = await serve();
  const browser = await launch();
  const offset = await renderScene(scene, Number(secs), resolve(out), server.url, browser);
  console.log(`${scene}: ${secs} s, lead-in ${offset.toFixed(2)} s -> ${out}`);
  await browser.close();
  server.close();
}
