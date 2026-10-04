// The intent is everything the model writes: parts, nets, no coordinates.
import { z } from "zod";

const REF = /^[A-Z]+[0-9]+$/;
const PIN = /^[A-Z]+[0-9]+\.[A-Za-z0-9+~_-]+$/;

export const IntentSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1).max(80),
    /** Free text for humans (sources, datasheet citations). Ignored by the engine. */
    comment: z.string().optional(),
    parts: z
      .array(
        z
          .object({
            ref: z.string().regex(REF, 'ref must look like "U1"'),
            libId: z.string().min(3),
            value: z.string().min(1).max(40),
            group: z.string().min(1).max(40),
          })
          .strict(),
      )
      .min(1),
    nets: z.array(
      z
        .object({
          name: z.string().regex(/^[A-Za-z0-9+_~/-]+$/, "net name has unsupported characters").max(24),
          pins: z.array(z.string().regex(PIN, 'pin must look like "U1.3"')).min(1),
        })
        .strict(),
    ),
    noConnect: z.array(z.string().regex(PIN, 'pin must look like "U1.3"')).default([]),
    hints: z.object({ groupOrder: z.array(z.string()).default([]) }).strict().default({ groupOrder: [] }),
  })
  .strict();

export type Intent = z.infer<typeof IntentSchema>;

export function splitPin(p: string): { ref: string; pin: string } {
  const k = p.indexOf(".");
  return { ref: p.slice(0, k), pin: p.slice(k + 1) };
}

/** Column order: hinted groups first, then the rest in order of first appearance. */
export function groupOrder(intent: Intent): string[] {
  const used = new Set(intent.parts.map((p) => p.group));
  const out: string[] = [];
  for (const g of [...intent.hints.groupOrder, ...intent.parts.map((p) => p.group)]) {
    if (used.has(g) && !out.includes(g)) out.push(g);
  }
  return out;
}
