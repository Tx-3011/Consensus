import { claimExtractionOutputSchema } from "../../../contracts/claims";
import type { ClaimAlignmentPair, ModelAdapter, ModelAnalysisResult, SupportAssessmentInput } from "./adapter";

export class FixtureModelAdapter implements ModelAdapter {
  readonly model = "fixture-claim-model.v1";

  async extractClaims(_blockId: string, text: string): Promise<ModelAnalysisResult<ReturnType<typeof claimExtractionOutputSchema.parse>>> {
    const value = claimExtractionOutputSchema.parse({
      truncated: false,
      claims: [{
        sourceSpan: text,
        startOffset: 0,
        endOffset: text.length,
        proposition: text,
        polarity: "not_applicable",
        certainty: "reported",
        population: null,
        timeScope: null,
        units: null,
        denominator: null,
        conditions: null,
        evidenceScope: "labeled fixture answer block",
      }],
    });
    return { value, rawResponses: [{ fixture: true, claims: value.claims }], warnings: ["Fixture model: no Groq request was made."] };
  }

  async extractSurfaceClaims(blocks: Array<{ id: string; text: string }>) {
    const claims = blocks.filter((block) => block.text.trim()).map((block) => ({
      blockId: block.id, sourceSpan: block.text, startOffset: 0, endOffset: block.text.length,
      proposition: block.text, polarity: "not_applicable" as const, certainty: "reported" as const,
      population: null, timeScope: null, units: null, denominator: null, conditions: null,
      evidenceScope: "labeled fixture answer block",
    })).slice(0, 20);
    return { value: { claims, truncated: blocks.length > claims.length }, rawResponses: [{ fixture: true, claims }], warnings: ["Fixture model: no Groq request was made."] };
  }

  async alignClaims(_pairs: ClaimAlignmentPair[]): Promise<ModelAnalysisResult<{ relations: [] }>> {
    const relations: [] = [];
    // Fixture answers intentionally remain separate: no synthetic agreement is inferred offline.
    return { value: { relations }, rawResponses: [{ fixture: true, relations }], warnings: ["Fixture model did not infer cross-surface equivalence."] };
  }

  async assessSupport(input: SupportAssessmentInput): Promise<ModelAnalysisResult<{ assessments: Array<{ occurrenceId: string; citationId: string; status: "supports" | "contradicts" | "not_found"; evidenceQuote: string; startOffset: number | null; endOffset: number | null; rationale: string }> }>> {
    const assessments = input.candidates.map((candidate) => {
      const contradicts = /\b(no improvement|did not improve|contradicts)\b/i.test(input.text);
      if (contradicts) {
        const nextPeriod = input.text.indexOf(".");
        const endOffset = nextPeriod < 0 ? input.text.length : nextPeriod + 1;
        return { occurrenceId: candidate.occurrenceId, citationId: candidate.citationId, status: "contradicts" as const, evidenceQuote: input.text.slice(0, endOffset), startOffset: 0, endOffset, rationale: "The inspected fixture reports a contrary result." };
      }
      const distinctive = candidate.proposition.split(/\s+/).filter((token) => token.length >= 5).find((token) => input.text.toLocaleLowerCase().includes(token.toLocaleLowerCase()));
      if (!distinctive) return { occurrenceId: candidate.occurrenceId, citationId: candidate.citationId, status: "not_found" as const, evidenceQuote: "", startOffset: null, endOffset: null, rationale: "No matching claim language was found in the inspected fixture text." };
      const startOffset = input.text.toLocaleLowerCase().indexOf(distinctive.toLocaleLowerCase());
      const sentenceStart = Math.max(0, input.text.lastIndexOf(".", startOffset - 1) + 1);
      const nextPeriod = input.text.indexOf(".", startOffset);
      const endOffset = nextPeriod < 0 ? input.text.length : nextPeriod + 1;
      return { occurrenceId: candidate.occurrenceId, citationId: candidate.citationId, status: "supports" as const, evidenceQuote: input.text.slice(sentenceStart, endOffset).trimStart(), startOffset: sentenceStart + (input.text.slice(sentenceStart, endOffset).length - input.text.slice(sentenceStart, endOffset).trimStart().length), endOffset, rationale: "A matching statement was located in the inspected fixture text." };
    });
    return { value: { assessments }, rawResponses: [{ fixture: true, assessments }], warnings: ["Fixture model: support labels are deterministic test data."] };
  }
}
