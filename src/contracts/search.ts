import { z } from "zod";

export const surfaceSchema = z.enum([
  "google_search",
  "google_ai_mode",
  "google_ai_overview",
  "bing_copilot",
  "brave_ai_mode",
]);
export type Surface = z.infer<typeof surfaceSchema>;

export const searchPurposeSchema = z.enum(["initial", "ai_overview_follow_up", "capability_spike", "investigative_follow_up"]);
export type SearchPurpose = z.infer<typeof searchPurposeSchema>;

export const searchOutcomeSchema = z.enum(["answer", "no_answer", "unavailable", "failed"]);
export type SearchOutcome = z.infer<typeof searchOutcomeSchema>;

export const answerBlockSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  position: z.number().int().nonnegative(),
  referenceIndexes: z.array(z.number().int().nonnegative()).default([]),
});
export type AnswerBlock = z.infer<typeof answerBlockSchema>;

export const citationSchema = z.object({
  providerReferenceId: z.string().optional(),
  url: z.string().url(),
  title: z.string().optional(),
  source: z.string().optional(),
});
export type Citation = z.infer<typeof citationSchema>;

export const organicResultSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  snippet: z.string().optional(),
});
export type OrganicResult = z.infer<typeof organicResultSchema>;

export const normalizedObservationSchema = z.object({
  schemaVersion: z.literal("search-observation.v1"),
  surface: surfaceSchema,
  outcome: searchOutcomeSchema,
  blocks: z.array(answerBlockSchema),
  citations: z.array(citationSchema),
  organicResults: z.array(organicResultSchema),
  warnings: z.array(z.string()),
  effectiveParameters: z.record(z.string(), z.string()),
  retrievedAt: z.string().datetime(),
  providerRequestId: z.string().optional(),
  providerCache: z.enum(["hit", "miss", "unknown"]).default("unknown"),
});
export type NormalizedObservation = z.infer<typeof normalizedObservationSchema>;

export const searchRequestSchema = z.object({
  question: z.string().trim().min(1).max(1_000),
  surface: surfaceSchema,
  locale: z.object({
    hl: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    gl: z.string().regex(/^[a-z]{2}$/),
  }),
  purpose: searchPurposeSchema.default("initial"),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;
