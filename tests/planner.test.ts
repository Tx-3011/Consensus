import { describe, expect, it } from "vitest";
import { chooseFollowUpAction, normalizePlannerQuery, type PlannerClaimGap } from "../src/domain/planner";

const baseGap: PlannerClaimGap = {
  claimGroupId: "claim-group",
  proposition: "X improves sleep",
  evidenceScope: null,
  qualificationEvidenceIds: [],
  supportEvidenceIds: ["support-1"],
  hasObservedRoot: true,
  hasContradiction: false,
  expressedSurfaceCount: 3,
};

describe("Batch 5 deterministic planner", () => {
  it("prioritizes a named missing upstream source over counter-evidence", () => {
    const selected = chooseFollowUpAction([{ ...baseGap, evidenceScope: "small trial report", hasObservedRoot: false }], new Set());
    expect(selected?.actionType).toBe("find_upstream_source");
    expect(selected?.triggerEvidenceIds).toEqual(["support-1"]);
  });

  it("checks qualification gaps before looking for primary or contrary evidence", () => {
    const selected = chooseFollowUpAction([{ ...baseGap, qualificationEvidenceIds: ["qualification-span"] }], new Set());
    expect(selected?.actionType).toBe("check_qualification");
  });

  it("deduplicates normalized engine queries and falls through to no action", () => {
    const first = chooseFollowUpAction([baseGap], new Set());
    expect(first?.actionType).toBe("search_counter_evidence");
    const used = new Set([normalizePlannerQuery(`  ${first!.query.toLocaleUpperCase()}  `)]);
    expect(chooseFollowUpAction([baseGap], used)).toBeUndefined();
  });

  it("caps generated queries at 300 characters", () => {
    const selected = chooseFollowUpAction([{ ...baseGap, proposition: "x".repeat(500) }], new Set());
    expect(selected?.query.length).toBeLessThanOrEqual(300);
  });
});
