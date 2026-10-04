// Plain-language meanings of the short forms on a sheet: part letters, rail
// names, pin names and value suffixes. Built in code from a fixed dictionary
// (no model call), and only for the terms this schematic actually uses.
import type { Intent, SymbolLibrary } from "./engine";

export interface GlossaryEntry {
  group: "Parts" | "Rails" | "Pins" | "Values" | "Marks";
  term: string;
  meaning: string;
}

const REF_PREFIX: Record<string, string> = {
  U: "integrated circuit (a chip, such as a regulator or microcontroller)",
  R: "resistor",
  C: "capacitor",
  D: "diode or LED",
  J: "connector",
  SW: "switch or push button",
  F: "fuse",
  Q: "transistor",
  Y: "crystal",
  L: "inductor",
  K: "relay",
  RV: "potentiometer (variable resistor)",
  BT: "battery",
  TP: "test point",
  LS: "speaker or buzzer",
};

const RAILS: Record<string, string> = {
  GND: "ground, the 0 V reference every voltage is measured against",
  GNDA: "analog ground",
  VCC: "positive supply voltage",
  VDD: "positive supply voltage",
  VSS: "negative supply, usually ground",
  VBUS: "the 5 V line of a USB connection",
  "+BATT": "battery positive",
};

/** Pin-name patterns, tried in order. `term` is what is shown when the pattern covers many names. */
const PINS: Array<{ test: RegExp; term?: string; meaning: string }> = [
  { test: /^(VIN|VI|IN)$/, meaning: "voltage input" },
  { test: /^(VOUT|VO|OUT)$/, meaning: "output" },
  { test: /^EN$/, meaning: "enable: the part runs when this pin is driven high" },
  { test: /^NC$/, meaning: "no connection: this pin is not used inside the part" },
  { test: /^ADJ$/, meaning: "adjust: sets the output voltage of an adjustable regulator" },
  { test: /^GND$/, meaning: "ground pin" },
  { test: /^(VCC|VDD)$/, meaning: "positive supply pin" },
  { test: /^AVCC$/, meaning: "supply pin for the analog section" },
  { test: /^AREF$/, meaning: "reference voltage for the analog-to-digital converter" },
  { test: /^(RST|RESET)$/, meaning: "reset; a bar over the name means it is active when low" },
  { test: /^TRIG$/, meaning: "trigger input of the timer" },
  { test: /^THRES$/, meaning: "threshold input of the timer" },
  { test: /^DISCH$/, meaning: "discharge: the timer empties the timing capacitor through this pin" },
  { test: /^CONT$/, meaning: "control voltage of the timer, normally decoupled with a small capacitor" },
  { test: /^K$/, meaning: "cathode, the negative end of a diode or LED" },
  { test: /^A$/, meaning: "anode, the positive end of a diode or LED" },
  { test: /^B$/, meaning: "base of a transistor" },
  { test: /^C$/, meaning: "collector of a transistor" },
  { test: /^E$/, meaning: "emitter of a transistor" },
  { test: /^G$/, meaning: "gate of a MOSFET" },
  { test: /^S$/, meaning: "source of a MOSFET" },
  { test: /^(MP|MountPin)$/, term: "MP", meaning: "mounting pin: holds the connector to the board, carries no signal" },
  { test: /^XTAL\d?$/, term: "XTAL1, XTAL2", meaning: "crystal pins: the clock crystal connects here" },
  { test: /^MISO$/, meaning: "SPI data, from the peripheral to the controller" },
  { test: /^MOSI$/, meaning: "SPI data, from the controller to the peripheral" },
  { test: /^SCK$/, meaning: "SPI clock" },
  { test: /^(SS|CS)$/, meaning: "chip select: picks which SPI device is spoken to" },
  { test: /^(TX|TXD\d?)$/, term: "TX / TXD", meaning: "serial data transmitted by this part" },
  { test: /^(RX|RXD\d?)$/, term: "RX / RXD", meaning: "serial data received by this part" },
  { test: /^SDA$/, meaning: "I2C data line" },
  { test: /^SCL$/, meaning: "I2C clock line" },
  { test: /^(IO|GPIO)\d+$/, term: "IO0, IO2, …", meaning: "general-purpose input/output pin, numbered as on the chip" },
  { test: /^P[A-Z]\d+$/, term: "PB5, PC0, …", meaning: "port pin: port letter and bit number of a microcontroller pin" },
  { test: /^ADC\d+$/, term: "ADC6, ADC7", meaning: "analog-to-digital converter input" },
  { test: /^(SENSOR_VP|SENSOR_VN)$/, term: "SENSOR_VP, SENSOR_VN", meaning: "low-noise analog inputs of the module" },
];

const VALUES: Array<{ test: RegExp; term: string; meaning: string }> = [
  { test: /^\d+(\.\d+)?\s*(u|uF|µF)$/i, term: "u, uF", meaning: "microfarad, a millionth of a farad (capacitor value)" },
  { test: /^\d+(\.\d+)?\s*(n|nF)$/i, term: "n, nF", meaning: "nanofarad, a thousandth of a microfarad (capacitor value)" },
  { test: /^\d+(\.\d+)?\s*(p|pF)$/i, term: "p, pF", meaning: "picofarad, a thousandth of a nanofarad (capacitor value)" },
  { test: /^\d+(\.\d+)?\s*k$/i, term: "k", meaning: "kilo-ohm, a thousand ohms (resistor value)" },
  { test: /^\d+(\.\d+)?\s*M$/, term: "M", meaning: "mega-ohm, a million ohms (resistor value)" },
  { test: /^\d+(\.\d+)?\s*R$/, term: "R", meaning: "ohms (resistor value)" },
  { test: /^\d+(\.\d+)?\s*mA$/, term: "mA", meaning: "milliamp, a thousandth of an amp" },
  { test: /^\d+(\.\d+)?\s*MHz$/i, term: "MHz", meaning: "megahertz, a million cycles per second" },
];

function railMeaning(name: string): string | undefined {
  if (RAILS[name]) return RAILS[name];
  const m = /^([+-])(\d+)V(\d+)?$/.exec(name);
  if (!m) return undefined;
  const volts = `${m[1] === "-" ? "−" : ""}${m[2]}${m[3] ? "." + m[3] : ""} V`;
  return `${volts} supply rail${m[3] ? " (the V stands where the decimal point is)" : ""}`;
}

export function glossary(intent: Intent, lib: SymbolLibrary, hasPowerFlag = true): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  const add = (group: GlossaryEntry["group"], term: string, meaning: string) => {
    if (seen.has(`${group}:${term}`)) return;
    seen.add(`${group}:${term}`);
    out.push({ group, term, meaning });
  };

  for (const part of intent.parts) {
    const prefix = part.ref.replace(/\d+$/, "");
    if (REF_PREFIX[prefix]) add("Parts", `${prefix}1, ${prefix}2, …`, REF_PREFIX[prefix]);
  }
  for (const net of intent.nets) {
    const meaning = railMeaning(net.name);
    if (meaning) add("Rails", net.name, meaning);
  }
  for (const part of intent.parts) {
    for (const pin of lib.get(part.libId).pins) {
      // "XTAL1/PB6" names two functions; "~{RESET}" is KiCad's way to draw a bar over RESET.
      for (const name of pin.name.split("/").map((n) => n.replace(/~\{([^}]*)\}/g, "$1").trim())) {
        const hit = PINS.find((p) => p.test.test(name));
        if (hit) add("Pins", hit.term ?? name, hit.meaning);
      }
    }
    const value = VALUES.find((v) => v.test.test(part.value));
    if (value) add("Values", value.term, value.meaning);
  }
  if (intent.noConnect.length) add("Marks", "×", "a pin deliberately left unconnected");
  if (hasPowerFlag) add("Marks", "PWR_FLAG", "tells KiCad's rule check that a net is powered from outside the sheet; it is not a real part");
  return out;
}
