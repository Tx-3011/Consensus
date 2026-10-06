import { describe, expect, it } from "vitest";
import { escapeHtml, renderInvestigationHtml } from "../src/server/exports/investigation";

describe("Batch 6 static export", () => {
  it("escapes untrusted strings and rejects unsafe link schemes", () => {
    const html = renderInvestigationHtml({
      question: "<script>alert('x')</script>", status: "complete", evidenceAccounting: {},
      claims: [{ proposition: "<img src=x onerror=alert(1)>", source_quote: "quoted & exact", surface: "fixture" }],
      documents: [{ normalized_url: "javascript:alert(1)", title: "Unsafe" }], followUps: [],
    });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("href=\"#\"");
    expect(escapeHtml(`&<>\"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
