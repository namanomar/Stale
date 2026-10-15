export const KINDS = ["fact", "belief", "decision", "action"] as const;
export type Kind = (typeof KINDS)[number];
export type Status = "valid" | "stale" | "superseded";
export type Trust = "trusted" | "untrusted";

export interface NodeRec {
  id: string;
  kind: Kind;
  content: string;
  status: Status;
  confidence: number;
  created_at: number;
  updated_at: number;
  stale_root?: string;
  stale_reason?: string;
  stale_depth?: number;
  gate?: "allowed" | "blocked" | "approved";
  approved_by?: string;
  approval_note?: string;
  executed_at?: number;
  approved_sig?: string;
  meta?: Record<string, unknown>;
}

export interface SourceRec {
  id: string;
  name: string;
  type: string;
  trust: Trust;
  created_at: number;
  trust_reason?: string;
}

export interface EdgeRec {
  from: string;
  to: string;
  type: "DEPENDS_ON" | "FROM" | "SUPERSEDES";
}

export interface ImpactItem {
  id: string;
  kind: Kind;
  content: string;
  status: Status;
  depth: number;
  executed: boolean;
}

export interface GateReason {
  type: "tainted" | "stale";
  /** Path from the checked node down to the offending ancestor / source. */
  path: { id: string; label: string }[];
  source?: string;
}

export interface GateVerdict {
  id: string;
  allowed: boolean;
  tainted: boolean;
  stale: boolean;
  reasons: GateReason[];
}
