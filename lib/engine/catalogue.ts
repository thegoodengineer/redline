// The parts the model may use, and the net names that become power symbols.
import { SymbolLibrary } from "./symbols";

export const PART_IDS = [
  "Regulator_Linear:AMS1117-3.3",
  "Regulator_Linear:MIC5317-3.3xM5",
  "Device:C",
  "Device:C_Polarized",
  "Device:R",
  "Device:LED",
  "Device:D_Schottky",
  "Device:Polyfuse",
  "Connector_Generic:Conn_01x02",
  "Connector_Generic_MountingPin:Conn_01x02_MountingPin",
  "Switch:SW_Push",
] as const;

/** Net name -> power symbol drawn on every pin of that net. */
export const POWER_NETS: Record<string, string> = {
  GND: "power:GND",
  "+5V": "power:+5V",
  "+3V3": "power:+3V3",
};

export const PWR_FLAG = "power:PWR_FLAG";

/** What the library pin names do not say. */
const NOTES: Record<string, string> = {
  "Device:C_Polarized": "pin 1 is the positive terminal",
  "Regulator_Linear:MIC5317-3.3xM5": "MIC5317-3.3YM5, 150 mA LDO; tie EN (3) to VIN to enable; NC (4) goes in noConnect; 1uF ceramic on input and output",
  "Connector_Generic_MountingPin:Conn_01x02_MountingPin": "for SMD connectors such as JST GH SM02B-GHS-TB; the mounting pin MP goes in noConnect unless asked otherwise",
  "Device:LED": "current flows from A (2) to K (1)",
  "Device:D_Schottky": "current flows from A (2) to K (1)",
};

export const ALL_IDS = [...PART_IDS, ...Object.values(POWER_NETS), PWR_FLAG];

export function isCataloguePart(libId: string): boolean {
  return (PART_IDS as readonly string[]).includes(libId);
}

/** Ids from the catalogue that the installed libraries do not contain. */
export function missingIds(lib: SymbolLibrary): string[] {
  return ALL_IDS.filter((id) => !lib.has(id));
}

/** Catalogue text for the model prompt, generated from the parsed library files. */
export function catalogueText(lib: SymbolLibrary): string {
  const lines: string[] = ["PARTS (libId | ref prefix | description | pins as number=name:type)"];
  for (const id of PART_IDS) {
    const d = lib.get(id);
    const pins = d.pins.map((p) => `${p.number}=${p.name && p.name !== "~" ? p.name : "-"}:${p.type}`).join(", ");
    lines.push(`- ${id} | ${d.props.Reference} | ${d.props.Description ?? ""} | ${pins}${NOTES[id] ? ` | ${NOTES[id]}` : ""}`);
  }
  lines.push("");
  lines.push("POWER NETS (name a net exactly like this and the power symbol is drawn for you; never list these as parts)");
  for (const [net, id] of Object.entries(POWER_NETS)) lines.push(`- ${net} (${id})`);
  return lines.join("\n");
}
