import { z } from "zod";
import { KINDS } from "./types";

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/, "id must match [A-Za-z0-9_.:-]{1,64}");

export const sourceInput = z.object({
  id: id.optional(),
  name: z.string().min(1).max(200),
  type: z.string().max(40).optional(),
  trust: z.enum(["trusted", "untrusted"]).optional(),
});

export const nodeInput = z.object({
  id: id.optional(),
  kind: z.enum(KINDS),
  content: z.string().min(1).max(4000),
  dependsOn: z.array(id).max(50).optional(),
  sourceId: id.optional(),
  confidence: z.number().min(0).max(1).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const supersedeInput = z.object({
  content: z.string().min(1).max(4000),
  reason: z.string().max(500).optional(),
  sourceId: id.optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const resolveInput = z.object({
  content: z.string().min(1).max(4000).optional(),
  note: z.string().max(500).optional(),
});

export const trustInput = z.object({
  trust: z.enum(["trusted", "untrusted"]),
  reason: z.string().max(500).optional(),
});

export const approveInput = z.object({
  approver: z.string().min(1).max(100),
  note: z.string().max(500).optional(),
});
