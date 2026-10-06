import { describe, expect, it } from "vitest";
import { normalizeResponse } from "../src/server/adapters/search/serpapi";

const params = { engine: "test", q: "test", hl: "en", gl: "us" };

describe("SerpApi documented response shapes", () => {
  it("reads Google AI Overview blocks and references from the nested ai_overview object", () => {
    const result = normalizeResponse("google_ai_overview", {
      search_metadata: { status: "Success" },
      ai_overview: {
        text_blocks: [{ type: "paragraph", snippet: "A nested overview answer.", reference_indexes: [0] }],
        references: [{ index: 0, title: "Source", link: "https://example.com/source", source: "Example" }],
      },
    }, params, "request-1", "unknown", []);
    expect(result.outcome).toBe("answer");
    expect(result.blocks[0]?.text).toBe("A nested overview answer.");
    expect(result.citations[0]?.url).toBe("https://example.com/source");
  });

  it("flattens Brave segments and preserves reference_index citations", () => {
    const result = normalizeResponse("brave_ai_mode", {
      search_metadata: { status: "Success" },
      text_blocks: [{ type: "paragraph", segments: [{ snippet: "A segmented answer.", citations: [{ reference_index: 0 }] }] }],
      references: [{ index: 0, title: "Source", link: "https://example.com/source" }],
    }, params, "request-2", "unknown", []);
    expect(result.outcome).toBe("answer");
    expect(result.blocks[0]?.referenceIndexes).toEqual([0]);
  });

  it("treats documented provider error status as failed", () => {
    const result = normalizeResponse("bing_copilot", { search_metadata: { status: "Error" } }, params, undefined, "unknown", []);
    expect(result.outcome).toBe("failed");
  });
});
