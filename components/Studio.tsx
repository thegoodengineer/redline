"use client";
// /studio: chat on the left, the KiCad sheet in the centre, checks on the right.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Finding } from "@/lib/engine";
import type { VersionPayload } from "@/lib/payload";
import type { Check, Turn } from "@/lib/session";
import Sheet, { Mark } from "./Sheet";

const EXAMPLES = [
  "5 V in on a 2-pin connector, an AMS1117-3.3 regulator with input and output capacitors, 3.3 V out on a 2-pin connector.",
  "5 V in on a 2-pin connector with a polyfuse and a Schottky diode for reverse protection, then a green power LED.",
  "A push button with a 10k pull-down, powered from 3.3 V, with the button signal on a 2-pin connector.",
];

type Action =
  | { action: "generate"; text: string }
  | { action: "revise"; text: string }
  | { action: "fix"; checkIds: string[]; text: string };

interface Failure {
  after: number; // shown after this version's entries
  text: string;
  title: string;
  findings: Finding[];
  detail?: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const newSession = () => `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function Studio() {
  const router = useRouter();
  const params = useSearchParams();
  const demo = params.get("demo") === "1";
  const session = demo ? null : params.get("s");
  /** Recorded versions from demo/, revealed one at a time in demo mode. */
  const [recorded, setRecorded] = useState<VersionPayload[]>([]);

  const [versions, setVersions] = useState<VersionPayload[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [loading, setLoading] = useState(!!session || demo);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ text: string; since: number; action: Action["action"] } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [draft, setDraft] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<number>(Infinity);
  const [notice, setNotice] = useState<string | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const skipLoad = useRef<string | null>(null);

  // Resume a session from the URL.
  useEffect(() => {
    if (demo ? false : !session || skipLoad.current === session) return;
    let live = true;
    setLoading(true);
    setLoadError(null);
    fetch(demo ? "/api/demo" : `/api/session/${session}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        return body.versions as VersionPayload[];
      })
      .then((v) => {
        if (!live) return;
        if (demo) {
          // ?start=N opens the demo with the first N recorded versions already shown.
          const start = Math.min(Number(params.get("start")) || 0, v.length);
          setRecorded(v);
          setVersions(v.slice(0, start));
          setCurrent(start ? v[start - 1].meta.version : null);
          return;
        }
        setVersions(v);
        setCurrent(v.length ? v[v.length - 1].meta.version : null);
      })
      .catch((e) => live && setLoadError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [session, demo]);

  const next = demo ? recorded[versions.length] : undefined;
  const shown = (request: string) => request.replace(/\[(?:KiCad ERC|design rule) [a-z_]+\] /g, "");
  // Demo mode: the composer shows the next recorded request.
  useEffect(() => {
    if (demo) setDraft(next ? shown(next.meta.request) : "");
  }, [demo, next]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.round((Date.now() - busy.since) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [versions.length, failures.length, busy]);

  const payload = versions.find((v) => v.meta.version === current) ?? null;
  const checks = payload?.meta.checks ?? [];
  const failing = checks.filter((c) => c.status !== "pass");

  // After a turn, checks flip to their result one by one.
  useEffect(() => {
    if (revealed >= checks.length) return;
    const t = setTimeout(() => setRevealed((n) => n + 1), 260);
    return () => clearTimeout(t);
  }, [revealed, checks.length]);

  const run = useCallback(
    async (a: Action) => {
      if (busy) return;
      if (demo) {
        // Replay the next recorded turn. No model, no kicad-cli.
        if (!next) return;
        setBusy({ text: shown(next.meta.request), since: Date.now(), action: next.meta.kind === "generate" ? "generate" : "revise" });
        await new Promise((r) => setTimeout(r, 2600));
        setVersions((v) => [...v, next]);
        setCurrent(next.meta.version);
        setRevealed(0);
        setBusy(null);
        return;
      }
      const sid = session ?? newSession();
      if (!session) {
        skipLoad.current = sid;
        router.replace(`/studio?s=${sid}`);
      }
      const from = current;
      setBusy({ text: a.text, since: Date.now(), action: a.action });
      setNotice(null);
      const fail = (title: string, findings: Finding[], detail?: string) =>
        setFailures((f) => [...f, { after: versions.at(-1)?.meta.version ?? 0, text: a.text, title, findings, detail }]);
      try {
        const body =
          a.action === "generate"
            ? { action: a.action, session: sid, text: a.text }
            : a.action === "revise"
              ? { action: a.action, session: sid, version: from, text: a.text }
              : { action: a.action, session: sid, version: from, checkIds: a.checkIds };
        const r = await fetch("/api/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const turn = (await r.json()) as Turn | { error: string };
        if ("error" in turn) return fail("Request failed", [], turn.error);
        if (!turn.ok) return fail(`Rejected by the validator after ${turn.attempts} attempts. Nothing was written.`, turn.findings);
        const fresh = await fetch(`/api/session/${sid}`).then((x) => x.json());
        setVersions(fresh.versions);
        setCurrent(turn.meta.version);
        setRevealed(0);
        setDraft("");
      } catch (e) {
        fail("Request failed", [], e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [busy, session, current, versions, router, demo, next],
  );

  // ?demo=1&auto=1 plays the recorded story by itself (used to record the video).
  const auto = demo && params.get("auto") === "1";
  useEffect(() => {
    if (!auto || busy || !next || revealed < checks.length) return;
    const t = setTimeout(() => run({ action: "generate", text: "" }), versions.length ? 5000 : 1500);
    return () => clearTimeout(t);
  }, [auto, busy, next, revealed, checks.length, versions.length, run]);

  const submit = () => {
    const text = draft.trim();
    if (demo) return run({ action: "generate", text });
    if (text.length < 3) return;
    run(payload ? { action: "revise", text } : { action: "generate", text });
  };
  const fix = (list: Check[]) =>
    run({
      action: "fix",
      checkIds: list.map((c) => c.id),
      text: list.length === 1 ? `Fix: ${list[0].message}` : `Fix all ${list.length} findings`,
    });

  const openInKicad = async () => {
    if (!payload) return;
    setNotice("Opening KiCad…");
    const r = await fetch(`/api/session/${session}/${payload.meta.version}/open`, { method: "POST" });
    const body = await r.json();
    setNotice(r.ok ? "KiCad schematic editor launched." : `Could not open KiCad: ${body.error}`);
  };

  const marks = useMemo<Mark[]>(() => {
    if (!payload) return [];
    const out: Mark[] = [];
    const d = payload.meta.diff;
    if (d) {
      for (const ref of d.added) out.push({ ref, kind: "added" });
      for (const c of d.changed) out.push({ ref: c.ref, kind: "changed" });
    }
    failing.forEach((c, i) => {
      if (checks.indexOf(c) >= revealed) return;
      c.refs.forEach((ref, k) => {
        const slot = out.filter((o) => o.kind === "fail" && o.ref === ref && o.n !== undefined).length;
        out.push({ ref, kind: "fail", n: k === 0 ? i + 1 : undefined, slot, active: hover === c.id });
      });
    });
    const h = checks.find((c) => c.id === hover);
    if (h && h.status === "pass") for (const ref of h.refs) out.push({ ref, kind: "hover" });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, hover, revealed]);

  const m = payload?.meta;
  const diff = m?.diff;
  const passCount = checks.filter((c, i) => c.status === "pass" && i < revealed).length;
  const failCount = checks.filter((c, i) => c.status !== "pass" && i < revealed).length;

  return (
    <div className="studio">
      <header className="topbar">
        <Link href="/" className="brand">
          <b>Redline</b>
          <span className="label">{demo ? "recorded demo" : "studio"}</span>
        </Link>
        <div className="versions">
          <span className="label">Versions</span>
          {versions.length ? (
            <div className="vstrip">
              {versions.map((v) => (
                <button
                  key={v.meta.version}
                  aria-current={v.meta.version === current}
                  title={v.meta.request}
                  onClick={() => {
                    setCurrent(v.meta.version);
                    setRevealed(Infinity);
                  }}
                >
                  v{v.meta.version}
                </button>
              ))}
            </div>
          ) : (
            <span className="mono" style={{ color: "var(--ink-3)", fontSize: 12 }}>
              none yet
            </span>
          )}
          {notice && (
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>
              {notice}
            </span>
          )}
        </div>
        <div className="actions">
          {payload ? (
            <a className="btn" href={demo ? `/api/demo/${payload.meta.version}/sch` : `/api/session/${session}/${payload.meta.version}/sch`}>
              Download .kicad_sch
            </a>
          ) : (
            <button className="btn" disabled>
              Download .kicad_sch
            </button>
          )}
          <button className="btn" disabled={!payload || demo} title={demo ? "Not available in the recorded demo" : undefined} onClick={openInKicad}>
            Open in KiCad
          </button>
        </div>
      </header>

      <div className="columns">
        {/* ---------------- chat ---------------- */}
        <section className="col">
          <div className="colhead">
            <span className="label">Chat</span>
            {(session || demo) && versions.length > 0 && (
              <button
                className="btn small"
                onClick={() => {
                  setVersions([]);
                  setCurrent(null);
                  setFailures([]);
                  router.replace(demo ? "/studio?demo=1" : "/studio");
                }}
              >
                {demo ? "Restart" : "New"}
              </button>
            )}
          </div>
          <div className="log">
            {!versions.length && !busy && !failures.length && (
              <div className="empty-chat">
                <p>
                  {demo
                    ? "This is a recorded session: three real turns with gemma-4-31b-it, replayed from the demo folder with no API or kicad-cli calls. Press Replay to step through it."
                    : "Describe a circuit in plain words. Gemma writes the parts and nets; code draws the sheet and KiCad checks it."}
                </p>
                <div className="examples" style={demo ? { display: "none" } : undefined}>
                  <span className="label">Try one</span>
                  {EXAMPLES.map((e) => (
                    <button key={e} onClick={() => setDraft(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {[0, ...versions.map((v) => v.meta.version)].map((ver) => {
              const v = versions.find((x) => x.meta.version === ver);
              return (
                <div key={ver}>
                  {v && (
                    <>
                      <div className="entry">
                        <div className="who">
                          <span className="label">You</span>
                        </div>
                        <p>{shown(v.meta.request)}</p>
                      </div>
                      <div className="entry result">
                        <div className="who">
                          <span className="label">Redline · v{v.meta.version}</span>
                          <span className="label">{(v.meta.ms / 1000).toFixed(1)} s</span>
                        </div>
                        <p>{v.intent.title}</p>
                        <ul className="facts">
                          <li>
                            {v.intent.parts.length} parts, {v.intent.nets.length} nets, {fmt(v.meta.usage.totalTokens)} tokens
                            {v.meta.attempts > 1 ? ", 1 validation retry" : ""}
                          </li>
                          {v.meta.diff && !v.meta.diff.same && (
                            <>
                              {v.meta.diff.added.length > 0 && <li>+ added {v.meta.diff.added.join(", ")}</li>}
                              {v.meta.diff.removed.length > 0 && <li>− removed {v.meta.diff.removed.join(", ")}</li>}
                              {v.meta.diff.changed.map((c) => (
                                <li key={c.ref}>
                                  ~ {c.ref}: {c.what.join("; ")}
                                </li>
                              ))}
                            </>
                          )}
                          {v.meta.diff?.same && <li>no change to the intent</li>}
                          <li>
                            ERC {v.meta.erc.errors} errors, {v.meta.erc.warnings} warnings ·{" "}
                            {v.meta.checks.filter((c) => c.source === "rule" && c.status === "fail").length} rule failures
                          </li>
                        </ul>
                      </div>
                    </>
                  )}
                  {failures
                    .filter((f) => f.after === ver)
                    .map((f, i) => (
                      <div key={i}>
                        <div className="entry">
                          <div className="who">
                            <span className="label">You</span>
                          </div>
                          <p>{f.text}</p>
                        </div>
                        <div className="entry failed">
                          <div className="who">
                            <span className="label">Not drafted</span>
                          </div>
                          <p>{f.title}</p>
                          {f.detail && <p className="mono" style={{ fontSize: 12, marginTop: 6 }}>{f.detail}</p>}
                          {f.findings.length > 0 && (
                            <ol>
                              {f.findings.map((x) => (
                                <li key={x.id}>{x.message}</li>
                              ))}
                            </ol>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}
            {busy && (
              <div className="entry pending">
                <div className="who">
                  <span className="label">You</span>
                  <span className="label">{elapsed} s</span>
                </div>
                <p>{busy.text}</p>
              </div>
            )}
            <div ref={logEnd} />
          </div>
          <div className="composer">
            <textarea
              value={draft}
              placeholder={demo ? "End of the recorded session." : payload ? `Ask for a change to v${payload.meta.version}…` : "Describe the circuit…"}
              disabled={!!busy}
              readOnly={demo}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="row">
              <span className="label">{demo ? "No API calls" : payload ? `Revises v${payload.meta.version}` : "Enter to send"}</span>
              <button className="btn primary" disabled={!!busy || (demo ? !next : draft.trim().length < 3)} onClick={submit}>
                {busy ? "Working…" : demo ? (next ? `Replay v${next.meta.version}` : "End of demo") : payload ? "Revise" : "Draft schematic"}
              </button>
            </div>
          </div>
        </section>

        {/* ---------------- sheet ---------------- */}
        <section className="col">
          <div className="sheetwrap">
            {payload && (
              <>
                <Sheet svg={payload.svg} layout={payload.layout} marks={marks} fitKey={`${session}-${payload.meta.version}`} />
                {(diff && !diff.same) || failCount > 0 ? (
                  <div className="legend">
                    {diff && diff.added.length > 0 && (
                      <span className="added">
                        <i /> added {diff.added.join(" ")}
                      </span>
                    )}
                    {diff && diff.changed.length > 0 && (
                      <span className="changed">
                        <i /> changed {diff.changed.map((c) => c.ref).join(" ")}
                      </span>
                    )}
                    {diff && diff.removed.length > 0 && <span className="removed">removed {diff.removed.join(" ")}</span>}
                    {failCount > 0 && (
                      <span className="failm">
                        <i /> finding
                      </span>
                    )}
                  </div>
                ) : null}
              </>
            )}
            {!payload && !busy && !loading && !loadError && (
              <div className="state">
                <div className="panel">
                  <span className="label">Empty sheet</span>
                  <h2>No schematic yet</h2>
                  <p>Describe a circuit on the left. The drawing here is the SVG that KiCad itself exports from the generated file.</p>
                </div>
              </div>
            )}
            {loading && (
              <div className="state">
                <div className="panel">
                  <span className="label">Loading</span>
                  <h2>Opening session</h2>
                  <div className="bar">
                    <i />
                  </div>
                </div>
              </div>
            )}
            {loadError && (
              <div className="state error">
                <div className="panel">
                  <span className="label">Error</span>
                  <h2>Could not load this session</h2>
                  <p className="mono" style={{ fontSize: 12 }}>{loadError}</p>
                  <button className="btn" onClick={() => router.replace("/studio")}>
                    Start a new one
                  </button>
                </div>
              </div>
            )}
            {busy && (
              <div className={`state${payload ? " over" : ""}`}>
                <div className="panel">
                  <span className="label">{busy.action === "generate" ? "Drafting" : "Revising"}</span>
                  <h2 className="mono">{elapsed} s</h2>
                  <p>
                    {demo && next
                      ? `Replaying a recorded turn. The real call took ${(next.meta.ms / 1000).toFixed(0)} seconds.`
                      : "Gemma usually answers in 40 to 100 seconds. The rest takes about two."}
                  </p>
                  <ul className="steps">
                    <li className="now">
                      <span>1 gemma-4-31b-it writes the intent</span>
                      <span>running</span>
                    </li>
                    <li>
                      <span>2 validate, place, emit .kicad_sch</span>
                      <span>code</span>
                    </li>
                    <li>
                      <span>3 kicad-cli ERC and SVG</span>
                      <span>KiCad</span>
                    </li>
                  </ul>
                  <div className="bar">
                    <i />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="stats">
            <div className="stat">
              <span className="label">Tokens this turn</span>
              <span className="value">{m ? fmt(m.usage.totalTokens) : "—"}</span>
              <span className="sub">{m ? `${fmt(m.usage.promptTokens)} in · ${fmt(m.usage.outputTokens + m.usage.thoughtTokens)} out` : "API usage metadata"}</span>
            </div>
            <div className="stat">
              <span className="label">Intent → schematic</span>
              <span className="value">{m ? `${fmt(m.bytes.intent)} → ${fmt(m.bytes.schematic)}` : "—"}</span>
              <span className="sub">{m ? `bytes · ${(m.bytes.schematic / m.bytes.intent).toFixed(1)}× by code` : "model bytes vs code bytes"}</span>
            </div>
            <div className="stat">
              <span className="label">KiCad ERC</span>
              <span className={`value ${m ? (m.erc.errors ? "fail" : "pass") : ""}`}>{m ? `${m.erc.errors} errors` : "—"}</span>
              <span className="sub">{m ? `${m.erc.warnings} warnings · KiCad ${m.erc.kicadVersion}` : "kicad-cli sch erc"}</span>
            </div>
            <div className="stat">
              <span className="label">Model time</span>
              <span className="value">{m ? `${(m.ms / 1000).toFixed(1)} s` : "—"}</span>
              <span className="sub">{m ? m.model + (m.attempts > 1 ? " · 1 retry" : "") : "gemma-4-31b-it"}</span>
            </div>
          </div>
        </section>

        {/* ---------------- checks ---------------- */}
        <section className="col">
          <div className="colhead">
            <span className="label">Checks</span>
            {payload && (
              <span className="summary">
                <span className="p">{passCount} pass</span> · <span className={failCount ? "f" : ""}>{failCount} fail</span>
              </span>
            )}
            <button className="btn small" disabled={!failing.length || !!busy || revealed < checks.length || (demo && (!next || current !== versions.length))} onClick={() => fix(failing)}>
              Fix all
            </button>
          </div>
          <div className="checks">
            {!payload && <p className="checks-empty">KiCad ERC results and design rules appear here once a sheet is drafted.</p>}
            {payload &&
              (["erc", "rule"] as const).map((source) => (
                <div key={source}>
                  <div className="group">
                    <span className="label">{source === "erc" ? "KiCad ERC" : "Design rules"}</span>
                  </div>
                  {checks.filter((c) => c.source === source).length === 0 && <p className="checks-empty">No rule applies to this circuit.</p>}
                  {checks.map((c, i) => {
                    if (c.source !== source) return null;
                    const shown = i < revealed;
                    const n = failing.indexOf(c) + 1;
                    return (
                      <div
                        key={c.id}
                        className={`check ${shown ? c.status : "wait"}${hover === c.id ? " active" : ""}`}
                        onMouseEnter={() => setHover(c.id)}
                        onMouseLeave={() => setHover(null)}
                      >
                        <span className="status">{shown ? c.status.toUpperCase() : "···"}</span>
                        <span className="msg">{shown ? c.message : "checking"}</span>
                        {shown && (c.refs.length > 0 || c.status !== "pass") && (
                          <div className="meta">
                            <div className="refs">
                              {n > 0 && <span className="n">{n}</span>}
                              {c.refs.map((r) => (
                                <span key={r}>{r}</span>
                              ))}
                            </div>
                            {c.status !== "pass" && (
                              <button className="btn small" disabled={!!busy || (demo && (!next || current !== versions.length))} onClick={() => fix([c])}>
                                Fix this
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}
