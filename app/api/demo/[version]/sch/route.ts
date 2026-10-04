// Download a recorded schematic from demo/.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_DIR } from "@/lib/demo";

export const runtime = "nodejs";

export async function GET(_: Request, ctx: { params: Promise<{ version: string }> }) {
  const { version } = await ctx.params;
  const file = join(DEMO_DIR, `v${version}`, "design.kicad_sch");
  if (!/^\d+$/.test(version) || !existsSync(file)) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(readFileSync(file), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="redline-demo-v${version}.kicad_sch"`,
    },
  });
}
