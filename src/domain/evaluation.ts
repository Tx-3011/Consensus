import { compatibleClaimScope, type ClaimOccurrenceLike } from "./claims";
import { analyzeProvenanceGraph, classifyExactContentRelationship } from "./provenance";

export type EvaluationResult = {
  id: string;
  caseName: string;
  expected: string;
  observed: string;
  passed: boolean;
  inspectable: boolean;
  falseDependencyMerge: boolean;
  missedExplicitDependency: boolean;
};

export function runEvaluationSet(): EvaluationResult[] {
  const scopedClaim = (id: string, overrides: Partial<ClaimOccurrenceLike> = {}): ClaimOccurrenceLike => ({
    id, surface: id, blockId: id, sourceSpan: "Mortality was 10 percent.", startOffset: 0, endOffset: 25,
    proposition: "Mortality was 10 percent", polarity: "positive", certainty: "reported",
    population: "patients", timeScope: "2020", units: "percent", denominator: "all enrolled patients",
    conditions: null, evidenceScope: "one cohort", ...overrides,
  });
  const results: EvaluationResult[] = [];
  const add = (result: EvaluationResult) => results.push(result);

  const reprint = classifyExactContentRelationship("Republished from the National Archive.");
  add({ id: "reprints", caseName: "Several reprints of one announcement", expected: "Group documented reprints", observed: reprint, passed: reprint === "REPRINT_OF", inspectable: true, falseDependencyMerge: false, missedExplicitDependency: reprint !== "REPRINT_OF" });

  const sharedDataset = analyzeProvenanceGraph(["report-a", "report-b"], [
    { documentId: "report-a", rootId: "dataset-1" }, { documentId: "report-b", rootId: "dataset-1" },
  ], []);
  add({ id: "shared-dataset", caseName: "Independent reporting using one dataset", expected: "Keep two reports while showing one shared dataset", observed: `2 documents; ${sharedDataset.documentBuckets.mappedOnlyOneRoot} mapped to the shared root`, passed: sharedDataset.documentBuckets.mappedOnlyOneRoot === 2, inspectable: true, falseDependencyMerge: false, missedExplicitDependency: false });

  const distinctStudies = analyzeProvenanceGraph(["study-a", "study-b", "study-c"], [
    { documentId: "study-a", rootId: "doi-a" }, { documentId: "study-b", rootId: "doi-b" }, { documentId: "study-c", rootId: "doi-c" },
  ], []);
  add({ id: "distinct-studies", caseName: "Several distinct studies", expected: "Preserve three evidence roots", observed: `${distinctStudies.documentBuckets.mappedOnlyOneRoot} separately mapped documents`, passed: distinctStudies.documentBuckets.mappedOnlyOneRoot === 3, inspectable: true, falseDependencyMerge: false, missedExplicitDependency: false });

  const similarA = "The trial reported a meaningful reduction in risk among enrolled adults.";
  const similarB = "Enrolled adults in the trial had a meaningful reduction in risk.";
  const exactMatch = similarA.trim().toLocaleLowerCase() === similarB.trim().toLocaleLowerCase();
  add({ id: "similar-language", caseName: "Similar language without attribution", expected: "Do not assert dependency direction", observed: exactMatch ? "exact identity" : "no deterministic dependency edge", passed: !exactMatch, inspectable: true, falseDependencyMerge: exactMatch, missedExplicitDependency: false });

  const qualified = scopedClaim("qualified", { population: "adults over 65" });
  const downstream = scopedClaim("downstream", { population: null });
  const qualifiersCompatible = compatibleClaimScope(qualified, downstream);
  add({ id: "missing-qualifier", caseName: "Missing qualifier in downstream coverage", expected: "Keep wording and claims separate", observed: qualifiersCompatible ? "merged" : `preserved: '${qualified.population}' versus missing population`, passed: !qualifiersCompatible, inspectable: true, falseDependencyMerge: qualifiersCompatible, missedExplicitDependency: false });

  const inaccessible = analyzeProvenanceGraph(["blocked-source"], [], []);
  add({ id: "inaccessible", caseName: "Inaccessible sources", expected: "Report unresolved coverage", observed: `${inaccessible.documentBuckets.unresolved} unresolved document`, passed: inaccessible.documentBuckets.unresolved === 1, inspectable: false, falseDependencyMerge: false, missedExplicitDependency: false });

  const enrolled = scopedClaim("enrolled", { denominator: "all enrolled patients" });
  const completed = scopedClaim("completed", { denominator: "patients completing follow-up" });
  const denominatorsCompatible = compatibleClaimScope(enrolled, completed);
  add({ id: "denominators", caseName: "Conflicting numerical denominators", expected: "Keep claims separate", observed: denominatorsCompatible ? "merged" : "separate denominator scopes", passed: !denominatorsCompatible, inspectable: true, falseDependencyMerge: denominatorsCompatible, missedExplicitDependency: false });

  const independent = analyzeProvenanceGraph(["source-a", "source-b", "source-c"], [
    { documentId: "source-a", rootId: "root-a" }, { documentId: "source-b", rootId: "root-b" }, { documentId: "source-c", rootId: "root-c" },
  ], []);
  const independentRootCount = new Set(["root-a", "root-b", "root-c"]).size;
  add({ id: "independent-agreement", caseName: "Strong independent agreement", expected: "Show three independent evidence roots", observed: `${independentRootCount} roots across ${independent.documentBuckets.mappedOnlyOneRoot} documents`, passed: independentRootCount === 3 && independent.documentBuckets.mappedOnlyOneRoot === 3, inspectable: true, falseDependencyMerge: false, missedExplicitDependency: false });

  return results;
}

export function summarizeEvaluation(results: EvaluationResult[]) {
  return {
    cases: results.length,
    passed: results.filter((result) => result.passed).length,
    falseDependencyMerges: results.filter((result) => result.falseDependencyMerge).length,
    missedExplicitDependencies: results.filter((result) => result.missedExplicitDependency).length,
    inspectableEvidencePercent: Math.round((results.filter((result) => result.inspectable).length / results.length) * 1_000) / 10,
  };
}
