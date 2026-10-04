// Design rules checked in code on the intent, shown beside ERC.
import { powerSymbolFor } from "./engine/catalogue";
import { Intent, SymbolLibrary } from "./engine";

export interface RuleResult {
  rule: "reg_input_cap" | "reg_output_cap" | "reg_rails_differ" | "led_series_resistor";
  pass: boolean;
  message: string;
  refs: string[];
}

const CAPS = ["Device:C", "Device:C_Polarized"];
/** Two-terminal parts that current passes straight through. */
const SERIES_PASS = ["Switch:SW_Push", "Device:Polyfuse", "Device:D_Schottky", "Device:LED"];

export function checkRules(intent: Intent, lib: SymbolLibrary): RuleResult[] {
  const netOfPin = new Map<string, string>();
  for (const n of intent.nets) for (const p of n.pins) netOfPin.set(p, n.name);
  const pinsOfNet = new Map(intent.nets.map((n) => [n.name, n.pins]));
  const part = new Map(intent.parts.map((p) => [p.ref, p]));
  const netByName = (ref: string, libId: string, pinNames: string[]) => {
    const pin = lib.get(libId).pins.find((p) => pinNames.includes(p.name));
    return pin ? netOfPin.get(`${ref}.${pin.number}`) : undefined;
  };
  /** Refs of capacitors with one pin on each of the two nets. */
  const capsBetween = (a: string, b: string) =>
    intent.parts
      .filter((p) => CAPS.includes(p.libId))
      .filter((p) => {
        const n = [netOfPin.get(`${p.ref}.1`), netOfPin.get(`${p.ref}.2`)];
        return a !== b && n.includes(a) && n.includes(b);
      })
      .map((p) => p.ref);

  const out: RuleResult[] = [];
  for (const reg of intent.parts.filter((p) => p.libId.startsWith("Regulator_Linear:"))) {
    const vin = netByName(reg.ref, reg.libId, ["VI", "VIN", "IN"]);
    const vout = netByName(reg.ref, reg.libId, ["VO", "VOUT", "OUT"]);
    const gnd = netByName(reg.ref, reg.libId, ["GND"]);
    for (const [rule, net, side] of [
      ["reg_input_cap", vin, "input"],
      ["reg_output_cap", vout, "output"],
    ] as const) {
      const caps = net && gnd ? capsBetween(net, gnd) : [];
      out.push({
        rule,
        pass: caps.length > 0,
        refs: caps.length ? [reg.ref, ...caps] : [reg.ref],
        message: caps.length
          ? `${reg.ref} ${side} (${net}) has ${caps.join(", ")} to ${gnd}`
          : `${reg.ref} has no capacitor from its ${side} (${net ?? "unconnected"}) to ${gnd ?? "ground"}`,
      });
    }
    const differ = !!vin && !!vout && vin !== vout;
    out.push({
      rule: "reg_rails_differ",
      pass: differ,
      refs: [reg.ref],
      message: differ
        ? `${reg.ref} input ${vin} and output ${vout} are different nets`
        : `${reg.ref} input and output are on the same net (${vin ?? "unconnected"})`,
    });
  }

  for (const led of intent.parts.filter((p) => p.libId === "Device:LED")) {
    // Series: walk out of each LED pin through nets that join exactly two pins (so all the
    // current must pass), through switches, fuses and diodes, until a resistor or a branch.
    let resistor: string | undefined;
    for (const start of ["1", "2"]) {
      let ref = led.ref;
      let pin = start;
      for (let hop = 0; hop < 8 && !resistor; hop++) {
        const net = netOfPin.get(`${ref}.${pin}`);
        const pins = net ? pinsOfNet.get(net) ?? [] : [];
        if (!net || powerSymbolFor(net, lib) || pins.length !== 2) break;
        const other = pins.find((p) => p !== `${ref}.${pin}`)!;
        const next = part.get(other.split(".")[0]);
        if (!next) break;
        if (next.libId === "Device:R") resistor = next.ref;
        else if (!SERIES_PASS.includes(next.libId)) break;
        ref = next.ref;
        pin = other.split(".")[1] === "1" ? "2" : "1";
      }
    }
    out.push({
      rule: "led_series_resistor",
      pass: !!resistor,
      refs: resistor ? [led.ref, resistor] : [led.ref],
      message: resistor ? `${led.ref} is in series with ${resistor}` : `${led.ref} has no series resistor`,
    });
  }
  return out;
}
