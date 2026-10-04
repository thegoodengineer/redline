# Redline demo film: script

**Style.** Calm, technical, plain-spoken: an engineer showing work, not an advert. White ground, near-black
text, one blue accent, red and green only for fail and pass, Geist and Geist Mono, square corners, hairlines; the
same look as the product (`app/theme.css`). Music: a quiet ambient bed with a slow pulse, no melody that competes
with the voice.

**Length.** Target 1:50 to 1:58, hard limit 2:00. Narration is 240 words. Nothing is sped up; the model's
thinking time in the captures is cut, and scene 5 says so on screen and in the voice.

**Scene ids.** `scene: x` is an HTML scene in `video/scenes/scenes.html?scene=x`. `CAPTURE x` is a recording of
the real studio replaying a recorded session.

| # | Scene | On screen | Narration | Seconds |
|---|---|---|---|---|
| 01 | scene: cold | Black text on white, line by line: "Software students." / "Australian Rover Challenge." / "We had to build a schematic." (replaced by a photo from the team's site if one is supplied) | We're software students. At the Australian Rover Challenge, we had to build a schematic. | 7 |
| 02 | scene: problem | Real lines of a generated `.kicad_sch` scrolling, with its real byte count large beside it | A schematic is thousands of exact coordinates. Ask an A I to write one and it guesses. One wrong number, and a pin floats. | 11 |
| 03 | scene: title | The name Redline, a rule drawing across, the one-line pitch | This is Redline. Describe a circuit. Get a real KiCad schematic. | 6 |
| 04 | scene: flow | Five boxes with data moving between them: Gemma 4 intent, validator, engine, kicad-cli, studio | Gemma four writes a tiny list of parts and connections. Code places every symbol and draws every wire. Then KiCad's own rule check judges the result. | 13 |
| 05 | CAPTURE draft | Studio: a sentence is typed, the sheet appears, checks flip to pass. Caption: "model wait trimmed" | Type one sentence and press draft. The model takes about a minute, so we cut the wait. Out comes a real KiCad schematic, wired and labelled, and KiCad's own check reports zero errors. | 13 |
| 06 | CAPTURE ask | Studio: a question is asked, the answer appears in the chat, then the short-forms list scrolls into view | Not a hardware person? Ask why a part is there, and it answers in plain words. Below the checks, every short form on the sheet is explained. | 12 |
| 07 | CAPTURE edit | Studio: a change request, new parts outlined green, the Keep / Undo bar, Keep is pressed | Now ask for a change. It comes back as a few small edits, not a rewrite. New parts are outlined in green, and you choose keep or undo. | 12 |
| 08 | CAPTURE fix | Studio: a failing design rule marked in red on the sheet, Fix this is pressed, the check turns green | Remove a capacitor the regulator needs, and a design rule fails. The problem is marked on the sheet. One click sends it back, and the check turns green. | 13 |
| 09 | scene: proof | Three numbers, each with its source file under it | We measured it. Ten out of ten test prompts passed KiCad's check first time, and all ten matched a hand written reference circuit. One hundred and seven tests back the engine, against the real KiCad. | 14 |
| 10 | scene: close | Redline, the repository address, the tagline | Redline. Describe it, draw it, check it. Open source, on Gemma four and KiCad. | 8 |

The Seconds column is the plan. The real length of each clip is its narration plus a short tail, or the length of
the captured action if that is longer; `assemble.py` prints the final total.

**Music cue.** Bed under narration at about -22 dB, a small swell on the title (scene 03), fade out over the
close (scene 10).

**Numbers on screen and where each comes from.**

| Number | Source |
|---|---|
| Byte count of the schematic in scene 02 | `demo/v1/meta.json`, read at render time |
| 10 / 10 ERC-clean first time | `data/eval-results.json` (`ercCleanFirst`, `prompts`) |
| 10 / 10 match the golden answer | `data/eval-results.json` (`goldenFirst`) |
| 107 tests | `npx vitest run`, run on the day of the render and saved to `video/assets/tests.txt` |

**Pronunciation risks.** "KiCad" (written "KiCad", check it is said "key-cad"), "Gemma four" (written out),
"A I" (spaced so it is spelled), "hand written" (two words so it is not rushed).

**Rubric map.** No rubric was supplied, so this assumes the four lines most hackathons use.

| Assumed rubric line | Scene that earns it |
|---|---|
| Problem and need | 01, 02 |
| Technical depth | 04, 09 |
| Working demo | 05, 06, 07, 08 |
| Design and usability | 05 to 08 (the real UI), 03, 10 |

**Human shot list.** None required. Optional: a photo or clip of the rover for scene 01, at least 1920x1080.
