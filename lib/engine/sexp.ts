// S-expression reader and writer for KiCad files.
// Bare tokens (symbols, numbers) stay as plain strings so numbers round-trip
// byte for byte; quoted strings are wrapped in Str.

export class Str {
  constructor(readonly value: string) {}
}
export type Atom = string | Str;
export type Node = Atom | Node[];

export const q = (s: string) => new Str(s);

export function isList(n: Node | undefined): n is Node[] {
  return Array.isArray(n);
}

/** Text of an atom, quoted or not. Lists give "". */
export function text(n: Node | undefined): string {
  if (n === undefined || isList(n)) return "";
  return n instanceof Str ? n.value : n;
}

export function head(n: Node): string {
  return isList(n) && n.length > 0 ? text(n[0]) : "";
}

export function child(list: Node[], name: string): Node[] | undefined {
  for (const c of list) if (isList(c) && head(c) === name) return c;
  return undefined;
}

export function children(list: Node[], name: string): Node[][] {
  return list.filter((c): c is Node[] => isList(c) && head(c) === name);
}

export function parse(src: string): Node[] {
  const stack: Node[][] = [];
  let root: Node[] | undefined;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "(") {
      const list: Node[] = [];
      if (stack.length) stack[stack.length - 1].push(list);
      stack.push(list);
      i++;
    } else if (c === ")") {
      const done = stack.pop();
      if (!done) throw new Error(`sexp: unexpected ")" at offset ${i}`);
      if (!stack.length) {
        if (root) throw new Error(`sexp: more than one top-level list at offset ${i}`);
        root = done;
      }
      i++;
    } else if (c === '"') {
      let out = "";
      i++;
      for (;;) {
        if (i >= n) throw new Error("sexp: unterminated string");
        const d = src[i];
        if (d === "\\") {
          const e = src[i + 1];
          out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
          i += 2;
        } else if (d === '"') {
          i++;
          break;
        } else {
          out += d;
          i++;
        }
      }
      if (!stack.length) throw new Error("sexp: string outside a list");
      stack[stack.length - 1].push(new Str(out));
    } else if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else {
      let j = i;
      while (j < n && !' \t\r\n()"'.includes(src[j])) j++;
      if (!stack.length) throw new Error(`sexp: token outside a list at offset ${i}`);
      stack[stack.length - 1].push(src.slice(i, j));
      i = j;
    }
  }
  if (stack.length) throw new Error('sexp: missing ")"');
  if (!root) throw new Error("sexp: empty input");
  return root;
}

function atom(a: Atom): string {
  if (!(a instanceof Str)) return a;
  return (
    '"' +
    a.value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t") +
    '"'
  );
}

/** KiCad-style layout: a list of atoms on one line, otherwise one child list per line. */
export function write(node: Node, indent = 0): string {
  if (!isList(node)) return atom(node);
  if (!node.some(isList)) return "(" + node.map((a) => atom(a as Atom)).join(" ") + ")";
  const pad = "\t".repeat(indent + 1);
  let k = 0;
  const lead: string[] = [];
  while (k < node.length && !isList(node[k])) lead.push(atom(node[k++] as Atom));
  let out = "(" + lead.join(" ");
  for (; k < node.length; k++) out += "\n" + pad + write(node[k], indent + 1);
  return out + "\n" + "\t".repeat(indent) + ")";
}

/** Millimetre value as KiCad writes it: at most 4 decimals, no trailing zeros, no "-0". */
export function num(v: number): string {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) || r === 0 ? "0" : String(r);
}
