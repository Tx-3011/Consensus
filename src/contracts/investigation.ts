import { z } from "zod";
import { surfaceSchema } from "./search";

export const localeSchema = z.object({
  hl: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("en"),
  gl: z.string().regex(/^[a-z]{2}$/).default("us"),
});

export const investigationCreateSchema = z.object({
  question: z.string().trim().min(1).max(1_000),
  locale: localeSchema.default({ hl: "en", gl: "us" }),
  surfaces: z.array(surfaceSchema).min(1).max(5).default(["google_ai_mode", "bing_copilot", "brave_ai_mode"]),
  mode: z.enum(["live", "fixture"]).default("fixture"),
});
export type InvestigationCreateInput = z.infer<typeof investigationCreateSchema>;

export const investigationStatusSchema = z.enum(["created", "collecting", "analyzing", "tracing", "following_up", "finalizing", "complete", "partial", "failed", "cancelled"]);
export type InvestigationStatus = z.infer<typeof investigationStatusSchema>;
