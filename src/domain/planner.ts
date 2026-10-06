import type { PlannerCandidate } from "../contracts/planner";

export type PlannerClaimGap = {
  claimGroupId: string;
  proposition: string;
  evidenceScope: string | null;
  qualificationEvidenceIds: string[];
  supportEvidenceIds: string[];
  hasObservedRoot: boolean;
  hasContradiction: boolean;
  expressedSurfaceCount: number;
};

export function chooseFollowUpAction(gaps: PlannerClaimGap[], usedQueries: Set<string>): PlannerCandidate | undefined {
  const ranked = [...gaps].sort((left, right) => right.expressedSurfaceCount - left.expressedSurfaceCount || left.claimGroupId.localeCompare(right.claimGroupId));
  for (const gap of ranked) {
    if (gap.evidenceScope && /\b(study|report|dataset|trial)\b/i.test(gap.evidenceScope) && !gap.hasObservedRoot) {
      const candidate = action(gap, "find_upstream_source", `${gap.evidenceScope} ${gap.proposition}`, "A specifically described upstream evidence item has not been identified.", "high", gap.supportEvidenceIds);
      if (!usedQueries.has(normalizePlannerQuery(candidate.query))) return candidate;
    }
  }
  for (const gap of ranked) {
    if (gap.qualificationEvidenceIds.length) {
      const candidate = action(gap, "check_qualification", `"${gap.proposition}" study report qualification`, "Inspected evidence supports a qualified variant that warrants targeted checking.", "high", gap.qualificationEvidenceIds);
      if (!usedQueries.has(normalizePlannerQuery(candidate.query))) return candidate;
    }
  }
  for (const gap of ranked) {
    if (gap.supportEvidenceIds.length && !gap.hasObservedRoot) {
      const candidate = action(gap, "find_primary_evidence", `"${gap.proposition}" study DOI`, "Only secondary support is currently mapped; primary evidence has not been identified.", "medium", gap.supportEvidenceIds);
      if (!usedQueries.has(normalizePlannerQuery(candidate.query))) return candidate;
    }
  }
  for (const gap of ranked) {
    if (!gap.hasContradiction) {
      const candidate = action(gap, "search_counter_evidence", `"${gap.proposition}" conflicting evidence`, "The most-expressed claim has no inspected contrary evidence.", "medium", gap.supportEvidenceIds);
      if (!usedQueries.has(normalizePlannerQuery(candidate.query))) return candidate;
    }
  }
  return undefined;
}

export function normalizePlannerQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function action(
  gap: PlannerClaimGap,
  actionType: PlannerCandidate["actionType"],
  rawQuery: string,
  reason: string,
  expectedGain: PlannerCandidate["expectedGain"],
  triggerEvidenceIds: string[],
): PlannerCandidate {
  return {
    claimGroupId: gap.claimGroupId,
    proposition: gap.proposition,
    triggerEvidenceIds,
    actionType,
    query: rawQuery.slice(0, 300),
    reason,
    expectedGain,
  };
}
