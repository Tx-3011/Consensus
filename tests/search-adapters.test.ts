import { describe, expect, it } from "vitest";
import { FixtureAdapter } from "../src/server/adapters/search/fixtures";
import { searchRequestSchema } from "../src/contracts/search";

describe("Batch 1 search contracts", () => {
  it("normalizes a labeled fixture with answer blocks and citation mappings", async () => {
    const request = searchRequestSchema.parse({
      question: "What is the capital of Australia?",
      surface: "google_ai_mode",
      locale: { hl: "en", gl: "us" },
    });
    const result = await new FixtureAdapter("google_ai_mode").search(request);
    expect(result.observation.schemaVersion).toBe("search-observation.v1");
    expect(result.observation.outcome).toBe("answer");
    expect(result.observation.blocks[0]?.referenceIndexes).toEqual([0, 1, 2]);
    expect(result.observation.citations).toHaveLength(3);
    expect(result.observation.warnings[0]).toMatch(/Fixture mode/);
    expect(result.rawResponses).toHaveLength(1);
  });

  it("rejects empty or oversized questions before provider dispatch", () => {
    expect(() => searchRequestSchema.parse({ question: "", surface: "bing_copilot", locale: { hl: "en", gl: "us" } })).toThrow();
    expect(() => searchRequestSchema.parse({ question: "x".repeat(1001), surface: "bing_copilot", locale: { hl: "en", gl: "us" } })).toThrow();
  });
});
