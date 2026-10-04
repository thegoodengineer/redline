// The recorded session in demo/. Reading it needs no API key and no KiCad.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readPayload, VersionPayload } from "./payload";

export const DEMO_DIR = join(process.cwd(), "demo");

export function demoVersions(): number[] {
  if (!existsSync(DEMO_DIR)) return [];
  return readdirSync(DEMO_DIR)
    .map((d) => /^v(\d+)$/.exec(d))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}

export function demoPayloads(): VersionPayload[] {
  return demoVersions().map((v) => readPayload(join(DEMO_DIR, `v${v}`)));
}
