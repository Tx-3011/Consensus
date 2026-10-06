import type { ClaimExtractionOutput, ClaimRelationProposal, ExtractedClaim, SurfaceClaimExtractionOutput } from "../../../contracts/claims";
import type { SupportAssessment } from "../../../contracts/provenance";

export type ModelAttemptState = "completed" | "unknown_outcome";

export interface ModelAttemptObserver {
  start(parameterHash: string, budget: unknown): string;
  finish(attemptId: string, outcome: string, providerRequestId: string | undefined, usage: unknown, state?: ModelAttemptState): void;
}

export interface ModelAdapter {
  readonly model: string;
  extractClaims(blockId: string, text: string, observer?: ModelAttemptObserver): Promise<ModelAnalysisResult<ClaimExtractionOutput>>;
  extractSurfaceClaims(blocks: Array<{ id: string; text: string }>, observer?: ModelAttemptObserver): Promise<ModelAnalysisResult<SurfaceClaimExtractionOutput>>;
  alignClaims(pairs: ClaimAlignmentPair[], observer?: ModelAttemptObserver): Promise<ModelAnalysisResult<{ relations: ClaimRelationProposal[] }>>;
  assessSupport(input: SupportAssessmentInput, observer?: ModelAttemptObserver): Promise<ModelAnalysisResult<{ assessments: SupportAssessment[] }>>;
}

export type ModelAnalysisResult<T> = {
  value: T;
  rawResponses: unknown[];
  warnings: string[];
};

export type ClaimAlignmentCandidate = ExtractedClaim & {
  id: string;
  surface: string;
  blockId: string;
};

export type ClaimAlignmentPair = {
  left: ClaimAlignmentCandidate;
  right: ClaimAlignmentCandidate;
};

export type SupportAssessmentInput = {
  snapshotId: string;
  text: string;
  candidates: Array<{
    occurrenceId: string;
    citationId: string;
    proposition: string;
    sourceQuote: string;
    polarity: string;
    certainty: string;
    population: string | null;
    timeScope: string | null;
    units: string | null;
    denominator: string | null;
    conditions: string | null;
  }>;
};
