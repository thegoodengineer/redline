// Stage 4: record every HTML scene for its narration length + 1.0 + 0.6 s.
//   node video/render_all.mjs          all scenes
//   node video/render_all.mjs 2 9      only rows 2 and 9
import { join } from "node:path";
import { launch, rows, seconds, serve, VIDEO } from "./lib.mjs";
import { renderScene } from "./render_scene.mjs";

const only = process.argv.slice(2).map(Number);
const server = await serve();
const browser = await launch();
for (const r of rows()) {
  if (!r.html || (only.length && !only.includes(r.n))) continue;
  const secs = seconds(join(VIDEO, "vo", `${r.id}.wav`)) + 1.0 + 0.6;
  const out = join(VIDEO, "renders", `s${r.id}.webm`);
  const offset = await renderScene(r.html, secs, out, server.url, browser);
  console.log(`s${r.id}  ${r.html.padEnd(8)} ${secs.toFixed(1)} s  (lead-in ${offset.toFixed(2)} s)`);
}
await browser.close();
server.close();
