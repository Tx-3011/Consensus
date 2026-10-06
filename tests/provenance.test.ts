import { describe, expect, it } from "vitest";
import { analyzeProvenanceGraph, classifyExactContentRelationship } from "../src/domain/provenance";

describe("Batch 4 provenance accounting", () => {
  it("keeps overlapping roots separate and preserves disjoint document buckets", () => {
    const result = analyzeProvenanceGraph(["a", "b", "c"], [
      { documentId: "a", rootId: "report-a" },
      { documentId: "b", rootId: "report-a" },
      { documentId: "b", rootId: "study-b" },
    ], []);
    expect(result.documentBuckets).toEqual({ mappedOnlyOneRoot: 1, mappedMultipleRoots: 1, unresolved: 1 });
    expect(Object.values(result.documentBuckets).reduce((sum, value) => sum + value, 0)).toBe(3);
  });

  it("detects document citation cycles without turning the component into one evidence root", () => {
    const result = analyzeProvenanceGraph(["a", "b", "c"], [], [
      { fromDocumentId: "a", toDocumentId: "b" },
      { fromDocumentId: "b", toDocumentId: "c" },
      { fromDocumentId: "c", toDocumentId: "a" },
    ]);
    expect(result.cycles).toEqual(["a -> b -> c -> a"]);
    expect(result.documentBuckets.unresolved).toBe(3);
  });

  it("requires explicit republication language before treating exact text as a directed reprint", () => {
    expect(classifyExactContentRelationship("The same article text without attribution.")).toBe("SAME_DOCUMENT");
    expect(classifyExactContentRelationship("Originally published by Example News. The same article text.")).toBe("REPRINT_OF");
  });
});
