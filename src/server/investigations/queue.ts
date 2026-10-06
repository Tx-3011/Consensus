import { getDatabase } from "../db/client";
import { createInvestigation, enqueueInitialSearchTasks } from "../db/repositories";
import type { InvestigationCreateInput } from "../../contracts/investigation";

export function queueInvestigation(input: InvestigationCreateInput, idempotencyKey?: string) {
  const db = getDatabase();
  return db.transaction(() => {
    const id = createInvestigation(db, input, idempotencyKey);
    enqueueInitialSearchTasks(db, id, input.surfaces);
    return id;
  })();
}
