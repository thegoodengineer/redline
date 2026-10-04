// The only place that talks to a model. Server-side only.
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ModelUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

export interface ModelReply {
  text: string;
  usage: ModelUsage;
  ms: number;
}

export interface ModelProvider {
  readonly model: string;
  complete(request: { system: string; user: string }): Promise<ModelReply>;
}

export const NO_USAGE: ModelUsage = { promptTokens: 0, outputTokens: 0, thoughtTokens: 0, totalTokens: 0 };

export function addUsage(a: ModelUsage, b: ModelUsage): ModelUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thoughtTokens: a.thoughtTokens + b.thoughtTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** GEMINI_API_KEY from .env.local when that file has one, otherwise from the environment. */
export function apiKey(): string {
  const file = join(process.cwd(), ".env.local");
  if (existsSync(file)) {
    const m = /^GEMINI_API_KEY=(.+)$/m.exec(readFileSync(file, "utf8"));
    if (m && m[1].trim()) return m[1].trim();
  }
  const env = process.env.GEMINI_API_KEY;
  if (!env) throw new Error("GEMINI_API_KEY is not set. Put it in .env.local (see .env.example).");
  return env;
}

export const GEMMA_MODEL = "gemma-4-31b-it";

/** Gemma 4 through the Gemini API. */
export class GemmaProvider implements ModelProvider {
  readonly model = GEMMA_MODEL;
  private client: GoogleGenAI | undefined;

  /** Minimal thinking by default: about half the latency, and intents still validate. REDLINE_THINKING=high turns it on. */
  constructor(private thinking: "high" | "minimal" = process.env.REDLINE_THINKING === "high" ? "high" : "minimal") {}

  async complete(request: { system: string; user: string }): Promise<ModelReply> {
    this.client ??= new GoogleGenAI({ apiKey: apiKey() });
    const t0 = Date.now();
    const call = () =>
      this.client!.models.generateContent({
        model: this.model,
        contents: request.user,
        config: {
          systemInstruction: request.system,
          temperature: 0.2,
          maxOutputTokens: 8192,
          thinkingConfig: {
            thinkingLevel: this.thinking === "high" ? ThinkingLevel.HIGH : ThinkingLevel.MINIMAL,
          },
        },
      });
    // The hosted model sometimes answers 429/500/503. Retry twice with a pause before giving up.
    let response: Awaited<ReturnType<typeof call>> | undefined;
    for (let attempt = 0; response === undefined; attempt++) {
      try {
        response = await call();
        if (!(response.text ?? "").trim() && attempt < 2) {
          // Seen in practice: a 200 response with no text. Ask again rather than fail the turn.
          console.error(`[gemma] empty reply (finish reason ${response.candidates?.[0]?.finishReason ?? "unknown"}), asking again`);
          response = undefined;
        }
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (attempt >= 2 || (status !== 429 && status !== 500 && status !== 503)) throw e;
        const wait = attempt === 0 ? 5 : 15;
        console.error(`[gemma] HTTP ${status}, retry ${attempt + 1} of 2 in ${wait} s`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
    const u = response.usageMetadata;
    return {
      text: response.text ?? "",
      ms: Date.now() - t0,
      usage: {
        promptTokens: u?.promptTokenCount ?? 0,
        outputTokens: u?.candidatesTokenCount ?? 0,
        thoughtTokens: u?.thoughtsTokenCount ?? 0,
        totalTokens: u?.totalTokenCount ?? 0,
      },
    };
  }
}
