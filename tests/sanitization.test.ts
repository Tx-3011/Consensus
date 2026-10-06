import { describe, expect, it } from "vitest";
import { sanitizeProviderPayload } from "../src/server/db/repositories";
import { buildInvestigationExport } from "../src/server/exports/investigation";

describe("secret sanitization", () => {
  const unsafe = {
    apiKey: "key-one", authorization: "Bearer key-two", nested: { access_token: "key-three" },
    providerUrl: "https://example.test/search?q=x&api_key=key-four&token=key-five",
  };

  it("redacts stored provider payloads recursively", () => {
    const serialized = JSON.stringify(sanitizeProviderPayload(unsafe));
    for (const secret of ["key-one", "key-two", "key-three", "key-four", "key-five"]) expect(serialized).not.toContain(secret);
  });

  it("redacts export fields defensively", () => {
    const serialized = JSON.stringify(buildInvestigationExport(unsafe));
    for (const secret of ["key-one", "key-two", "key-three", "key-four", "key-five"]) expect(serialized).not.toContain(secret);
  });
});
