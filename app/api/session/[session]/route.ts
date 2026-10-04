// All versions of a session, so the studio can resume after a reload.
import { readPayload } from "@/lib/payload";
import { glossary } from "@/lib/glossary";
import { symbolLibrary } from "@/lib/runs";
import { listAnswers, listVersions, versionDir } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(_: Request, ctx: { params: Promise<{ session: string }> }) {
  try {
    const { session } = await ctx.params;
    const versions = listVersions(session).map((v) => {
      const payload = readPayload(versionDir(session, v));
      payload.meta.glossary ??= glossary(payload.intent, symbolLibrary(), payload.layout.flags.length > 0);
      return payload;
    });
    return Response.json({ versions, answers: listAnswers(session) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
