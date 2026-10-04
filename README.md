# Redline

Describe a circuit, get a real KiCad schematic, see ERC findings marked on the sheet, and fix them by chat.

![The Redline studio](public/studio.png)

## The problem

Language models are bad at drawing schematics. Asked for a `.kicad_sch` file they invent coordinates, pin positions
and file syntax, and the result either does not open or is wired wrong. A hardware engineer cannot trust it and
cannot easily see what is wrong with it.

## How it works

The model writes a tiny intent. Code draws everything. KiCad is the judge.

1. **Intent.** Gemma 4 returns a small JSON object: parts (`ref`, `libId`, `value`, `group`), nets (lists of pins
   such as `U1.3`), and no-connect pins. It contains no coordinates. It is checked with zod and by a validator
   (unknown symbol, unknown pin, duplicate ref, pin in two nets, pin in no net). If validation fails the model gets
   the numbered findings and one retry; nothing is written on failure.
2. **Engine** (`lib/engine/`, deterministic, no model, unit tested).
   - `sexp`: own s-expression parser and writer.
   - `symbols`: reads symbol definitions and pin positions from the installed `.kicad_sym` libraries and resolves
     `extends` symbols.
   - `place`: one column per group, parts stacked inside a column, everything on the 1.27 mm grid.
   - `connect`: no wire routing. Each pin gets a short stub and a net label; nets named `GND`, `+5V` and `+3V3`
     get the matching power symbol. Undriven power nets get one `PWR_FLAG`.
   - `emit`: writes the `.kicad_sch` with embedded library symbols and stable UUIDs, plus `layout.json` with each
     part's bounding box in sheet millimetres. The same intent always gives the same bytes.
3. **KiCad.** `kicad-cli sch erc --format json` checks the file and `kicad-cli sch export svg` draws it. The studio
   shows KiCad's own SVG. ERC findings are mapped back to parts through the UUIDs in `layout.json`.
4. **Design rules** (`lib/rules.ts`, code): a regulator has a capacitor from input to ground and from output to
   ground; every LED has a series resistor; a regulator's input and output are different nets.
5. **Revise.** A chat message or a finding plus the current intent goes back to the model, which returns a full
   revised intent. The difference between the old and new intent is computed in code and shown on the sheet: added
   parts green, changed parts amber, removed parts listed. ERC and design-rule findings are shown to you, never
   fixed silently.

The file format was not written from memory: the emitter follows demo schematics that ship with KiCad, re-saved
by the installed KiCad 10 with `kicad-cli sch upgrade`, and every change was checked by loading the output in
`kicad-cli`. Those reference copies are not in this repository because they carry their authors' licences.

### Catalogue

`Regulator_Linear:AMS1117-3.3`, `Device:C`, `Device:C_Polarized`, `Device:R`, `Device:LED`, `Device:D_Schottky`,
`Device:Polyfuse`, `Connector_Generic:Conn_01x02`, `Switch:SW_Push`, and the power symbols `power:+5V`,
`power:+3V3`, `power:GND`, `power:PWR_FLAG`. The catalogue text the model sees (pin numbers, names, electrical
types) is generated from the parsed library files: `npx tsx scripts/catalogue.ts`.

## Model

Gemma 4, `gemma-4-31b-it`, through the Gemini API (`@google/genai`), server-side only. Gemma 4 is released under
the [Apache 2.0 licence](https://ai.google.dev/gemma/apache_2). All model calls go through one `ModelProvider`
interface in `lib/model/provider.ts`.

## How to run

Requirements: Node 22, KiCad 10 installed (tested with 10.0.4 on Windows 11), and a Gemini API key.

```bash
npm install
```

Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`. KiCad is located automatically; set `KICAD_CLI` and
`KICAD_SYMBOL_DIR` only if it is not found.

```bash
npm run dev
```

Then open http://localhost:3000. `/studio` is the app. `/studio?demo=1` replays a recorded session from `demo/`
with no API or kicad-cli calls.

Without the UI:

```bash
npx tsx scripts/draft.ts examples/reg-3v3.intent.json
```

drafts the hand-written 5 V to 3.3 V regulator (no model) into `runs/reg-3v3/v1/` and prints the kicad-cli output.

```bash
npm test
```

runs the unit tests and the acceptance tests, which call the real kicad-cli.

Each version of a session is stored in `runs/<session>/v<n>/` as `intent.json`, `design.kicad_sch`, `erc.json`,
`design.svg`, `layout.json` and `meta.json`.

## Eval

`scripts/eval.ts` drafts the 10 prompts in `data/prompts.json` with live Gemma, waits between calls, and gives any
draft that is not clean one fix round. Run of 4 October 2026, `gemma-4-31b-it`, minimal thinking, KiCad 10.0.4:

| Measure | Result |
| --- | --- |
| ERC-clean first time (0 errors, 0 warnings) | 10 / 10 |
| ERC-clean after one fix round | 10 / 10 |
| ERC and design rules clean first time | 10 / 10 |
| Drafts that needed the validation retry | 0 / 10 |
| Prompts lost to API errors | 0 / 10 |
| Tokens per draft (average) | 1,548 |
| Model time per draft (min / average / max) | 30 s / 58 s / 111 s |

Read these numbers with care:

- The prompts are short and stay inside the catalogue. They are not a hard test.
- Much of the ERC result is the engine's doing, not the model's: it adds `PWR_FLAG` where needed and the validator
  refuses any intent with an unassigned pin. ERC-clean means the file is electrically consistent, not that the
  circuit is what was asked for; nobody reviewed the ten circuits by hand.
- No draft needed the fix round, so this run does not measure it. The fix path was exercised separately in the
  studio (a removed capacitor and a removed LED resistor were both repaired in one round).
- Six of the ten calls hit a 500 or 503 from the hosted model and succeeded on retry.

The raw output is in `data/eval-output.txt` and the per-prompt results in `data/eval-results.json`.

```bash
npx tsx scripts/eval.ts
```

## Limits

- Twelve-symbol catalogue; anything else is rejected by the validator.
- No wire routing: connections are labels and power symbols, which is valid KiCad but not how a person would draw a
  dense sheet.
- The design rules are three checks, not a review.
- The hosted Gemma endpoint was slow (40 to 110 s per call) and returned occasional 500/503 errors during
  development; the provider retries twice.

## Credit

The intent-then-deterministic-draft idea comes from [Copperhead](https://github.com/copperheadhq/copperhead). Only
its README and spec were read for the idea; no Copperhead code is used. The visual language (white ground, square
corners, hairlines, Geist, one blue) follows supermemory.ai; none of their assets or text are used.

## Licence

MIT, see [LICENSE](LICENSE).
