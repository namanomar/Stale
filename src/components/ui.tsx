"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

/* ---------------- toasts ---------------- */
interface Toast {
  id: number;
  kind: "ok" | "err" | "info";
  text: string;
  detail?: React.ReactNode;
}
type Notify = (kind: Toast["kind"], text: string, detail?: React.ReactNode) => void;
const ToastCtx = createContext<Notify>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const id = useRef(0);
  const notify = useCallback<Notify>((kind, text, detail) => {
    const n = ++id.current;
    setToasts((t) => [...t.slice(-3), { id: n, kind, text, detail }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n)), kind === "err" ? 9000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <div>{t.text}</div>
            {t.detail}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

/* ---------------- data loading ---------------- */
/** Load once, refresh on an interval and on demand. Keeps the previous data while refetching. */
export function useLoad<T>(fn: () => Promise<T>, everyMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
    if (!everyMs) return;
    const t = setInterval(() => document.visibilityState === "visible" && reload(), everyMs);
    return () => clearInterval(t);
  }, [reload, everyMs]);
  return { data, error, loading, reload, setData };
}

/* ---------------- bits ---------------- */
export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Modal({
  title,
  sub,
  onClose,
  children,
  foot,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {sub && <div className="sub">{sub}</div>}
        {children}
        {foot && <div className="foot">{foot}</div>}
      </div>
    </div>
  );
}

export function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {help && <span className="help">{help}</span>}
    </div>
  );
}

export function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      {label && <div className="small muted" style={{ marginBottom: 4 }}>{label}</div>}
      <div className="code" style={{ paddingRight: 70 }}>
        {text}
        <button
          className="btn sm"
          style={{ position: "absolute", top: 6, right: 6 }}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
        >
          {done ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function timeAgo(ts: number | null | undefined) {
  if (!ts) return "never";
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const short = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function Spinner() {
  return <span className="muted small">Loading…</span>;
}
