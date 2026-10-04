import Link from "next/link";

export default function NotFound() {
  return (
    <main className="notfound">
      <div className="panel">
        <span className="label">404 · no such sheet</span>
        <h1>This page is not connected to anything</h1>
        <p>The address does not match a page in Redline. The studio and the recorded demo are both one step away.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn primary" href="/studio">
            Open the studio
          </Link>
          <Link className="btn" href="/studio?demo=1">
            Recorded demo
          </Link>
        </div>
      </div>
    </main>
  );
}
