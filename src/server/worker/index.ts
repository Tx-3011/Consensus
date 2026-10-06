import crypto from "node:crypto";
import { getDatabase } from "../db/client";
import { claimNextTask, recoverExpiredTasks } from "../db/repositories";
import { processTask } from "./collection";

const db = getDatabase();
const owner = `worker-${crypto.randomUUID()}`;
const maxConcurrency = 2;
const active = new Set<Promise<void>>();

recoverExpiredTasks(db);
console.log(JSON.stringify({ worker: "ready", owner, maxConcurrency }));

async function loop() {
  while (true) {
    while (active.size < maxConcurrency) {
      const task = claimNextTask(db, owner);
      if (!task) break;
      let job: Promise<void>;
      job = processTask(db, task as unknown as Parameters<typeof processTask>[1], owner)
        .catch((error) => console.error("worker task error", error))
        .finally(() => active.delete(job));
      active.add(job);
    }
    if (active.size) await Promise.race(active);
    else await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

loop().catch((error) => {
  console.error(error);
  db.close();
  process.exitCode = 1;
});
