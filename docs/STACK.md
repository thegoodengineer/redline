# Stack

One line per layer: the choice and the reason.

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 (App Router, Node runtime) + TypeScript | One process serves the UI and the API routes that call KiCad; mainstream, and coding agents write it well. |
| UI | Plain CSS in one `app/theme.css`, no UI kit | Full control of the look; every colour and font is a variable with a 5-line rule comment at the top. |
| Fonts | Geist and Geist Mono (`geist` package) | Bundled locally, no network fetch at build time. |
| Model | Gemma 4, `gemma-4-31b-it`, through the Gemini API (`@google/genai`) | Open-weights model (Apache 2.0) behind one `ModelProvider` interface, server-side only. |
| Validation | zod plus a hand-written validator | The model's output is checked before anything is written. |
| Engine | Own TypeScript in `lib/engine/`, no dependencies | Deterministic and unit tested: s-expressions, symbol loader, placement, router, emitter. |
| Judge | `kicad-cli` (KiCad 10) through `child_process.execFile` | The real tool decides whether a file is valid; paths with spaces need no quoting. |
| Tests | vitest | Unit tests plus acceptance tests that run the real `kicad-cli`. |
| Screenshots | Playwright driving the installed Microsoft Edge | The UI is reviewed from real screenshots at three widths; no browser download. |
| CI | GitHub Actions: type-check and build | KiCad is not installed on the runner, so the tests that need it run locally. |

## One-command tasks

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app at http://localhost:3000 |
| `npm test` | Unit and acceptance tests (needs KiCad) |
| `npm run typecheck` | TypeScript check |
| `npm run draft -- examples/mic5317-3v3.intent.json` | Draft an intent with no model call |
| `npm run eval` | Ten prompts through the live model |
| `npm run shots` | Screenshots of every page at 1440, 1024 and 400 px |

## What needs setting up first

- A Gemini API key in `.env.local` (free tier works).
- KiCad 10 installed locally. There is no hosted deployment: the app needs `kicad-cli` on the same machine.
