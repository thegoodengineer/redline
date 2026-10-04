// Acceptance: kicad-cli is the judge. These tests run the real kicad-cli.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { draft } from "../lib/engine";
import { runErc } from "../lib/kicad/cli";
import { RUNS_DIR, runDraft, symbolLibrary } from "../lib/runs";

const load = (name: string) => JSON.parse(readFileSync(`examples/${name}.intent.json`, "utf8"));

describe("acceptance", () => {
  for (const name of ["reg-3v3", "led-button", "mic5317-3v3", "ne555-blinker", "atmega328p-minimal"]) {
    it(`${name}: loads in KiCad with 0 ERC errors and 0 warnings, and exports an SVG`, async () => {
      const r = await runDraft(load(name), `test-${name}`, 1);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.erc.violations).toEqual([]);
      const svg = readFileSync(join(r.dir, "design.svg"), "utf8");
      expect(svg).toContain("<svg");
      for (const part of r.intent.parts) expect(svg, `${part.ref} missing from SVG`).toContain(`>${part.ref}<`);
    }, 60_000);
  }

  it("negative control: without PWR_FLAG the same design fails ERC", async () => {
    const r = draft(load("reg-3v3"), symbolLibrary(), { powerFlags: false });
    if (!r.ok) throw new Error("did not validate");
    const dir = join(RUNS_DIR, "test-negative", "v1");
    mkdirSync(dir, { recursive: true });
    const sch = join(dir, "design.kicad_sch");
    writeFileSync(sch, r.sch);
    const { report } = await runErc(sch, join(dir, "erc.json"));
    expect(report.errors).toBeGreaterThan(0);
    expect(report.violations.every((v) => v.type === "power_pin_not_driven")).toBe(true);
    // every reported item maps back to a ref through layout.json
    for (const v of report.violations) for (const i of v.items) expect(r.layout.uuids[i.uuid]).toBeDefined();
  }, 60_000);
});
