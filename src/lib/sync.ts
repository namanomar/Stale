import { ingestDocument, type IngestDoc } from "./ingest";
import type { Memory } from "./memory";
import type { Org } from "./system";

export interface Totals {
  read: number;
  added: number;
  updated: number;
  confirmed: number;
  queued: number;
  skipped: number;
  failed: number;
}

/** What the UI receives, one JSON object per line. */
export type SyncEvent =
  | { t: "stage"; text: string }
  | { t: "total"; total: number }
  | { t: "item"; done: number; total: number; label: string; outcome: string; totals: Totals }
  | { t: "done"; totals: Totals }
  | { t: "error"; message: string };

export const emptyTotals = (): Totals => ({ read: 0, added: 0, updated: 0, confirmed: 0, queued: 0, skipped: 0, failed: 0 });

const label = (d: IngestDoc) => `${d.sourceName}${d.author ? ` · ${d.author}` : ""}: ${d.text.replace(/\s+/g, " ").slice(0, 70)}`;

/** Ingest documents one by one, reporting progress. One bad document never stops the rest. */
export async function ingestAll(
  org: Org,
  mem: Memory,
  docs: IngestDoc[],
  send: (e: SyncEvent) => void,
  signal?: AbortSignal,
): Promise<Totals> {
  const totals = emptyTotals();
  send({ t: "total", total: docs.length });
  for (const [i, doc] of docs.entries()) {
    if (signal?.aborted) break;
    let outcome: string;
    try {
      const r = await ingestDocument(org, mem, doc);
      totals.read++;
      if (r.status !== "processed") {
        totals.skipped++;
        outcome = r.status === "duplicate" ? "already seen" : "nothing to read";
      } else {
        totals.added += r.added.length;
        totals.updated += r.updated.length;
        totals.confirmed += r.confirmed.length;
        totals.queued += r.queued.length;
        const bits = [
          r.added.length && `${r.added.length} new`,
          r.updated.length && `${r.updated.length} changed`,
          r.confirmed.length && `${r.confirmed.length} confirmed`,
          r.queued.length && `${r.queued.length} to review`,
        ].filter(Boolean);
        outcome = bits.length ? bits.join(", ") : "no durable facts";
      }
    } catch (e) {
      totals.failed++;
      outcome = `failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`;
    }
    send({ t: "item", done: i + 1, total: docs.length, label: label(doc), outcome, totals: { ...totals } });
  }
  return totals;
}

/** Wrap a job as a newline-delimited JSON stream so the browser can show live progress. */
export function streamJob(job: (send: (e: SyncEvent) => void) => Promise<Totals>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: SyncEvent) => {
        if (open) controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      };
      try {
        send({ t: "done", totals: await job(send) });
      } catch (e) {
        send({ t: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* client went away */
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
