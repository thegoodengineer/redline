// GET  .../sch   downloads design.kicad_sch
// POST .../open  launches the KiCad schematic editor on this machine
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openInEditor } from "@/lib/kicad/cli";
import { versionDir } from "@/lib/session";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ session: string; version: string; file: string }> };

async function schPath(ctx: Ctx, want: string): Promise<string | Response> {
  const { session, version, file } = await ctx.params;
  if (file !== want || !/^\d+$/.test(version)) return Response.json({ error: "not found" }, { status: 404 });
  try {
    const p = join(versionDir(session, Number(version)), "design.kicad_sch");
    return existsSync(p) ? p : Response.json({ error: "not found" }, { status: 404 });
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}

export async function GET(_: Request, ctx: Ctx) {
  const p = await schPath(ctx, "sch");
  if (typeof p !== "string") return p;
  const { session, version } = await ctx.params;
  return new Response(readFileSync(p), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${session}-v${version}.kicad_sch"`,
    },
  });
}

export async function POST(_: Request, ctx: Ctx) {
  const p = await schPath(ctx, "open");
  if (typeof p !== "string") return p;
  try {
    return Response.json({ ok: true, editor: openInEditor(p), file: p });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
