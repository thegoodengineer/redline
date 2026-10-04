// All versions of a session, so the studio can resume after a reload.
import { readPayload } from "@/lib/payload";
import { listAnswers, listVersions, versionDir } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(_: Request, ctx: { params: Promise<{ session: string }> }) {
  try {
    const { session } = await ctx.params;
    return Response.json({ versions: listVersions(session).map((v) => readPayload(versionDir(session, v))), answers: listAnswers(session) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
