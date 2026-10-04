"use client";
// The KiCad SVG, inline, with pan and zoom. Overlays are drawn in the same
// sheet-millimetre coordinates using layout.json.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout } from "@/lib/engine";

export interface Mark {
  ref: string;
  kind: "fail" | "added" | "changed" | "hover";
  /** Finding number shown in a tag, for "fail" marks. */
  n?: number;
  /** Position of the tag when several findings mark the same part. */
  slot?: number;
  active?: boolean;
}

interface View {
  cx: number;
  cy: number;
  /** Millimetres per CSS pixel. */
  scale: number;
}

function boxOf(layout: Layout, ref: string) {
  return layout.parts[ref] ?? layout.flags.find((f) => f.ref === ref);
}

export default function Sheet({ svg, layout, marks, fitKey }: { svg: string; layout: Layout; marks: Mark[]; fitKey: string }) {
  const el = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const fit = useCallback(
    (w: number, h: number): View => {
      const c = layout.content;
      const m = 10;
      return { cx: c.x + c.w / 2, cy: c.y + c.h / 2, scale: Math.max((c.w + 2 * m) / w, (c.h + 2 * m) / h) };
    },
    [layout],
  );

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const ro = new ResizeObserver(() => setSize({ w: node.clientWidth || 800, h: node.clientHeight || 600 }));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // Refit when a different version is shown or the pane is first measured.
  useEffect(() => {
    setView(fit(size.w, size.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, size.w, size.h]);

  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    setView((v) => {
      if (!v) return v;
      const node = el.current!;
      const w = node.clientWidth;
      const h = node.clientHeight;
      const x = px ?? w / 2;
      const y = py ?? h / 2;
      const scale = Math.min(1.2, Math.max(0.01, v.scale * factor));
      // keep the sheet point under the cursor fixed
      const mx = v.cx + (x - w / 2) * v.scale;
      const my = v.cy + (y - h / 2) * v.scale;
      return { scale, cx: mx - (x - w / 2) * scale, cy: my - (y - h / 2) * scale };
    });
  }, []);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const v = view ?? fit(size.w, size.h);
  const viewBox = `${v.cx - (size.w * v.scale) / 2} ${v.cy - (size.h * v.scale) / 2} ${size.w * v.scale} ${size.h * v.scale}`;
  const inner = useMemo(() => ({ __html: svg }), [svg]);
  const tag = 13 * v.scale; // tag height in mm so it stays 13 px on screen

  return (
    <>
      <svg
        ref={el}
        className={`sheet${dragging ? " dragging" : ""}`}
        viewBox={viewBox}
        role="img"
        aria-label="Schematic drawn by KiCad"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x;
          const dy = e.clientY - drag.current.y;
          drag.current = { x: e.clientX, y: e.clientY };
          setView((p) => (p ? { ...p, cx: p.cx - dx * p.scale, cy: p.cy - dy * p.scale } : p));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => setView(fit(size.w, size.h))}
      >
        <g dangerouslySetInnerHTML={inner} />
        {marks.map((m, i) => {
          const b = boxOf(layout, m.ref);
          if (!b) return null;
          const pad = m.kind === "fail" ? 2.2 : 1.4;
          const x = b.x - pad;
          const y = b.y - pad;
          return (
            <g key={`${m.kind}-${m.ref}-${i}`} className={`mark ${m.kind}${m.active ? " active" : ""}`}>
              <rect x={x} y={y} width={b.w + 2 * pad} height={b.h + 2 * pad} />
              {m.kind === "fail" && m.n !== undefined && (
                <g className="tag">
                  <rect x={x + (m.slot ?? 0) * tag * 1.7} y={y - tag} width={tag * 1.5} height={tag} />
                  <text x={x + (m.slot ?? 0) * tag * 1.7 + tag * 0.75} y={y - tag * 0.24} fontSize={tag * 0.78} textAnchor="middle">
                    {m.n}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="zoom">
        <button className="btn small" onClick={() => zoomAt(1 / 1.3)} aria-label="Zoom in">
          +
        </button>
        <button className="btn small" onClick={() => zoomAt(1.3)} aria-label="Zoom out">
          −
        </button>
        <button className="btn small" onClick={() => setView(fit(size.w, size.h))}>
          Fit
        </button>
      </div>
    </>
  );
}
