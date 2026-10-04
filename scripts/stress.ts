// Hard prompts through the live model, to find where Redline breaks.
// Usage: npx tsx scripts/stress.ts
import { GemmaProvider } from "../lib/model/provider";
import { generate } from "../lib/session";

const PROMPTS = [
  "ESP32-WROOM-32 board: USB-C power input at 5 V, an AMS1117-3.3 regulator with input and output capacitors, a 10k pull-up and a reset button on EN, a BOOT button on IO0, a status LED with resistor on IO2, and a 4-pin UART header carrying 3V3, GND, TX and RX.",
  "Dual-rail supply: 12 V in on a 2-pin connector through a polyfuse and a reverse-protection Schottky diode, an LM7805 making 5 V, an AMS1117-3.3 fed from the 5 V rail, input and output capacitors on both regulators, a power LED with resistor on each output rail, and a 3-pin output header carrying 5V, 3V3 and GND.",
  "ATmega328P-A board: 16 MHz crystal with two 22pF load capacitors, 10k reset pull-up and a reset button, 100nF decoupling capacitors on VCC and AVCC, a 6-pin ISP header carrying MISO, VCC, SCK, MOSI, RESET and GND, a 4-pin UART header carrying VCC, GND, TX and RX, and an LED with resistor on PB5. Power is 5 V from a 2-pin connector.",
];

async function main() {
  const provider = new GemmaProvider();
  const stamp = Date.now().toString(36);
  for (const [i, prompt] of PROMPTS.entries()) {
    const session = `stress-${stamp}-${i + 1}`;
    console.log(`\n[${i + 1}] ${prompt.slice(0, 90)}…  (${session})`);
    try {
      const t = await generate(session, prompt, provider);
      if (!t.ok) {
        console.log(`    REJECTED after ${t.attempts} attempts, ${t.usage.totalTokens} tokens, ${(t.ms / 1000).toFixed(0)} s`);
        for (const f of t.findings.slice(0, 12)) console.log(`      ${f.id}. [${f.code}] ${f.message.slice(0, 220)}`);
        continue;
      }
      const m = t.meta;
      console.log(`    drafted: ${t.intent.parts.length} parts, ${t.intent.nets.length} nets, ${t.layout.wiring}, ${m.attempts} attempt(s), ${m.usage.totalTokens} tokens, ${(m.ms / 1000).toFixed(0)} s`);
      console.log(`    parts: ${t.intent.parts.map((p) => `${p.ref}=${p.libId.split(":")[1]}`).join(" ")}`);
      console.log(`    ERC: ${m.erc.errors} errors, ${m.erc.warnings} warnings`);
      for (const c of m.checks.filter((c) => c.status !== "pass")) console.log(`      ${c.status.toUpperCase()} ${c.message.slice(0, 200)}`);
    } catch (e) {
      console.log(`    ERROR: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

main();
