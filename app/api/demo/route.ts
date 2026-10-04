// The recorded session for /studio?demo=1. File reads only.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_DIR, demoPayloads } from "@/lib/demo";

export const runtime = "nodejs";

export async function GET() {
  const answers = join(DEMO_DIR, "answers.json");
  return Response.json({ versions: demoPayloads(), answers: existsSync(answers) ? JSON.parse(readFileSync(answers, "utf8")) : [] });
}
