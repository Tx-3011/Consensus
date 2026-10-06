import { getModelAdapter } from "../src/server/adapters/model";
import { getConfig } from "../src/server/config";

async function main() {
  const config = getConfig();
  if (!config.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured; no model request was made.");
  const adapter = getModelAdapter("live");
  const result = await adapter.extractClaims("smoke-block", "A small trial found that X may improve sleep in older adults.");
  const support = await adapter.assessSupport({
    snapshotId: "smoke-snapshot",
    text: "The small randomized trial found that X improved sleep scores in adults aged 65 and older, although the sample was limited.",
    candidates: [{ occurrenceId: "smoke-claim", citationId: "smoke-citation", proposition: "X improves sleep", sourceQuote: "X may improve sleep in older adults", polarity: "positive", certainty: "tentative", population: "older adults", timeScope: null, units: null, denominator: null, conditions: null }],
  });
  console.log(JSON.stringify({ model: adapter.model, claims: result.value.claims.length, firstClaim: result.value.claims[0], extractionWarnings: result.warnings, support: support.value.assessments[0], supportWarnings: support.warnings }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
