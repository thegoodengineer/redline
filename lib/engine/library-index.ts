// A searchable index of every symbol in the installed KiCad libraries, so the
// model is not limited to a fixed catalogue. Built once by scanning the
// .kicad_sym files line by line (no full parse) and cached on disk.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface IndexEntry {
  id: string;
  lib: string;
  name: string;
  ref: string;
  description: string;
  keywords: string;
  /** Number of units; symbols with more than one are not supported yet. */
  units: number;
  pins: number;
}

const CACHE_VERSION = 2;
const SKIP_LIBS = new Set(["power"]);

function scanLibrary(dir: string, file: string): IndexEntry[] {
  const lib = file.replace(/\.kicad_sym$/, "");
  const lines = readFileSync(join(dir, file), "utf8").split("\n");
  const entries: IndexEntry[] = [];
  const parents = new Map<string, string>();
  let cur: IndexEntry | undefined;
  for (const raw of lines) {
    if (raw.charCodeAt(0) !== 9) continue; // every line we care about starts with a tab
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.charCodeAt(1) !== 9) {
      const m = /^\t\(symbol "(.+)"$/.exec(line);
      if (m) {
        cur = { id: `${lib}:${m[1]}`, lib, name: m[1], ref: "", description: "", keywords: "", units: 1, pins: 0 };
        entries.push(cur);
      }
      continue;
    }
    if (!cur) continue;
    if (line.charCodeAt(2) !== 9) {
      if (line.startsWith('\t\t(property "')) {
        const m = /^\t\t\(property "(Reference|Description|ki_keywords)" "(.*)"$/.exec(line);
        if (m) {
          const value = m[2].replace(/\\"/g, '"');
          if (m[1] === "Reference") cur.ref = value;
          else if (m[1] === "Description") cur.description = value;
          else cur.keywords = value;
        }
      } else if (line.startsWith('\t\t(symbol "')) {
        const m = /_(\d+)_\d+"$/.exec(line);
        if (m) cur.units = Math.max(cur.units, Number(m[1]));
      } else if (line.startsWith('\t\t(extends "')) {
        parents.set(cur.name, line.slice(12, -2));
      }
    } else if (line.startsWith("\t\t\t(pin ")) cur.pins++;
  }
  // Derived symbols take their units and pins from the symbol they extend.
  const byName = new Map(entries.map((e) => [e.name, e]));
  for (const e of entries) {
    let parent = parents.get(e.name);
    for (let hop = 0; parent && hop < 8; hop++) {
      const p = byName.get(parent);
      if (!p) break;
      if (p.pins) {
        e.units = p.units;
        e.pins = p.pins;
        break;
      }
      parent = parents.get(parent);
    }
  }
  return entries;
}

const STOP = new Set(
  "a an and the of on in to with for from by at is it its as or be that this then into out up one two each both pin pins use using via between connect connected circuit board power powered supply input output signal value series led resistor capacitor diode connector button switch small type generic single dual".split(" "),
);
/** Libraries of generic parts, where a plain word like "crystal" or "relay" is a useful search term. */
const GENERIC_LIBS = new Set(["Device", "Connector", "Switch", "Relay", "Motor", "Transistor_BJT", "Transistor_FET", "Diode", "LED", "Sensor", "Display_Character"]);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export class LibraryIndex {
  private constructor(readonly entries: IndexEntry[]) {}

  static load(symbolDir: string, cacheDir = join(process.cwd(), ".cache")): LibraryIndex {
    const files = readdirSync(symbolDir).filter((f) => f.endsWith(".kicad_sym") && !SKIP_LIBS.has(f.replace(/\.kicad_sym$/, "")));
    const stamp = `${CACHE_VERSION}:${symbolDir}:${files.length}:${files.reduce((n, f) => n + statSync(join(symbolDir, f)).size, 0)}`;
    const cache = join(cacheDir, "symbol-index.json");
    if (existsSync(cache)) {
      try {
        const saved = JSON.parse(readFileSync(cache, "utf8"));
        if (saved.stamp === stamp) return new LibraryIndex(saved.entries);
      } catch {}
    }
    const entries = files.flatMap((f) => scanLibrary(symbolDir, f));
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cache, JSON.stringify({ stamp, entries }));
    return new LibraryIndex(entries);
  }

  get(id: string): IndexEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /**
   * Symbols that fit a free-text request. Part numbers in the text ("NE555", "LM7805") match on
   * the symbol name and count most; other words match keywords and descriptions.
   */
  search(textQuery: string, limit = 12): IndexEntry[] {
    const words = [...new Set(textQuery.split(/[^A-Za-z0-9.+-]+/).map((w) => w.replace(/^[.+-]+|[.+-]+$/g, "")).filter((w) => w.length >= 2))];
    // "MIC5317-3.3YM5" also searches for its family "MIC5317".
    const pieces = [...new Set(words.flatMap((w) => [w, ...w.split(/[-.]/)]))];
    // Quantities such as "2-pin", "16MHz" or "10k" are not part numbers.
    const quantity = /^\d+(\.\d+)?-?(pin|pins|v|hz|khz|mhz|ma|a|k|r|m|uf|nf|pf|u|n|p|ohm|w|s|ms)$/i;
    const partNumbers = [...new Set(pieces.filter((w) => /\d/.test(w) && /[A-Za-z]/.test(w) && w.length >= 4 && !quantity.test(w)).map(norm))];
    const plain = pieces.map((w) => w.toLowerCase()).filter((w) => !STOP.has(w) && !/^\d/.test(w) && w.length >= 3);
    if (!partNumbers.length && !plain.length) return [];

    const scored: Array<{ e: IndexEntry; score: number }> = [];
    for (const e of this.entries) {
      if (e.units > 1 || !e.pins) continue;
      const name = norm(e.name);
      let score = 0;
      for (const pn of partNumbers) {
        if (name === pn) score += 60;
        else if (name.startsWith(pn)) score += 40 - Math.min(15, name.length - pn.length);
        else if (pn.startsWith(name) && name.length >= 5) score += 25;
        else if (name.includes(pn)) score += 12;
      }
      if (score) {
        // Among variants of one family, the one that shares the longest prefix with what was asked wins.
        let best = 0;
        for (const pn of partNumbers) {
          let common = 0;
          while (common < pn.length && common < name.length && pn[common] === name[common]) common++;
          best = Math.max(best, common);
        }
        score += best / 4;
      }
      if (plain.length && GENERIC_LIBS.has(e.lib)) {
        // A plain word counts only when it is a word of a generic symbol's name:
        // "crystal" finds Device:Crystal, "npn" finds Device:Q_NPN, "usb" finds Connector:USB_C_...
        const tokens = e.name.toLowerCase().split(/[^a-z0-9]+/);
        let hits = 0;
        for (const w of plain) if (tokens.includes(w)) hits++;
        if (hits) score += hits * 10 + (e.lib === "Device" ? 4 : 0);
      }
      if (score >= 10) scored.push({ e, score });
    }
    scored.sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length || a.e.id.localeCompare(b.e.id));
    return scored.slice(0, limit).map((s) => s.e);
  }

  /** Closest symbols to an id the model made up. */
  suggest(badId: string, limit = 4): IndexEntry[] {
    const name = badId.includes(":") ? badId.slice(badId.indexOf(":") + 1) : badId;
    return this.search(name.replace(/[_-]/g, " ") + " " + name, limit);
  }
}
