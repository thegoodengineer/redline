// One chat turn: generate, revise, or fix findings. Server-side only; the key never leaves here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { GemmaProvider } from "@/lib/model/provider";
import { fixRequest, generate, revise, versionDir, VersionMeta } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), session: z.string(), text: z.string().min(3).max(2000) }),
  z.object({ action: z.literal("revise"), session: z.string(), version: z.number().int().min(1), text: z.string().min(3).max(2000) }),
  z.object({ action: z.literal("fix"), session: z.string(), version: z.number().int().min(1), checkIds: z.array(z.string()).min(1) }),
]);

export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const provider = new GemmaProvider();
    if (body.action === "generate") return Response.json(await generate(body.session, body.text, provider));
    if (body.action === "revise") return Response.json(await revise(body.session, body.version, body.text, provider));
    const meta: VersionMeta = JSON.parse(readFileSync(join(versionDir(body.session, body.version), "meta.json"), "utf8"));
    const checks = meta.checks.filter((c) => body.checkIds.includes(c.id) && c.status !== "pass");
    if (!checks.length) return Response.json({ error: "Nothing to fix in this version." }, { status: 400 });
    return Response.json(await revise(body.session, body.version, fixRequest(checks), provider));
  } catch (e) {
    let message = e instanceof Error ? e.message : String(e);
    console.error(`[turn] failed: ${message}`);
    try {
      // The Gemini SDK throws the raw JSON error body; show its message instead.
      const api = JSON.parse(message).error;
      if (api?.message) message = `Gemini API error ${api.code}: ${api.message} The model service failed after 3 tries; send the message again.`;
    } catch {}
    return Response.json({ error: message.slice(0, 600) }, { status: 500 });
  }
}
