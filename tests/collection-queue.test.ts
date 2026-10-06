import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { investigationCreateSchema } from "../src/contracts/investigation";
import { claimNextTask, createInvestigation, enqueueClaimExtractionTasks, enqueueInitialSearchTasks, getInvestigation, persistObservation, putLocalCache, updateInvestigationStatus } from "../src/server/db/repositories";
import { normalizedObservationSchema } from "../src/contracts/search";
import { processTask } from "../src/server/worker/collection";

function database() {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src/server/db/migrations/001_foundation.sql"), "utf8"));
    db.exec(fs.readFileSync(path.join(process.cwd(), "src/server/db/migrations/002_collection.sql"), "utf8"));
    db.exec(fs.readFileSync(path.join(process.cwd(), "src/server/db/migrations/003_organic_results.sql"), "utf8"));
    db.exec(fs.readFileSync(path.join(process.cwd(), "src/server/db/migrations/004_claims.sql"), "utf8"));
    db.exec(fs.readFileSync(path.join(process.cwd(), "src/server/db/migrations/005_provenance.sql"), "utf8"));
    db.exec(fs.readFileSync(path.join(process.cwd(), "src/server/db/migrations/006_follow_up_planner.sql"), "utf8"));
  return db;
}

describe("Batch 2 collection queue", () => {
  it("creates one extraction task per surface rather than per answer block", () => {
    const db = database();
    const input = investigationCreateSchema.parse({ question: "Batch extraction", mode: "fixture", surfaces: ["google_ai_mode", "bing_copilot", "brave_ai_mode"] });
    const id = createInvestigation(db, input);
    for (const surface of input.surfaces) {
      const observation = normalizedObservationSchema.parse({ schemaVersion: "search-observation.v1", surface, outcome: "answer", blocks: Array.from({ length: 10 }, (_, index) => ({ id: `${surface}-${index}`, text: `Substantive answer ${index} on ${surface}.`, position: index, referenceIndexes: [] })), citations: [], organicResults: [], warnings: [], effectiveParameters: {}, retrievedAt: new Date().toISOString(), providerCache: "unknown" });
      persistObservation(db, id, "initial", input.question, observation, [], 0);
    }
    expect(enqueueClaimExtractionTasks(db, id)).toBe(3);
    expect(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE investigation_id = ? AND kind = 'claim_extract'").get(id)).toEqual({ count: 3 });
    db.close();
  });
  it("creates one unique queued task per selected surface and claims safely", () => {
    const db = database();
    const input = investigationCreateSchema.parse({ question: "Queue test", mode: "fixture", surfaces: ["google_ai_mode", "brave_ai_mode"] });
    const id = createInvestigation(db, input, "queue-test-key");
    enqueueInitialSearchTasks(db, id, input.surfaces);
    enqueueInitialSearchTasks(db, id, input.surfaces);

    expect(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE investigation_id = ?").get(id)).toEqual({ count: 2 });
    const first = claimNextTask(db, "test-worker");
    const second = claimNextTask(db, "test-worker");
    expect(first?.logical_key).toBeTruthy();
    expect(second?.logical_key).toBeTruthy();
    expect(first?.logical_key).not.toBe(second?.logical_key);
    expect(claimNextTask(db, "test-worker")).toBeUndefined();
    updateInvestigationStatus(db, id, "complete", "finalizing");
    expect((getInvestigation(db, id) as unknown as { finished_at: string | null }).finished_at).toBeTruthy();
    db.close();
  });

  it("keeps cached observations labeled as local provenance", () => {
    const db = database();
    const observation = normalizedObservationSchema.parse({
      schemaVersion: "search-observation.v1",
      surface: "google_ai_mode",
      outcome: "answer",
      blocks: [{ id: "b", text: "cached answer", position: 0, referenceIndexes: [] }],
      citations: [],
      organicResults: [],
      warnings: [],
      effectiveParameters: { engine: "google_ai_mode", q: "cache test" },
      retrievedAt: new Date().toISOString(),
      providerCache: "unknown",
    });
    putLocalCache(db, "cache-key", "google_ai_mode", "cache test", observation.effectiveParameters, observation, [{ cached: true }]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM local_search_cache WHERE cache_key = ?").get("cache-key")).toEqual({ count: 1 });
    db.close();
  });

  it("continues from collection through offline claim extraction and grouping", async () => {
    const db = database();
    const input = investigationCreateSchema.parse({ question: "Batch 3 fixture workflow", mode: "fixture", surfaces: ["google_ai_mode", "bing_copilot"] });
    const id = createInvestigation(db, input, "batch-3-workflow");
    enqueueInitialSearchTasks(db, id, input.surfaces);

    for (let count = 0; count < 30; count += 1) {
      const task = claimNextTask(db, "test-worker");
      if (!task) break;
      await processTask(db as never, task as never, "test-worker");
    }

    const saved = getInvestigation(db, id) as unknown as { status: string; claims: unknown[]; claimGroups: unknown[]; documents: unknown[]; supports: Array<{ status: string }>; followUps: Array<{ useful_gain: number }>; stopReasons: string[] };
    expect(saved.status).toBe("complete");
    expect(saved.claims).toHaveLength(2);
    expect(saved.claimGroups).toHaveLength(2);
    expect(saved.documents).toHaveLength(4);
    expect(saved.supports.length).toBeGreaterThan(0);
    expect(saved.supports.some((support) => support.status === "contradicts")).toBe(true);
    expect(saved.followUps.some((action) => action.useful_gain === 1)).toBe(true);
    expect(saved.followUps.some((action) => action.useful_gain === 0)).toBe(true);
    expect(saved.stopReasons).toContain("no_eligible_follow_up_action");
    db.close();
  });
});
