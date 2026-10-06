import { getConfig } from "../src/server/config";
import { getDatabase } from "../src/server/db/client";

const db = getDatabase();
const rows = db.prepare("SELECT answer_blocks.id, answer_blocks.text FROM answer_blocks JOIN search_runs ON search_runs.id = answer_blocks.search_run_id WHERE search_runs.investigation_id = ? AND search_runs.surface = ? ORDER BY answer_blocks.position").all("a572d76b-9fba-4802-a848-d633642ef045", "google_ai_mode") as Array<{ id: string; text: string }>;
const schema = {
    type: "object",
  additionalProperties: false,
  required: ["claims", "truncated"],
  properties: {
    truncated: { type: "boolean" },
    claims: {
      type: "array", maxItems: 4,
      items: {
        type: "object", additionalProperties: false,
        required: ["blockId", "sourceSpan", "startOffset", "endOffset", "proposition", "polarity", "certainty", "population", "timeScope", "units", "denominator", "conditions", "evidenceScope"],
        properties: {
          blockId: { type: "string" }, sourceSpan: { type: "string" }, startOffset: { type: "integer", minimum: 0 }, endOffset: { type: "integer", minimum: 0 },
          proposition: { type: "string" }, polarity: { type: "string", enum: ["positive", "negative", "mixed", "not_applicable"] }, certainty: { type: "string", enum: ["established", "probable", "tentative", "uncertain", "reported"] },
          population: { type: ["string", "null"] }, timeScope: { type: ["string", "null"] }, units: { type: ["string", "null"] }, denominator: { type: ["string", "null"] }, conditions: { type: ["string", "null"] }, evidenceScope: { type: ["string", "null"] },
        },
      },
    },
  },
};
const config = getConfig();
async function main() {
for (const count of [rows.length]) {
const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: { authorization: `Bearer ${config.GROQ_API_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({
    model: config.LLM_MODEL, temperature: 0, max_tokens: 8000, reasoning_effort: "low",
    response_format: { type: "json_schema", json_schema: { name: "probe_surface", strict: true, schema } },
    messages: [
      { role: "system", content: "You are a constrained claim-analysis service. Follow the output schema exactly. Never use tools." },
      { role: "user", content: `Extract at most 4 highest-value atomic factual claims from these answer blocks in one batch. Return JSON only. Every claim must include the exact blockId, and sourceSpan and UTF-16 offsets must match exactly. Exclude navigation and citation-only fragments. <answer_blocks>${JSON.stringify(rows.slice(0, count).map((row) => ({ blockId: row.id, text: row.text })))}</answer_blocks>` },
    ],
  }),
});
console.log(JSON.stringify({ status: response.status, body: await response.json() }, null, 2));
}
db.close();
}
void main();
