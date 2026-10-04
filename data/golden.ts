// Golden answers for data/prompts.json, written by hand. GOLDEN[i] lists the
// acceptable circuits for prompt i; a draft passes if it contains any one of them.
//
// Pin numbers are from the KiCad symbols: LED and Schottky 1 = cathode, 2 = anode;
// AMS1117 1 = GND, 2 = VO, 3 = VI. Rails that the prompt names must be called
// +5V, +3V3 or GND, which is how the matcher can judge polarity.
import type { Golden, GoldenNet, GoldenPart } from "../lib/golden";

const CONN = ["Connector_Generic:Conn_01x02", "Connector_Generic_MountingPin:Conn_01x02_MountingPin"];
const CAP = ["Device:C", "Device:C_Polarized"];
const R = ["Device:R"];
const LED = ["Device:LED"];
const REG = ["Regulator_Linear:AMS1117-3.3"];

/** A two-terminal part in a series chain: current enters at `a` and leaves at `b`. */
interface Element {
  part: GoldenPart;
  a: string;
  b: string;
}
const res = (id: string, value?: RegExp): Element => ({ part: { id, lib: R, value }, a: "1", b: "2" });
const led = (id: string): Element => ({ part: { id, lib: LED }, a: "2", b: "1" }); // anode in, cathode out
const diode = (id: string): Element => ({ part: { id, lib: ["Device:D_Schottky"] }, a: "2", b: "1" });
const fuse = (id: string): Element => ({ part: { id, lib: ["Device:Polyfuse"] }, a: "1", b: "2" });
const button = (id: string): Element => ({ part: { id, lib: ["Switch:SW_Push"] }, a: "1", b: "2" });

class Circuit {
  parts: GoldenPart[] = [];
  private nets = new Map<string, GoldenNet>();
  private chains = 0;
  part(id: string, lib: string[], value?: RegExp, sample?: string) {
    this.parts.push({ id, lib, value, sample });
    return this;
  }
  /** Put pins on a net. Keys that are rail names (+5V, +3V3, GND) become required net names. */
  join(key: string, ...pins: string[]) {
    const net = this.nets.get(key) ?? { name: /^(\+5V|\+3V3|GND)$/.test(key) ? key : undefined, pins: [] };
    net.pins.push(...pins);
    this.nets.set(key, net);
    return this;
  }
  /** Elements in series from one net to another, in the order given. */
  series(from: string, to: string, elements: Element[]) {
    const chain = ++this.chains; // every chain gets its own intermediate nets
    elements.forEach((e, i) => {
      this.parts.push(e.part);
      this.join(i === 0 ? from : `chain${chain}#${i}`, `${e.part.id}.${e.a}`);
      this.join(i === elements.length - 1 ? to : `chain${chain}#${i + 1}`, `${e.part.id}.${e.b}`);
    });
    return this;
  }
  done(): Golden {
    return { parts: this.parts, nets: [...this.nets.values()] };
  }
}

function permutations<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}
/** An LED and its resistor between two nets; the resistor may sit on either side. */
const ledOrders = (n: number) => permutations([res(`R${n}`), led(`D${n}`)]);

/** AMS1117 with its input and output capacitors. */
const regulator = (input: string) =>
  new Circuit()
    .part("U1", REG)
    .part("CIN", CAP)
    .part("COUT", CAP)
    .join(input, "U1.3", "CIN.1")
    .join("+3V3", "U1.2", "COUT.1")
    .join("GND", "U1.1", "CIN.2", "COUT.2");

export const GOLDEN: Golden[][] = [
  // 1. 5 V in, AMS1117-3.3 with input and output capacitors, 3.3 V out.
  [regulator("+5V").part("JIN", CONN).part("JOUT", CONN).join("+5V", "JIN.1").join("+3V3", "JOUT.1").join("GND", "JIN.2", "JOUT.2").done()],

  // 2. Power LED with a series resistor from 5 V on a connector.
  ledOrders(1).map((chain) => new Circuit().part("J1", CONN).join("+5V", "J1.1").join("GND", "J1.2").series("+5V", "GND", chain).done()),

  // 3. Push button with a 10k pull-down, powered from 3.3 V, signal and ground on a connector.
  [
    new Circuit()
      .part("SW1", ["Switch:SW_Push"])
      .part("R1", R, /^10\s*k/i, "10k")
      .part("J1", CONN)
      .join("+3V3", "SW1.1")
      .join("SIG", "SW1.2", "R1.1", "J1.1")
      .join("GND", "R1.2", "J1.2")
      .done(),
  ],

  // 4. 5 V in, polyfuse and Schottky in series (either order, anode towards the input), out to a connector.
  permutations([fuse("F1"), diode("D1")]).map((chain) =>
    new Circuit().part("JIN", CONN).part("JOUT", CONN).join("IN", "JIN.1").join("OUT", "JOUT.1").join("GND", "JIN.2", "JOUT.2").series("IN", "OUT", chain).done(),
  ),

  // 5. AMS1117 board, power in on a connector, power LED on the 3.3 V output.
  ledOrders(1).map((chain) => regulator("+5V").part("JIN", CONN).join("+5V", "JIN.1").join("GND", "JIN.2").series("+3V3", "GND", chain).done()),

  // 6. 5 V in, polyfuse, AMS1117, one LED on the 5 V rail (before or after the fuse) and one on 3.3 V.
  ["RAW", "FUSED"].flatMap((ledRail) =>
    ledOrders(1).flatMap((five) =>
      ledOrders(2).map((three) =>
        regulator("FUSED")
          .part("JIN", CONN)
          .join("RAW", "JIN.1")
          .join("GND", "JIN.2")
          .series("RAW", "FUSED", [fuse("F1")])
          .series(ledRail, "GND", five)
          .series("+3V3", "GND", three)
          .done(),
      ),
    ),
  ),

  // 7. Two LEDs on 5 V from a connector, each with its own series resistor.
  ledOrders(1).flatMap((first) =>
    ledOrders(2).map((second) => new Circuit().part("J1", CONN).join("+5V", "J1.1").join("GND", "J1.2").series("+5V", "GND", first).series("+5V", "GND", second).done()),
  ),

  // 8. RC low-pass: series resistor, capacitor to ground, connectors in and out.
  [
    new Circuit()
      .part("JIN", CONN)
      .part("JOUT", CONN)
      .part("R1", R)
      .part("C1", CAP)
      .join("IN", "JIN.1", "R1.1")
      .join("OUT", "R1.2", "C1.1", "JOUT.1")
      .join("GND", "JIN.2", "C1.2", "JOUT.2")
      .done(),
  ],

  // 9. Divider from 5 V, capacitor across the lower resistor, divided voltage on a connector.
  [
    new Circuit()
      .part("RTOP", R)
      .part("RBOT", R)
      .part("C1", CAP)
      .part("J1", CONN)
      .join("+5V", "RTOP.1")
      .join("MID", "RTOP.2", "RBOT.1", "C1.1", "J1.1")
      .join("GND", "RBOT.2", "C1.2", "J1.2")
      .done(),
  ],

  // 10. Button lights an LED: 5 V, then button, resistor and LED in series (any order), to ground.
  permutations([button("SW1"), res("R1"), led("D1")]).map((chain) => new Circuit().part("J1", CONN).join("+5V", "J1.1").join("GND", "J1.2").series("+5V", "GND", chain).done()),
];
