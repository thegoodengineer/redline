// What the studio needs to show one version. Read from runs/ on the server,
// or from demo/ in replay mode; the shape is the same.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Intent, Layout } from "./engine";
import type { VersionMeta } from "./session";

export interface VersionPayload {
  meta: VersionMeta;
  intent: Intent;
  layout: Layout;
  /** KiCad's SVG with the outer <svg> element removed; coordinates are sheet millimetres. */
  svg: string;
}

export function svgInner(svg: string): string {
  const m = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg);
  return (m ? m[1] : "").replace(/<title>[\s\S]*?<\/title>/, "").replace(/<desc>[\s\S]*?<\/desc>/, "");
}

export function readPayload(dir: string): VersionPayload {
  const json = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  return {
    meta: json("meta.json"),
    intent: json("intent.json"),
    layout: json("layout.json"),
    svg: svgInner(readFileSync(join(dir, "design.svg"), "utf8")),
  };
}
