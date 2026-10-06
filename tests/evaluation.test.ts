import { describe, expect, it } from "vitest";
import { runEvaluationSet, summarizeEvaluation } from "../src/domain/evaluation";

describe("Batch 7 precision evaluation", () => {
  it("passes every contrasting case without false dependency merges", () => {
    const results = runEvaluationSet();
    const summary = summarizeEvaluation(results);
    expect(results.map((result) => result.id)).toEqual([
      "reprints", "shared-dataset", "distinct-studies", "similar-language", "missing-qualifier", "inaccessible", "denominators", "independent-agreement",
    ]);
    expect(summary).toEqual({ cases: 8, passed: 8, falseDependencyMerges: 0, missedExplicitDependencies: 0, inspectableEvidencePercent: 87.5 });
  });
});
