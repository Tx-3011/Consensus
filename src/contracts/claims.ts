import { z } from "zod";

export const claimPolaritySchema = z.enum(["positive", "negative", "mixed", "not_applicable"]);
export type ClaimPolarity = z.infer<typeof claimPolaritySchema>;

export const claimCertaintySchema = z.enum(["established", "probable", "tentative", "uncertain", "reported"]);
export type ClaimCertainty = z.infer<typeof claimCertaintySchema>;

const nullableText = z.string().trim().nullable().default(null);

export const extractedClaimSchema = z.object({
  sourceSpan: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  proposition: z.string().trim().min(1),
  polarity: claimPolaritySchema,
  certainty: claimCertaintySchema,
  population: nullableText,
  timeScope: nullableText,
  units: nullableText,
  denominator: nullableText,
  conditions: nullableText,
  evidenceScope: nullableText,
});
export type ExtractedClaim = z.infer<typeof extractedClaimSchema>;

export const claimExtractionOutputSchema = z.object({
  claims: z.array(extractedClaimSchema).max(20),
  truncated: z.boolean().default(false),
});
export type ClaimExtractionOutput = z.infer<typeof claimExtractionOutputSchema>;

export const surfaceClaimExtractionOutputSchema = z.object({
  claims: z.array(extractedClaimSchema.extend({ blockId: z.string().min(1) })).max(4),
  truncated: z.boolean().default(false),
});
export type SurfaceClaimExtractionOutput = z.infer<typeof surfaceClaimExtractionOutputSchema>;

export const claimRelationTypeSchema = z.enum(["equivalent", "narrower", "broader", "conflicting", "unrelated", "uncertain"]);
export type ClaimRelationType = z.infer<typeof claimRelationTypeSchema>;

export const claimRelationProposalSchema = z.object({
  leftId: z.string().min(1),
  rightId: z.string().min(1),
  relation: claimRelationTypeSchema,
  rationale: z.string().trim().min(1),
});

export const claimRelationOutputSchema = z.object({
  relations: z.array(claimRelationProposalSchema).max(120),
});
export type ClaimRelationProposal = z.infer<typeof claimRelationProposalSchema>;

export const claimExtractionVersions = {
  schema: "claim-occurrence.v1",
  extraction: "claim-extraction.v1",
  prompt: "claim-extraction-prompt.v1",
  alignment: "claim-alignment.v1",
  alignmentPrompt: "claim-alignment-prompt.v1",
} as const;
