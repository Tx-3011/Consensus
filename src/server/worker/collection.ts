import crypto from "node:crypto";
import { getModelAdapter, type ClaimAlignmentCandidate, type ModelAttemptObserver } from "../adapters/model";
import { getSearchAdapter } from "../adapters/search";
import { buildSearchParameters } from "../adapters/search/serpapi";
import { getDatabase } from "../db/client";
import {
  appendEvent,
  advanceFollowUpPlanner,
  claimNextTask,
  createRequestAttempt,
  enqueueClaimAlignmentTask,
  enqueueClaimExtractionTasks,
  enqueueDocumentFetchTasks,
  enqueueSupportTasks,
  finishRequestAttempt,
  failFollowUpAction,
  getClaimBlockForWorker,
  getClaimSurfaceForWorker,
  getClaimOccurrencesForWorker,
  getInvestigationForWorker,
  getFollowUpActionForWorker,
  getSearchAttemptUnits,
  getDocumentForWorker,
  getSupportInputForWorker,
  getLocalCache,
  persistObservation,
  persistFollowUpDiscovery,
  persistClaimOccurrences,
  persistSurfaceClaimOccurrences,
  persistClaimRelationsAndGroups,
  persistDocumentSnapshot,
  persistSupportAssessments,
  persistUnresolvedSupports,
  putLocalCache,
  markFollowUpSearching,
  setInvestigationStage,
  updateInvestigationStatus,
  updateTaskState,
} from "../db/repositories";
import type { Surface } from "../../contracts/search";
import { proposeClaimPairs } from "../../domain/claims";
import { getDocumentRetriever } from "../retrieval/fixtures";

type WorkerTask = Record<string, unknown> & { id: string; investigation_id: string; logical_key: string; attempts: number };

export async function processTask(db: ReturnType<typeof getDatabase>, task: WorkerTask, _owner: string) {
  const investigation = getInvestigationForWorker(db, task.investigation_id);
  if (!investigation) {
    updateTaskState(db, task.id, "failed", "investigation_missing");
    return;
  }
  if (investigation.status === "cancelled") {
    updateTaskState(db, task.id, "cancelled", "investigation_cancelled");
    return;
  }
  if (task.kind === "claim_extract") {
    await processClaimExtractionTask(db, task, investigation);
    return;
  }
  if (task.kind === "claim_align") {
    await processClaimAlignmentTask(db, task, investigation);
    return;
  }
  if (task.kind === "document_fetch") {
    await processDocumentFetchTask(db, task, investigation);
    return;
  }
  if (task.kind === "support_assess") {
    await processSupportTask(db, task, investigation);
    return;
  }
  if (task.kind === "follow_up_search") {
    await processFollowUpSearchTask(db, task, investigation);
    return;
  }

  setInvestigationStage(db, investigation.id, "collecting", "collecting");
  const surface = task.logical_key.replace("search:initial:", "") as Surface;
  const request = { question: investigation.question, surface, locale: JSON.parse(investigation.effective_locale_json), purpose: "initial" as const };
  const params = buildSearchParameters(request, surface);
  const cacheKey = makeCacheKey(surface, params);
  const cached = investigation.mode === "live" ? getLocalCache(db, cacheKey) : undefined;
  if (cached) {
    const runId = persistObservation(db, investigation.id, "initial", investigation.question, cached.observation, cached.rawResponses, 0, "local");
    updateTaskState(db, task.id, "succeeded");
    appendEvent(db, investigation.id, "search.cache_hit", { taskId: task.id, runId, surface, retrievedAt: cached.retrievedAt });
    await finalizeIfReady(db, investigation.id);
    return;
  }

  const attemptId = createRequestAttempt(db, task.id, crypto.createHash("sha256").update(JSON.stringify(params)).digest("hex"), { providerAttempts: surface === "google_ai_overview" ? 2 : 1 });
  const started = Date.now();
  let execution;
  try {
    execution = await getSearchAdapter(surface, investigation.mode).search(request);
  } catch (error) {
    finishRequestAttempt(db, attemptId, "worker_exception", undefined, { message: error instanceof Error ? error.message : "unknown" }, "unknown_outcome");
    updateTaskState(db, task.id, "unknown_outcome", "worker_exception");
    appendEvent(db, investigation.id, "task.unknown_outcome", { taskId: task.id, reason: "worker exception after dispatch" });
    await finalizeIfReady(db, investigation.id);
    return;
  }
  const outcome = execution.observation.outcome;
  finishRequestAttempt(db, attemptId, outcome, execution.observation.providerRequestId, { providerAttempts: execution.rawResponses.length, latencyMs: Date.now() - started }, execution.ambiguous ? "unknown_outcome" : "completed");
  const runId = persistObservation(db, investigation.id, "initial", investigation.question, execution.observation, execution.rawResponses, Date.now() - started, execution.observation.providerCache === "hit" ? "provider" : "fresh_dispatch");

  if (execution.ambiguous) {
    updateTaskState(db, task.id, "unknown_outcome", "dispatch_result_ambiguous");
    appendEvent(db, investigation.id, "task.unknown_outcome", { taskId: task.id, runId, reason: "provider result ambiguous after dispatch" });
  } else if (execution.observation.outcome === "failed" && execution.retryable && task.attempts < 2) {
    updateTaskState(db, task.id, "queued", "retryable_provider_error", new Date(Date.now() + 1_000).toISOString());
    appendEvent(db, investigation.id, "task.retry_scheduled", { taskId: task.id, runId, attempt: task.attempts + 1 });
  } else if (execution.observation.outcome === "failed") {
    updateTaskState(db, task.id, "failed", "provider_error");
  } else if (execution.observation.outcome === "unavailable") {
    updateTaskState(db, task.id, "failed", "surface_unavailable");
  } else {
    updateTaskState(db, task.id, "succeeded");
    putLocalCache(db, cacheKey, surface, investigation.question, params, execution.observation, execution.rawResponses);
  }
  appendEvent(db, investigation.id, "search.persisted", { surface, runId, mode: investigation.mode, cache: "fresh_dispatch" });
  await finalizeIfReady(db, investigation.id);
}

async function processFollowUpSearchTask(
  db: ReturnType<typeof getDatabase>,
  task: WorkerTask,
  investigation: NonNullable<ReturnType<typeof getInvestigationForWorker>>,
) {
  setInvestigationStage(db, investigation.id, "following_up", "following_up");
  const actionId = task.logical_key.replace("follow_up:search:", "");
  const action = getFollowUpActionForWorker(db, actionId);
  if (!action || action.investigation_id !== investigation.id) {
    updateTaskState(db, task.id, "failed", "follow_up_action_missing");
    await finalizeIfReady(db, investigation.id);
    return;
  }
  if (getSearchAttemptUnits(db, investigation.id) >= 12) {
    failFollowUpAction(db, investigation.id, actionId, "serpapi_attempt_limit");
    updateTaskState(db, task.id, "failed", "serpapi_attempt_limit");
    await finalizeIfReady(db, investigation.id);
    return;
  }
  markFollowUpSearching(db, actionId);
  const query = String(action.query);
  const request = { question: query, surface: "google_search" as const, locale: JSON.parse(investigation.effective_locale_json), purpose: "investigative_follow_up" as const };
  const params = buildSearchParameters(request, "google_search");
  const cacheKey = makeCacheKey("google_search", params);
  const cached = investigation.mode === "live" ? getLocalCache(db, cacheKey) : undefined;
  if (cached) {
    const runId = persistObservation(db, investigation.id, "investigative_follow_up", query, cached.observation, cached.rawResponses, 0, "local");
    const documentIds = persistFollowUpDiscovery(db, investigation.id, actionId, runId, cached.observation.organicResults);
    updateTaskState(db, task.id, "succeeded", undefined, undefined, [runId, ...documentIds]);
    await finalizeIfReady(db, investigation.id);
    return;
  }
  const attemptId = createRequestAttempt(db, task.id, crypto.createHash("sha256").update(JSON.stringify(params)).digest("hex"), { providerAttempts: 1 });
  const started = Date.now();
  const execution = await getSearchAdapter("google_search", investigation.mode).search(request);
  finishRequestAttempt(db, attemptId, execution.observation.outcome, execution.observation.providerRequestId, { providerAttempts: execution.rawResponses.length, latencyMs: Date.now() - started }, execution.ambiguous ? "unknown_outcome" : "completed");
  const runId = persistObservation(db, investigation.id, "investigative_follow_up", query, execution.observation, execution.rawResponses, Date.now() - started);
  if (execution.ambiguous) {
    failFollowUpAction(db, investigation.id, actionId, "unknown_provider_outcome");
    updateTaskState(db, task.id, "unknown_outcome", "dispatch_result_ambiguous", undefined, [runId]);
  } else if (execution.observation.outcome === "failed" && execution.retryable && task.attempts < 2) {
    db.prepare("UPDATE follow_up_actions SET state = 'planned' WHERE id = ?").run(actionId);
    updateTaskState(db, task.id, "queued", "retryable_provider_error", new Date(Date.now() + 1_000).toISOString(), [runId]);
  } else if (["failed", "unavailable"].includes(execution.observation.outcome)) {
    failFollowUpAction(db, investigation.id, actionId, execution.observation.outcome);
    updateTaskState(db, task.id, "failed", "follow_up_search_failed", undefined, [runId]);
  } else {
    const documentIds = persistFollowUpDiscovery(db, investigation.id, actionId, runId, execution.observation.organicResults);
    updateTaskState(db, task.id, "succeeded", undefined, undefined, [runId, ...documentIds]);
    putLocalCache(db, cacheKey, "google_search", query, params, execution.observation, execution.rawResponses);
  }
  await finalizeIfReady(db, investigation.id);
}

async function processDocumentFetchTask(
  db: ReturnType<typeof getDatabase>,
  task: WorkerTask,
  investigation: NonNullable<ReturnType<typeof getInvestigationForWorker>>,
) {
  setInvestigationStage(db, investigation.id, "tracing", "tracing");
  const documentId = task.logical_key.replace("document:fetch:", "");
  const document = getDocumentForWorker(db, documentId);
  if (!document || document.investigation_id !== investigation.id) {
    updateTaskState(db, task.id, "failed", "document_missing");
    await finalizeIfReady(db, investigation.id);
    return;
  }
  const attemptId = createRequestAttempt(db, task.id, crypto.createHash("sha256").update(document.normalized_url).digest("hex"), { sourceHttpAttempts: 1 });
  const result = await getDocumentRetriever(investigation.mode).fetch(document.normalized_url);
  const snapshotId = persistDocumentSnapshot(db, investigation.id, document.id, result);
  finishRequestAttempt(db, attemptId, result.outcome, undefined, { httpStatus: result.httpStatus, bytesTruncated: result.truncated });
  if (result.outcome === "failed" && result.retryable && task.attempts < 2) {
    updateTaskState(db, task.id, "queued", "retryable_source_failure", new Date(Date.now() + 500).toISOString(), [snapshotId]);
  } else if (result.outcome === "failed") updateTaskState(db, task.id, "failed", "source_failure", undefined, [snapshotId]);
  else updateTaskState(db, task.id, "succeeded", result.outcome === "fetched" ? undefined : `source_${result.outcome}`, undefined, [snapshotId]);
  await finalizeIfReady(db, investigation.id);
}

async function processSupportTask(
  db: ReturnType<typeof getDatabase>,
  task: WorkerTask,
  investigation: NonNullable<ReturnType<typeof getInvestigationForWorker>>,
) {
  setInvestigationStage(db, investigation.id, "tracing", "tracing");
  const snapshotId = task.logical_key.replace("support:assess:", "");
  const input = getSupportInputForWorker(db, snapshotId);
  if (!input || input.snapshot.investigation_id !== investigation.id) {
    updateTaskState(db, task.id, "failed", "snapshot_missing");
    await finalizeIfReady(db, investigation.id);
    return;
  }
  const text = String(input.snapshot.extracted_text ?? "");
  if (input.snapshot.outcome !== "fetched" || Number(input.snapshot.truncated) === 1 || text.length > 8_000) {
    const reason = String(input.snapshot.unresolved_reason ?? (Number(input.snapshot.truncated) === 1 || text.length > 8_000 ? "Document text exceeded the bounded analysis window." : "Document was not inspectable."));
    const ids = persistUnresolvedSupports(db, investigation.id, snapshotId, reason);
    updateTaskState(db, task.id, "succeeded", undefined, undefined, ids);
    await finalizeIfReady(db, investigation.id);
    return;
  }
  if (!input.candidates.length) {
    updateTaskState(db, task.id, "succeeded", undefined, undefined, []);
    await finalizeIfReady(db, investigation.id);
    return;
  }
  try {
    const model = getModelAdapter(investigation.mode);
    const execution = await withModelSlot(() => model.assessSupport({
      snapshotId,
      text,
      candidates: input.candidates.map((candidate) => ({
        occurrenceId: String(candidate.occurrence_id), citationId: String(candidate.citation_id),
        proposition: String(candidate.proposition), sourceQuote: String(candidate.source_quote),
        polarity: String(candidate.polarity), certainty: String(candidate.certainty),
        population: nullableString(candidate.population), timeScope: nullableString(candidate.time_scope),
        units: nullableString(candidate.units), denominator: nullableString(candidate.denominator), conditions: nullableString(candidate.conditions),
      })),
    }, requestObserver(db, task.id)));
    const ids = persistSupportAssessments(db, investigation.id, snapshotId, execution.value.assessments, model.model);
    updateTaskState(db, task.id, "succeeded", undefined, undefined, ids);
  } catch (error) {
    persistUnresolvedSupports(db, investigation.id, snapshotId, error instanceof Error ? error.message : "Support analysis failed.");
    updateTaskState(db, task.id, "failed", error instanceof Error ? error.name : "support_analysis_failed");
    appendModelFailureEvent(db, investigation.id, error);
  }
  await finalizeIfReady(db, investigation.id);
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

async function processClaimExtractionTask(
  db: ReturnType<typeof getDatabase>,
  task: WorkerTask,
  investigation: NonNullable<ReturnType<typeof getInvestigationForWorker>>,
) {
  setInvestigationStage(db, investigation.id, "analyzing", "analyzing");
  const runId = task.logical_key.replace("claims:extract:run:", "");
  const surface = getClaimSurfaceForWorker(db, runId);
  if (!surface || surface.investigation_id !== investigation.id) {
    updateTaskState(db, task.id, "failed", "claim_block_missing");
    await finalizeIfReady(db, investigation.id);
    return;
  }
  try {
    const model = getModelAdapter(investigation.mode);
    const observer = requestObserver(db, task.id);
    const execution = await withModelSlot(() => model.extractSurfaceClaims(surface.blocks, observer));
    const ids = persistSurfaceClaimOccurrences(db, investigation.id, execution.value, model.model, execution.warnings);
    updateTaskState(db, task.id, "succeeded", undefined, undefined, ids);
    await finalizeIfReady(db, investigation.id);
  } catch (error) {
    updateTaskState(db, task.id, "failed", error instanceof Error ? error.name : "claim_extraction_failed");
    appendEvent(db, investigation.id, "claims.extraction_failed", {
      taskId: task.id,
      runId,
      message: error instanceof Error ? error.message : "Claim extraction failed.",
    });
    appendModelFailureEvent(db, investigation.id, error);
    await finalizeIfReady(db, investigation.id);
  }
}

async function processClaimAlignmentTask(
  db: ReturnType<typeof getDatabase>,
  task: WorkerTask,
  investigation: NonNullable<ReturnType<typeof getInvestigationForWorker>>,
) {
  setInvestigationStage(db, investigation.id, "analyzing", "analyzing");
  const rows = getClaimOccurrencesForWorker(db, investigation.id);
  const occurrences = rows.map(toAlignmentCandidate);
  const candidatePairs = proposeClaimPairs(occurrences);
  try {
    const model = getModelAdapter(investigation.mode);
    let relations: Array<{ leftId: string; rightId: string; relation: "equivalent" | "narrower" | "broader" | "conflicting" | "unrelated" | "uncertain"; rationale: string }> = [];
    let warnings: string[] = [];
    if (candidatePairs.length > 0) {
      const observer = requestObserver(db, task.id);
      const execution = await withModelSlot(() => model.alignClaims(candidatePairs, observer));
      relations = execution.value.relations;
      warnings = execution.warnings;
    }
    persistClaimRelationsAndGroups(db, investigation.id, relations, model.model, warnings);
    updateTaskState(db, task.id, "succeeded");
  } catch (error) {
    // Singleton groups still make extracted claims visible when alignment is unavailable.
    persistClaimRelationsAndGroups(db, investigation.id, [], "alignment-unavailable", [error instanceof Error ? error.message : "Claim alignment failed."]);
    updateTaskState(db, task.id, "failed", error instanceof Error ? error.name : "claim_alignment_failed");
    appendEvent(db, investigation.id, "claims.alignment_failed", { taskId: task.id, message: error instanceof Error ? error.message : "Claim alignment failed." });
  }
  await finalizeIfReady(db, investigation.id);
}

function requestObserver(db: ReturnType<typeof getDatabase>, taskId: string): ModelAttemptObserver {
  return {
    start(parameterHash, budget) {
      const used = db.prepare(`SELECT COUNT(*) AS count FROM request_attempts
        JOIN tasks ON tasks.id = request_attempts.task_id
        WHERE tasks.investigation_id = (SELECT investigation_id FROM tasks WHERE id = ?)
          AND tasks.kind IN ('claim_extract', 'claim_align', 'support_assess')`).get(taskId) as { count: number };
      const task = db.prepare("SELECT investigation_id, kind FROM tasks WHERE id = ?").get(taskId) as { investigation_id: string; kind: string };
      const investigation = getInvestigationForWorker(db, task.investigation_id);
      const limits = JSON.parse(investigation?.frozen_limits_json ?? "{}") as { modelAttempts?: number };
      const maximum = Number(limits.modelAttempts ?? 12);
      const reserve = task.kind === "support_assess" ? 1 : 0;
      if (used.count >= maximum - reserve) throw new ModelBudgetExhaustedError();
      return createRequestAttempt(db, taskId, parameterHash, budget);
    },
    finish(attemptId, outcome, providerRequestId, usage, state = "completed") {
      finishRequestAttempt(db, attemptId, outcome, providerRequestId, usage, state);
    },
  };
}

function toAlignmentCandidate(row: Record<string, unknown>): ClaimAlignmentCandidate {
  return {
    id: String(row.id),
    blockId: String(row.block_id ?? row.answer_block_id),
    surface: String(row.surface),
    sourceSpan: String(row.source_quote),
    startOffset: Number(row.source_start_offset),
    endOffset: Number(row.source_end_offset),
    proposition: String(row.proposition),
    polarity: row.polarity as ClaimAlignmentCandidate["polarity"],
    certainty: row.certainty as ClaimAlignmentCandidate["certainty"],
    population: row.population === null ? null : String(row.population),
    timeScope: row.time_scope === null ? null : String(row.time_scope),
    units: row.units === null ? null : String(row.units),
    denominator: row.denominator === null ? null : String(row.denominator),
    conditions: row.conditions === null ? null : String(row.conditions),
    evidenceScope: row.evidence_scope === null ? null : String(row.evidence_scope),
  };
}

export async function finalizeIfReady(db: ReturnType<typeof getDatabase>, investigationId: string) {
  let tasks = db.prepare("SELECT kind, logical_key, state FROM tasks WHERE investigation_id = ?").all(investigationId) as Array<{ kind: string; logical_key: string; state: string }>;
  if (!tasks.length) return;
  const investigation = getInvestigationForWorker(db, investigationId);
  if (!investigation || investigation.status === "cancelled") return;

  const terminal = (state: string) => ["succeeded", "failed", "unknown_outcome", "cancelled"].includes(state);
  const collectionTasks = tasks.filter((task) => task.kind === "search_initial");
  if (collectionTasks.some((task) => !terminal(task.state))) return;

  const extractionTasks = tasks.filter((task) => task.kind === "claim_extract");
  const documentTasksBeforeSchedule = tasks.filter((task) => task.kind === "document_fetch");
  let scheduledWork = false;
  if (!extractionTasks.length) {
    const blockCount = enqueueClaimExtractionTasks(db, investigationId);
    if (blockCount > 0) scheduledWork = true;
  }
  if (!documentTasksBeforeSchedule.length && enqueueDocumentFetchTasks(db, investigationId) > 0) scheduledWork = true;
  if (scheduledWork) { setInvestigationStage(db, investigationId, "analyzing", "analyzing"); return; }
  tasks = db.prepare("SELECT kind, logical_key, state FROM tasks WHERE investigation_id = ?").all(investigationId) as Array<{ kind: string; logical_key: string; state: string }>;
  const currentExtractionTasks = tasks.filter((task) => task.kind === "claim_extract");
  if (currentExtractionTasks.some((task) => !terminal(task.state))) return;

  const alignmentTasks = tasks.filter((task) => task.kind === "claim_align");
  const occurrenceCount = db.prepare("SELECT COUNT(*) AS count FROM claim_occurrences WHERE investigation_id = ?").get(investigationId) as { count: number };
  if (occurrenceCount.count > 0 && !alignmentTasks.length) {
    if (enqueueClaimAlignmentTask(db, investigationId)) setInvestigationStage(db, investigationId, "analyzing", "analyzing");
    return;
  }
  if (alignmentTasks.some((task) => !terminal(task.state))) return;

  tasks = db.prepare("SELECT kind, logical_key, state FROM tasks WHERE investigation_id = ?").all(investigationId) as Array<{ kind: string; logical_key: string; state: string }>;
  const documentTasks = tasks.filter((task) => task.kind === "document_fetch");
  if (documentTasks.some((task) => !terminal(task.state))) return;

  let supportTasks = tasks.filter((task) => task.kind === "support_assess");
  if (documentTasks.length > 0) {
    const scheduled = enqueueSupportTasks(db, investigationId);
    if (scheduled > 0) {
      setInvestigationStage(db, investigationId, investigation.stage === "following_up" ? "following_up" : "tracing", investigation.stage === "following_up" ? "following_up" : "tracing");
      return;
    }
    supportTasks = db.prepare("SELECT kind, logical_key, state FROM tasks WHERE investigation_id = ? AND kind = 'support_assess'").all(investigationId) as Array<{ kind: string; logical_key: string; state: string }>;
  }
  if (supportTasks.some((task) => !terminal(task.state))) return;

  const followUpTasks = tasks.filter((task) => task.kind === "follow_up_search");
  if (followUpTasks.some((task) => !terminal(task.state))) return;
  const planner = advanceFollowUpPlanner(db, investigationId);
  if (planner.state === "scheduled" || planner.state === "waiting") return;

  const usable = db.prepare("SELECT COUNT(*) AS count FROM search_runs WHERE investigation_id = ? AND status IN ('answer', 'no_answer')").get(investigationId) as { count: number };
  const failed = tasks.some((task) => ["failed", "unknown_outcome", "cancelled"].includes(task.state));
  const status = usable.count === 0 ? "failed" : failed ? "partial" : "complete";
  updateInvestigationStatus(db, investigationId, status, "finalizing");
  appendEvent(db, investigationId, "investigation.finalized", { status, usableRuns: usable.count, taskCount: tasks.length, claimOccurrences: occurrenceCount.count });
}

class ModelBudgetExhaustedError extends Error {
  constructor() { super("The investigation's phase-aware model budget is exhausted."); this.name = "model_budget_exhausted"; }
}

function appendModelFailureEvent(db: ReturnType<typeof getDatabase>, investigationId: string, error: unknown) {
  if (!(error instanceof Error) || error.name !== "ModelRateLimitError") return;
  const retryAfterMs = Number((error as Error & { retryAfterMs?: number }).retryAfterMs ?? 12_000);
  appendEvent(db, investigationId, "model.rate_limited", {
    retryAfterMs,
    message: `Claim analysis paused because the model rate limit was reached. Retrying in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
  });
}

let modelQueue = Promise.resolve();

async function withModelSlot<T>(operation: () => Promise<T>) {
  let release!: () => void;
  const previous = modelQueue;
  modelQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function makeCacheKey(surface: Surface, params: Record<string, string>) {
  return crypto.createHash("sha256").update(JSON.stringify({ adapter: "serpapi-adapter.v1", surface, params })).digest("hex");
}
