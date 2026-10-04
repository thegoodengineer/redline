// Shared by the film scripts: the script table, audio lengths, a static file server and the browser.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const VIDEO = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(VIDEO);

/** Rows of video/script.md: | 01 | scene: title | on screen | narration | seconds | */
export function rows() {
  return readFileSync(join(VIDEO, "script.md"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^\|\s*\d+\s*\|/.test(l))
    .map((l) => {
      const [n, scene, , narration] = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const capture = /^CAPTURE\s+(\S+)/.exec(scene);
      const html = /^scene:\s*(\S+)/.exec(scene);
      return { n: Number(n), id: n.padStart(2, "0"), capture: capture?.[1], html: html?.[1], narration };
    });
}

export function seconds(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }));
}

const TYPES = { ".html": "text/html", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain", ".kicad_sch": "text/plain", ".svg": "image/svg+xml" };

/** Serves the repository over http so the scenes can load their fonts and fetch real data files. */
export function serve(port = 8877) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[\\/]+/, "");
    const file = join(ROOT, path);
    const allowed = ["video", "demo", "data"].some((d) => path === d || path.startsWith(d + "\\") || path.startsWith(d + "/"));
    if (!allowed || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ url: `http://localhost:${port}`, close: () => server.close() })));
}

/** The installed Edge, with software GL so recordings look the same on any machine. */
export function launch() {
  return chromium.launch({
    channel: "msedge",
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
}
