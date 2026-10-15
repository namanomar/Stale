import type { ReactNode } from "react";

/** A quiet callout: tip, warning or note. */
export function Note({ kind = "note", title, children }: { kind?: "note" | "tip" | "warn"; title?: string; children: ReactNode }) {
  return (
    <aside className={`dx-note ${kind}`}>
      <b>{title ?? (kind === "tip" ? "Tip" : kind === "warn" ? "Careful" : "Note")}</b>
      <div>{children}</div>
    </aside>
  );
}

/** Numbered steps with a marker-pen number. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="dx-steps">{children}</ol>;
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: ReactNode }) {
  return <span className={`dx-pill ${tone}`}>{children}</span>;
}

export function Cards({ children }: { children: ReactNode }) {
  return <div className="dx-cards">{children}</div>;
}

export function Card({ title, children, tag }: { title: string; children: ReactNode; tag?: string }) {
  return (
    <div className="dx-card">
      {tag && <span className="tag">{tag}</span>}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function PageHead({ kicker, title, lead }: { kicker: string; title: string; lead: ReactNode }) {
  return (
    <header className="dx-head">
      <div className="kicker">{kicker}</div>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
    </header>
  );
}
