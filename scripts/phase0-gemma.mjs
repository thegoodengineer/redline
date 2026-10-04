// Phase 0 smoke test: one call to Gemma 4 through the Gemini API.
// Run: node scripts/phase0-gemma.mjs   (needs GEMINI_API_KEY in env or .env.local)
import { GoogleGenAI } from "@google/genai";
import { existsSync, readFileSync } from "node:fs";

if (!process.env.GEMINI_API_KEY && existsSync(".env.local")) {
  const m = readFileSync(".env.local", "utf8").match(/^GEMINI_API_KEY=(.+)$/m);
  if (m) process.env.GEMINI_API_KEY = m[1].trim();
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set");
  process.exit(1);
}

const model = "gemma-4-31b-it";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const t0 = Date.now();
const response = await ai.models.generateContent({
  model,
  contents:
    'Reply with only this JSON, filled in: {"model": "<your model family>", "pins_on_AMS1117": <number>}',
  config: {
    systemInstruction: "You output a single JSON object and nothing else.",
  },
});
console.log("model:        ", model);
console.log("latency ms:   ", Date.now() - t0);
console.log("text:         ", response.text);
console.log("finishReason: ", response.candidates?.[0]?.finishReason);
console.log("usageMetadata:", JSON.stringify(response.usageMetadata));
