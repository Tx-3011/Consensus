import { z } from "zod";

export const supportStatusSchema = z.enum(["supports", "qualifies", "contradicts", "not_found", "unresolved"]);
export type SupportStatus = z.infer<typeof supportStatusSchema>;

export const supportAssessmentSchema = z.object({
  occurrenceId: z.string().min(1),
  citationId: z.string().min(1),
  status: supportStatusSchema,
  evidenceQuote: z.string(),
  startOffset: z.number().int().nonnegative().nullable(),
  endOffset: z.number().int().nonnegative().nullable(),
  rationale: z.string().trim().min(1),
});

export const supportAssessmentOutputSchema = z.object({
  assessments: z.array(supportAssessmentSchema).max(60),
});
export type SupportAssessment = z.infer<typeof supportAssessmentSchema>;

export const snapshotOutcomeSchema = z.enum(["fetched", "unsupported", "blocked", "failed"]);
export type SnapshotOutcome = z.infer<typeof snapshotOutcomeSchema>;

export const relationshipTypeSchema = z.enum(["SAME_DOCUMENT", "REPRINT_OF", "EXPLICITLY_CITES", "SHARES_WORDING", "USES_EVIDENCE"]);
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;

export const evidenceRootTypeSchema = z.enum(["study", "dataset", "report", "interview", "other"]);
export type EvidenceRootType = z.infer<typeof evidenceRootTypeSchema>;
