import type { ModelAdapter } from "./adapter";
import { FixtureModelAdapter } from "./fixtures";
import { GroqModelAdapter } from "./groq";

export function getModelAdapter(mode: "live" | "fixture"): ModelAdapter {
  return mode === "fixture" ? new FixtureModelAdapter() : new GroqModelAdapter();
}

export type { ClaimAlignmentCandidate, ClaimAlignmentPair, ModelAdapter, ModelAnalysisResult, ModelAttemptObserver, SupportAssessmentInput } from "./adapter";
