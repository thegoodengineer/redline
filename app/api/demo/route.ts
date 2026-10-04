// The recorded session for /studio?demo=1. File reads only.
import { demoPayloads } from "@/lib/demo";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ versions: demoPayloads() });
}
