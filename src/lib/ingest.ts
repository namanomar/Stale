import { candidatesFor, extractClaims, numbers, reconcile, type Claim } from "./extract";
import { conflict } from "./errors";
import type { Memory } from "./memory";
import { createReview, decideReview, ingestRecord, ingestSeen, touchIntegration, type Org, type ReviewItem } from "./system";

export type DocKind = "slack" | "webhook" | "email" | "upload" | "manual" | "github" | "drive" | "jira" | "notion";

/** What every connector reduces its raw events to. */
export interface IngestDoc {
  kind: DocKind;
  integrationId?: string;
  /** Dedupe key within (workspace, kind): Slack channel+ts, email message-id, file hash... */
  externalId: string;
  /** Groups documents into one Source node, e.g. a Slack channel id. */
  sourceKey: string;
  sourceName: string;
  author?: string;
  url?: string;
  ts?: number;
  text: string;
  /** Connector's verdict: did this come from outside the company (guest, shared channel, bot, stranger)? */
  untrusted?: boolean;
  images?: { mime: string; base64: string }[];
}

export interface Evidence {
  quote: string;
  author?: string;
  url?: string;
  ts?: number;
  source: string;
  kind: DocKind;
  doc: string;
}

export interface IngestResult {
  status: "processed" | "duplicate" | "empty";
  engine: "llm" | "rules";
  claims: number;
  added: { id: string; statement: string; tainted: boolean }[];
  confirmed: { id: string; statement: string }[];
  updated: { id: string; previousId: string; statement: string; previous: string; impacted: number; actionsAtRisk: number }[];
  queued: { reviewId: string; statement: string; reason: string }[];
}

export interface ReviewPayload {
  op: "add" | "supersede";
  statement: string;
  claimKind: Claim["kind"];
  confidence: number;
  sourceId: string;
  sourceName: string;
  untrusted: boolean;
  targetId?: string;
  targetContent?: string;
  reason: string;
  risk: "untrusted-source" | "low-confidence" | "possible-conflict" | "policy";
  evidence: Evidence;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
export const sourceIdFor = (doc: Pick<IngestDoc, "kind" | "sourceKey">) => `src_${doc.kind}_${slug(doc.sourceKey)}`;

const MIN_AUTO_CONFIDENCE = 0.7;

export async function ingestDocument(org: Org, mem: Memory, doc: IngestDoc): Promise<IngestResult> {
  const empty = (status: IngestResult["status"]): IngestResult => ({
    status, engine: "rules", claims: 0, added: [], confirmed: [], updated: [], queued: [],
  });
  if (await ingestSeen(org.id, doc.kind, doc.externalId)) return empty("duplicate");
  if (doc.integrationId) await touchIntegration(doc.integrationId);
  if (!doc.text.trim() && !doc.images?.length) {
    await ingestRecord(org.id, doc.kind, doc.externalId, "empty", "no text");
    return empty("empty");
  }

  // Provenance first: every claim hangs off the Source of the place it was said.
  const sourceId = sourceIdFor(doc);
  if (!(await mem.hasSource(sourceId))) {
    await mem.addSource({
      id: sourceId,
      name: doc.sourceName,
      type: doc.kind,
      trust: doc.untrusted ? "untrusted" : "trusted",
    });
  }
  // A quarantined channel stays quarantined; a connector never talks a source back into trust.
  const sourceUntrusted = (await mem.getSource(sourceId)).trust === "untrusted" || !!doc.untrusted;

  const { claims, engine } = await extractClaims(doc);
  const result: IngestResult = { status: "processed", engine, claims: claims.length, added: [], confirmed: [], updated: [], queued: [] };
  const evidence: Evidence = {
    quote: "", author: doc.author, url: doc.url, ts: doc.ts ?? Date.now(), source: doc.sourceName, kind: doc.kind, doc: doc.externalId,
  };

  for (const claim of claims) {
    const ev = { ...evidence, quote: claim.quote };
    const nodes = (await mem.snapshot()).nodes;
    const cands = candidatesFor(claim, nodes);
    const rel = await reconcile(claim, cands);

    if (rel.relation === "same" && rel.targetId) {
      await mem.addEvidence(rel.targetId, ev);
      result.confirmed.push({ id: rel.targetId, statement: claim.statement });
      continue;
    }

    const meta = { claimKind: claim.kind, evidence: [ev] };

    if (rel.relation === "update" && rel.targetId) {
      const target = nodes.find((n) => n.id === rel.targetId)!;
      const auto = !sourceUntrusted && org.settings.autoApply === "trusted" && claim.confidence >= MIN_AUTO_CONFIDENCE;
      if (!auto) {
        const payload: ReviewPayload = {
          op: "supersede", statement: claim.statement, claimKind: claim.kind, confidence: claim.confidence,
          sourceId, sourceName: doc.sourceName, untrusted: sourceUntrusted,
          targetId: target.id, targetContent: target.content, reason: rel.reason,
          risk: sourceUntrusted ? "untrusted-source" : claim.confidence < MIN_AUTO_CONFIDENCE ? "low-confidence" : "policy",
          evidence: ev,
        };
        const item = await createReview(org.id, payload);
        result.queued.push({ reviewId: item.id, statement: claim.statement, reason: describeRisk(payload.risk) });
        continue;
      }
      const sup = await mem.supersede(target.id, {
        content: claim.statement, sourceId, reason: `${doc.sourceName}${doc.author ? ` (${doc.author})` : ""}: ${rel.reason}`,
        confidence: claim.confidence, meta,
      });
      result.updated.push({
        id: sup.node.id, previousId: target.id, statement: claim.statement, previous: target.content,
        impacted: sup.impacted.length, actionsAtRisk: sup.executedActionsAtRisk.length,
      });
      continue;
    }

    // Safety net independent of the model. A claim that is clearly about the same thing as existing
    // knowledge but carries different values is a conflict, whatever the model said, so a human decides.
    // From an outsider any difference counts; from a trusted source the number of values must match
    // too ("Pier 9" vs "Pier 9, capacity 200" is detail, "$100" vs "$140" is a contradiction).
    const top = cands[0];
    if (top && top.score >= 0.5) {
      const mine = numbers(claim.statement);
      const theirs = numbers(top.n.content);
      const same = mine.size === theirs.size && [...mine].every((x) => theirs.has(x));
      const clash = sourceUntrusted ? !same : mine.size > 0 && mine.size === theirs.size && !same;
      if (clash) {
        const risk = sourceUntrusted ? "untrusted-source" : "possible-conflict";
        const payload: ReviewPayload = {
          op: "supersede", statement: claim.statement, claimKind: claim.kind, confidence: claim.confidence,
          sourceId, sourceName: doc.sourceName, untrusted: sourceUntrusted,
          targetId: top.n.id, targetContent: top.n.content, reason: "Conflicts with something your team already knows",
          risk, evidence: ev,
        };
        const item = await createReview(org.id, payload);
        result.queued.push({ reviewId: item.id, statement: claim.statement, reason: describeRisk(risk) });
        continue;
      }
    }

    // New knowledge. Under an untrusted source it is stored tainted: remembered, but nothing can act on it.
    if (org.settings.autoApply !== "trusted" && !sourceUntrusted) {
      const payload: ReviewPayload = {
        op: "add", statement: claim.statement, claimKind: claim.kind, confidence: claim.confidence,
        sourceId, sourceName: doc.sourceName, untrusted: false, reason: rel.reason, risk: "policy", evidence: ev,
      };
      const item = await createReview(org.id, payload);
      result.queued.push({ reviewId: item.id, statement: claim.statement, reason: describeRisk("policy") });
      continue;
    }
    const { node } = await mem.addNode({ kind: "fact", content: claim.statement, sourceId, confidence: claim.confidence, meta });
    result.added.push({ id: node.id, statement: claim.statement, tainted: sourceUntrusted });
  }

  await ingestRecord(
    org.id, doc.kind, doc.externalId, "processed",
    `${result.added.length} new · ${result.updated.length} updated · ${result.confirmed.length} confirmed · ${result.queued.length} for review`,
  );
  return result;
}

export function describeRisk(r: ReviewPayload["risk"]) {
  return r === "untrusted-source"
    ? "Came from an untrusted source and would overwrite trusted knowledge"
    : r === "low-confidence"
      ? "The model was not confident enough to apply it automatically"
      : r === "possible-conflict"
        ? "Looks like it contradicts an existing fact, but the model was not sure it is the same thing"
        : "Your workspace requires approval for changes";
}

/** Approve or reject a queued change. Approving performs it (and cascades) through the same engine. */
export async function decideReviewItem(
  org: Org,
  mem: Memory,
  item: ReviewItem,
  decision: "approved" | "rejected",
  by: string,
) {
  const p = item.payload as ReviewPayload;
  let outcome: { impacted: number; actionsAtRisk: number; nodeId?: string } = { impacted: 0, actionsAtRisk: 0 };
  if (decision === "approved") {
    const meta = { claimKind: p.claimKind, evidence: [p.evidence], approvedBy: by };
    if (p.op === "supersede") {
      const target = await mem.getNode(p.targetId!);
      if (target.status !== "valid") {
        throw conflict("The memory this would replace has changed since it was queued. Reject this item and re-check.");
      }
      const sup = await mem.supersede(target.id, {
        content: p.statement, sourceId: p.sourceId, reason: `${p.sourceName}: approved by ${by}`, confidence: p.confidence, meta,
      });
      outcome = { impacted: sup.impacted.length, actionsAtRisk: sup.executedActionsAtRisk.length, nodeId: sup.node.id };
    } else {
      const { node } = await mem.addNode({ kind: "fact", content: p.statement, sourceId: p.sourceId, confidence: p.confidence, meta });
      outcome = { impacted: 0, actionsAtRisk: 0, nodeId: node.id };
    }
  }
  await decideReview(org.id, item.id, decision, by);
  return outcome;
}
