import { describe, expect, it } from "vitest";
import { FixtureModelAdapter } from "../src/server/adapters/model/fixtures";
import { buildClaimGroups, canAcceptEquivalent, proposeClaimPairs, type ClaimOccurrenceLike } from "../src/domain/claims";

function claim(overrides: Partial<ClaimOccurrenceLike> = {}): ClaimOccurrenceLike {
  return {
    id: "claim-a",
    blockId: "block-a",
    surface: "google_ai_mode",
    sourceSpan: "A small trial found that X may improve sleep in older adults.",
    startOffset: 0,
    endOffset: 57,
    proposition: "X improves sleep",
    polarity: "positive",
    certainty: "tentative",
    population: "older adults",
    timeScope: null,
    units: null,
    denominator: null,
    conditions: null,
    evidenceScope: "small trial",
    ...overrides,
  };
}

describe("Batch 3 claim alignment", () => {
  it("extracts an exact UTF-16 span in fixture mode without a provider call", async () => {
    const text = "A small trial found that X may improve sleep in older adults.";
    const result = await new FixtureModelAdapter().extractClaims("block-a", text);
    expect(result.value.claims[0]).toMatchObject({ startOffset: 0, endOffset: text.length, sourceSpan: text });
    expect(result.warnings[0]).toMatch(/no Groq request/);
  });

  it("keeps qualification and population mismatches out of equivalent groups", () => {
    const tentative = claim();
    const established = claim({ id: "claim-b", blockId: "block-b", surface: "bing_copilot", certainty: "established" });
    const differentPopulation = claim({ id: "claim-c", blockId: "block-c", surface: "brave_ai_mode", population: "all adults" });
    expect(canAcceptEquivalent(tentative, established, "equivalent")).toBe(false);
    expect(canAcceptEquivalent(tentative, differentPopulation, "equivalent")).toBe(false);
    expect(buildClaimGroups([tentative, established, differentPopulation], [{ left: tentative, right: established }, { left: tentative, right: differentPopulation }])).toHaveLength(3);
  });

  it("requires direct compatibility with every group member instead of transitive merging", () => {
    const first = claim();
    const second = claim({ id: "claim-b", blockId: "block-b", surface: "bing_copilot" });
    const third = claim({ id: "claim-c", blockId: "block-c", surface: "brave_ai_mode", evidenceScope: "large observational study" });
    const groups = buildClaimGroups([first, second, third], [{ left: first, right: second }, { left: second, right: third }]);
    expect(groups.map((group) => group.memberIds)).toEqual([["claim-a", "claim-b"], ["claim-c"]]);
  });

  it("proposes pairs only across answer surfaces with deterministic token overlap", () => {
    const first = claim();
    const second = claim({ id: "claim-b", blockId: "block-b", surface: "bing_copilot" });
    const sameSurface = claim({ id: "claim-c", blockId: "block-c", surface: "bing_copilot" });
    const pairs = proposeClaimPairs([first, second, sameSurface]);
    expect(pairs).toHaveLength(2);
    expect(pairs.some((pair) => pair.left.id === "claim-b" && pair.right.id === "claim-c")).toBe(false);
  });
});
