"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { jf, streamPost, type IntegrationRec, type SyncEvent, type Totals } from "./api";
import { errText, Modal, useLoad } from "./ui";

interface LogItem {
  label: string;
  outcome: string;
  n: number;
}
export interface JobState {
  running: boolean;
  finished: boolean;
  stage: string;
  total: number;
  done: number;
  log: LogItem[];
  totals: Totals | null;
  error: string | null;
}

const idle: JobState = { running: false, finished: false, stage: "", total: 0, done: 0, log: [], totals: null, error: null };

/** Runs a streaming job (history import, sample data) and exposes live progress. */
export function useJob() {
  const [s, setS] = useState<JobState>(idle);
  const ctl = useRef<AbortController | null>(null);

  const start = useCallback(async (path: string, body: unknown) => {
    ctl.current = new AbortController();
    setS({ ...idle, running: true, stage: "Starting…" });
    const apply = (e: SyncEvent) =>
      setS((p) => {
        switch (e.t) {
          case "stage":
            return { ...p, stage: e.text };
          case "total":
            return { ...p, total: e.total, done: 0 };
          case "item":
            return { ...p, done: e.done, total: e.total, totals: e.totals, log: [...p.log.slice(-39), { label: e.label, outcome: e.outcome, n: e.done }] };
          case "done":
            return { ...p, running: false, finished: true, totals: e.totals, stage: "Finished" };
          case "error":
            return { ...p, running: false, error: e.message };
        }
      });
    try {
      await streamPost(path, body, apply, ctl.current.signal);
      setS((p) => (p.running ? { ...p, running: false, finished: !p.error } : p));
    } catch (e) {
      if (ctl.current?.signal.aborted) setS((p) => ({ ...p, running: false, stage: "Cancelled" }));
      else setS((p) => ({ ...p, running: false, error: errText(e) }));
    }
  }, []);

  const cancel = useCallback(() => ctl.current?.abort(), []);
  const reset = useCallback(() => setS(idle), []);
  return { state: s, start, cancel, reset };
}

const chip = (outcome: string) =>
  /failed/.test(outcome) ? "red" : /review/.test(outcome) ? "amber" : /changed/.test(outcome) ? "amber" : /new|confirmed/.test(outcome) ? "green" : "gray";

export function ProgressPanel({ s }: { s: JobState }) {
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const t = s.totals;
  return (
    <div className="job">
      <div className="job-top">
        <div className="job-stage">
          {s.running && <span className="spin" aria-hidden />}
          {s.error ? <b style={{ color: "var(--tainted)" }}>Stopped</b> : <b>{s.stage}</b>}
        </div>
        {s.total > 0 && (
          <div className="muted small">
            {s.done} of {s.total}
          </div>
        )}
      </div>
      <div className={`pbar ${s.running && !s.total ? "indet" : ""}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: s.total ? `${pct}%` : undefined }} />
      </div>

      {t && (
        <div className="job-stats">
          <div><b>{t.added}</b><span>new facts</span></div>
          <div className={t.updated ? "hot" : ""}><b>{t.updated}</b><span>changed</span></div>
          <div><b>{t.confirmed}</b><span>confirmed</span></div>
          <div className={t.queued ? "hot" : ""}><b>{t.queued}</b><span>to review</span></div>
          {t.failed > 0 && <div className="bad"><b>{t.failed}</b><span>failed</span></div>}
        </div>
      )}

      {s.error && <div className="callout bad" style={{ marginTop: 10 }}>{s.error}</div>}

      {s.log.length > 0 && (
        <ol className="job-log" aria-live="polite">
          {[...s.log].reverse().map((l) => (
            <li key={l.n}>
              <span className={`badge-soft ${chip(l.outcome)}`}>{l.outcome}</span>
              <span className="grow">{l.label}</span>
            </li>
          ))}
        </ol>
      )}

      {s.finished && !s.error && (
        <div className="job-next">
          <Link className="btn primary sm" href="/app/memory">See what it learned →</Link>
          {t && t.queued > 0 && <Link className="btn sm" href="/app/review">{t.queued} waiting for review</Link>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface ScopeList {
  noun: string;
  label: string;
  items: { id: string; name: string; hint?: string; available?: boolean }[];
}

/** Pick what to import (channels, repos, projects, pages), then watch it happen. */
export function ImportModal({ integration, onClose }: { integration: IntegrationRec; onClose: () => void }) {
  const { data, error } = useLoad<ScopeList>(() => jf("GET", `/api/v1/integrations/${integration.id}/sync`));
  const { state, start, cancel } = useJob();
  const [picked, setPicked] = useState<string[]>([]);
  const [limit, setLimit] = useState(50);
  const [q, setQ] = useState("");

  const items = (data?.items ?? []).filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  const usable = items.filter((i) => i.available !== false);
  const started = state.running || state.finished || !!state.error;

  return (
    <Modal
      title={`Import from ${integration.name}`}
      sub={data ? `Choose the ${data.noun} to read. Already-seen items are skipped, so it is safe to repeat.` : "Loading what is available…"}
      onClose={state.running ? () => undefined : onClose}
      foot={
        started ? (
          state.running ? (
            <button className="btn" onClick={cancel}>Stop</button>
          ) : (
            <button className="btn primary" onClick={onClose}>Close</button>
          )
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!picked.length} onClick={() => start(`/api/v1/integrations/${integration.id}/sync`, { scope: picked, limit })}>
              Import {picked.length || ""} {data?.noun ?? ""}
            </button>
          </>
        )
      }
    >
      {started ? (
        <ProgressPanel s={state} />
      ) : (
        <>
          {error && <div className="callout bad">{error}</div>}
          {!data && !error && <div className="muted"><span className="spin" /> Asking {integration.name} what you have…</div>}
          {data && data.items.length === 0 && <div className="callout warn">Nothing found. Check that the token can see some {data.noun}.</div>}
          {data && data.items.length > 0 && (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <input className="input" placeholder={`Filter ${data.noun}…`} value={q} onChange={(e) => setQ(e.target.value)} />
                <button className="btn sm" onClick={() => setPicked(picked.length === usable.length ? [] : usable.map((i) => i.id))}>
                  {picked.length === usable.length && usable.length ? "Clear" : "Select all"}
                </button>
              </div>
              <div className="scopelist">
                {items.map((c) => (
                  <label key={c.id} className="row" style={{ opacity: c.available === false ? 0.5 : 1 }}>
                    <input
                      type="checkbox"
                      disabled={c.available === false}
                      checked={picked.includes(c.id)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
                    />
                    <span className="grow">{c.name}</span>
                    {c.hint && <span className="muted small">{c.hint}</span>}
                  </label>
                ))}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <span className="muted small">Newest items per {data.noun.replace(/s$/, "")}:</span>
                <select className="select" style={{ width: 90 }} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                  {[20, 50, 100, 200].map((n) => <option key={n}>{n}</option>)}
                </select>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

/** One click: a believable company with three weeks of history, so every feature has something to show. */
export function SampleModal({ onClose }: { onClose: () => void }) {
  const { state, start, cancel } = useJob();
  const started = state.running || state.finished || !!state.error;
  return (
    <Modal
      title="Load a sample company"
      sub="Northwind Robotics is launching a product. You will get three weeks of Slack, Jira, GitHub, Notion and email, with a price that changes, a schedule that slips, a policy edit, an outsider's quote and a phishing email."
      onClose={state.running ? () => undefined : onClose}
      foot={
        started ? (
          state.running ? <button className="btn" onClick={cancel}>Stop</button> : <button className="btn primary" onClick={onClose}>Close</button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={() => start("/api/v1/sample", {})}>Load sample data</button>
          </>
        )
      }
    >
      {started ? (
        <ProgressPanel s={state} />
      ) : (
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>17 messages, dated from three weeks ago to yesterday.</li>
          <li>Plans (a purchase order, press invitations) are built on the facts, so changes ripple.</li>
          <li>Takes about a minute because each message is read by the language model.</li>
          <li>It is added to this workspace only. Run it on a fresh workspace to keep things tidy.</li>
        </ul>
      )}
    </Modal>
  );
}
