// kicad-cli wrapper. Uses execFile so paths with spaces need no quoting.
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface KicadPaths {
  cli: string;
  symbolDir: string;
}

let cached: KicadPaths | undefined;

function findCli(): string {
  const override = process.env.KICAD_CLI;
  if (override) {
    if (!existsSync(override)) throw new Error(`KICAD_CLI points at a missing file: ${override}`);
    return override;
  }
  const candidates: string[] = [];
  for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "C:\\Program Files"]) {
    const root = base && join(base, "KiCad");
    if (!root || !existsSync(root)) continue;
    const versions = readdirSync(root).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    for (const v of versions) candidates.push(join(root, v, "bin", "kicad-cli.exe"));
  }
  candidates.push(
    "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
    "/usr/bin/kicad-cli",
    "/usr/local/bin/kicad-cli",
  );
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) throw new Error("kicad-cli not found. Install KiCad or set KICAD_CLI to the full path of kicad-cli.");
  return hit;
}

function findSymbolDir(cli: string): string {
  const override = process.env.KICAD_SYMBOL_DIR;
  if (override) {
    if (!existsSync(override)) throw new Error(`KICAD_SYMBOL_DIR points at a missing folder: ${override}`);
    return override;
  }
  const candidates = [
    join(dirname(dirname(cli)), "share", "kicad", "symbols"),
    join(dirname(dirname(cli)), "SharedSupport", "symbols"),
    "/usr/share/kicad/symbols",
  ];
  const hit = candidates.find((c) => existsSync(join(c, "Device.kicad_sym")));
  if (!hit) throw new Error("KiCad symbol folder not found. Set KICAD_SYMBOL_DIR to the folder holding Device.kicad_sym.");
  return hit;
}

export function locateKicad(): KicadPaths {
  if (!cached) {
    const cli = findCli();
    cached = { cli, symbolDir: findSymbolDir(cli) };
  }
  return cached;
}

export interface CliResult {
  args: string[];
  stdout: string;
  stderr: string;
  code: number;
}

export function runCli(args: string[]): Promise<CliResult> {
  const { cli } = locateKicad();
  return new Promise((resolve) => {
    execFile(cli, args, { windowsHide: true, timeout: 60_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ args, stdout: String(stdout), stderr: String(stderr) || (err && code === 1 ? err.message : ""), code });
    });
  });
}

export interface ErcItem {
  description: string;
  uuid: string;
  pos?: { x: number; y: number };
}
export interface ErcViolation {
  type: string;
  severity: "error" | "warning" | string;
  description: string;
  items: ErcItem[];
}
export interface ErcReport {
  kicadVersion: string;
  errors: number;
  warnings: number;
  violations: ErcViolation[];
}

/** kicad-cli sch erc --format json. Throws with kicad-cli's own message if the file does not load. */
export async function runErc(schPath: string, outJson: string): Promise<{ report: ErcReport; cli: CliResult }> {
  const cli = await runCli(["sch", "erc", "--format", "json", "--severity-all", "-o", outJson, schPath]);
  if (cli.code !== 0 || !existsSync(outJson)) {
    throw new Error(`kicad-cli sch erc failed (exit ${cli.code}): ${(cli.stderr || cli.stdout).trim()}`);
  }
  const raw = JSON.parse(readFileSync(outJson, "utf8")) as {
    kicad_version?: string;
    sheets?: Array<{ violations?: ErcViolation[] }>;
  };
  const violations = (raw.sheets ?? []).flatMap((s) => s.violations ?? []);
  return {
    cli,
    report: {
      kicadVersion: raw.kicad_version ?? "",
      errors: violations.filter((v) => v.severity === "error").length,
      warnings: violations.filter((v) => v.severity === "warning").length,
      violations,
    },
  };
}

/** Launch the KiCad schematic editor on a file and return at once. */
export function openInEditor(schPath: string): string {
  const { cli } = locateKicad();
  const editor =
    process.platform === "win32" ? join(dirname(cli), "eeschema.exe") : join(dirname(cli), "eeschema");
  if (!existsSync(editor)) throw new Error(`KiCad schematic editor not found at ${editor}`);
  const child = spawn(editor, [schPath], { detached: true, stdio: "ignore" });
  child.unref();
  return editor;
}

/** kicad-cli sch export svg, without drawing sheet or background. Returns the path of the SVG. */
export async function exportSvg(schPath: string, outDir: string): Promise<{ svgPath: string; cli: CliResult }> {
  const cli = await runCli(["sch", "export", "svg", "-e", "-n", "-o", outDir, schPath]);
  const svgPath = join(outDir, basename(schPath).replace(/\.kicad_sch$/, ".svg"));
  if (cli.code !== 0 || !existsSync(svgPath)) {
    throw new Error(`kicad-cli sch export svg failed (exit ${cli.code}): ${(cli.stderr || cli.stdout).trim()}`);
  }
  return { svgPath, cli };
}
