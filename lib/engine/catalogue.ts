// What the model may use. A small core catalogue is always in the prompt; any
// other single-unit symbol from the installed KiCad libraries can be used too,
// and the ones that fit the request are looked up and added (library-index.ts).
import { SymbolLibrary } from "./symbols";

/** Always described to the model. */
export const PART_IDS = [
  "Regulator_Linear:AMS1117-3.3",
  "Regulator_Linear:MIC5317-3.3xM5",
  "Device:C",
  "Device:C_Polarized",
  "Device:R",
  "Device:LED",
  "Device:D",
  "Device:D_Schottky",
  "Device:Polyfuse",
  "Device:Q_NPN",
  "Connector_Generic:Conn_01x02",
  "Connector_Generic:Conn_01x03",
  "Connector_Generic:Conn_01x04",
  "Connector_Generic_MountingPin:Conn_01x02_MountingPin",
  "Switch:SW_Push",
] as const;

/** The rails named in the prompt. Any net named after a KiCad power symbol works (see powerSymbolFor). */
export const POWER_NETS: Record<string, string> = {
  GND: "power:GND",
  "+5V": "power:+5V",
  "+3V3": "power:+3V3",
};

export const PWR_FLAG = "power:PWR_FLAG";

/** The power symbol drawn for a net, if KiCad has one with exactly that name (GND, +12V, VCC, VBUS, ...). */
export function powerSymbolFor(net: string | null | undefined, lib: SymbolLibrary): string | undefined {
  if (!net || net === "PWR_FLAG") return undefined;
  const id = `power:${net}`;
  return lib.has(id) && lib.get(id).power ? id : undefined;
}

/** What the library pin names do not say. */
const NOTES: Record<string, string> = {
  "Device:C_Polarized": "pin 1 is the positive terminal",
  "Regulator_Linear:MIC5317-3.3xM5": "MIC5317-3.3YM5, 150 mA LDO; tie EN (3) to VIN to enable; NC (4) goes in noConnect; 1uF ceramic on input and output",
  "Connector_Generic_MountingPin:Conn_01x02_MountingPin": "for SMD connectors such as JST GH SM02B-GHS-TB; the mounting pin MP goes in noConnect unless asked otherwise",
  "Device:LED": "current flows from A (2) to K (1)",
  "Device:D": "current flows from A (2) to K (1)",
  "Device:D_Schottky": "current flows from A (2) to K (1)",
};

export const ALL_IDS = [...PART_IDS, ...Object.values(POWER_NETS), PWR_FLAG];

export function isCataloguePart(libId: string): boolean {
  return (PART_IDS as readonly string[]).includes(libId);
}

/** Why a symbol cannot be used as a part, or null if it can. */
export function unusableReason(libId: string, lib: SymbolLibrary): string | null {
  if (libId.startsWith("power:")) return "power symbols are drawn from net names, never listed as parts";
  let def;
  try {
    if (!lib.has(libId)) return "no such symbol in the installed KiCad libraries";
    def = lib.get(libId);
  } catch (e) {
    return `this symbol cannot be drawn (${e instanceof Error ? e.message : e})`;
  }
  if (def.units > 1) return `it has ${def.units} units; multi-unit symbols are not supported yet, pick a single-unit part`;
  if (!def.pins.length) return "it has no pins";
  return null;
}

/** Ids from the core catalogue that the installed libraries do not contain. */
export function missingIds(lib: SymbolLibrary): string[] {
  return ALL_IDS.filter((id) => !lib.has(id));
}

/** "1=GND:power_in, 2=VO:power_out" */
export function pinTable(libId: string, lib: SymbolLibrary): string {
  return lib
    .get(libId)
    .pins.map((p) => `${p.number}=${p.name && p.name !== "~" ? p.name : "-"}:${p.type}`)
    .join(", ");
}

function line(id: string, lib: SymbolLibrary): string {
  const d = lib.get(id);
  return `- ${id} | ${d.props.Reference} | ${d.props.Description ?? ""} | ${pinTable(id, lib)}${NOTES[id] ? ` | ${NOTES[id]}` : ""}`;
}

/**
 * Catalogue text for the model prompt, generated from the parsed library files.
 * `found` are extra symbols looked up in the installed libraries for this request.
 */
export function catalogueText(lib: SymbolLibrary, found: string[] = []): string {
  const lines: string[] = ["PARTS (libId | ref prefix | description | pins as number=name:type)"];
  for (const id of PART_IDS) lines.push(line(id, lib));
  const extra = found.filter((id) => !isCataloguePart(id) && unusableReason(id, lib) === null);
  if (extra.length) {
    lines.push("");
    lines.push("FOUND IN THE INSTALLED KICAD LIBRARY FOR THIS REQUEST (same format; use the one that fits, ignore the rest)");
    for (const id of extra) lines.push(line(id, lib));
  }
  lines.push("");
  lines.push("POWER NETS (name a net exactly like this and the power symbol is drawn for you; never list these as parts)");
  for (const [net, id] of Object.entries(POWER_NETS)) lines.push(`- ${net} (${id})`);
  lines.push("- also +12V, +9V, +24V, +1V8, VCC, VDD, VBUS, +BATT, GNDA, VSS: any net named after a KiCad power symbol");
  return lines.join("\n");
}
