import { getSearchAdapter } from "../adapters/search";
import { getDatabase } from "../db/client";
import { appendEvent, createInvestigation, persistObservation, updateInvestigationStatus } from "../db/repositories";
import { type InvestigationCreateInput } from "../../contracts/investigation";
import { searchRequestSchema } from "../../contracts/search";

export async function collectInvestigation(input: InvestigationCreateInput, idempotencyKey?: string) {
  const db = getDatabase();
  const investigationId = createInvestigation(db, input, idempotencyKey);
  let successes = 0;
  for (const surface of input.surfaces) {
    const started = Date.now();
    const request = searchRequestSchema.parse({ question: input.question, surface, locale: input.locale, purpose: "initial" });
    try {
      const execution = await getSearchAdapter(surface, input.mode).search(request);
      const runId = persistObservation(db, investigationId, "initial", input.question, execution.observation, execution.rawResponses, Date.now() - started);
      if (["answer", "no_answer"].includes(execution.observation.outcome)) successes += 1;
      appendEvent(db, investigationId, "search.persisted", { surface, runId, mode: input.mode });
    } catch (error) {
      appendEvent(db, investigationId, "search.failed", { surface, message: error instanceof Error ? error.message : "Unknown search failure" });
    }
  }
  updateInvestigationStatus(db, investigationId, successes > 0 ? "complete" : "failed", "finalizing");
  return investigationId;
}
