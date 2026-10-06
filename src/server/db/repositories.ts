import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { ClaimExtractionOutput, ClaimRelationProposal, SurfaceClaimExtractionOutput } from "../../contracts/claims";
import type { PlannerCandidate } from "../../contracts/planner";
import type { SupportAssessment } from "../../contracts/provenance";
import type { InvestigationCreateInput } from "../../contracts/investigation";
import type { NormalizedObservation, SearchPurpose } from "../../contracts/search";
import { buildClaimGroups, canAcceptEquivalent, type ClaimOccurrenceLike, type ClaimPair } from "../../domain/claims";
import { analyzeProvenanceGraph, classifyExactContentRelationship } from "../../domain/provenance";
import { chooseFollowUpAction, normalizePlannerQuery, type PlannerClaimGap } from "../../domain/planner";
import type { RetrievalResult } from "../retrieval/fetch";
import { normalizeExternalUrl } from "../retrieval/url";

export const SEARCH_ADAPTER_VERSION = "serpapi-adapter.v1";
export const CLAIM_MODEL_VERSION = "openai/gpt-oss-120b";

export const DEFAULT_LIMITS = {
  serpApiAttempts: 12,
  followUpActions: 4,
  uniqueSourceDocuments: 20,
  sourceHttpAttempts: 40,
  upstreamDepth: 2,
  modelAttempts: 12,
  modelInputTokens: 60_000,
  modelOutputTokens: 12_000,
  extractedClaimOccurrences: 60,
  perSurfaceClaimOccurrences: 20,
  documentAnalysisCharacters: 20_000,
  wallTimeMs: 10 * 60_000,
  concurrentSerpApi: 2,
  concurrentSource: 3,
  concurrentModel: 1,
};

export function createInvestigation(db: Database.Database, input: InvestigationCreateInput, idempotencyKey?: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO investigations (
      id, question, requested_locale_json, effective_locale_json,
      selected_surfaces_json, mode, status, stage, frozen_limits_json,
      created_at, idempotency_key, request_hash
    ) VALUES (?, ?, ?, ?, ?, ?, 'created', 'created', ?, ?, ?, ?)
  `).run(
    id,
    input.question,
    JSON.stringify(input.locale),
    JSON.stringify(input.locale),
    JSON.stringify(input.surfaces),
    input.mode,
    JSON.stringify(DEFAULT_LIMITS),
    now,
    idempotencyKey ?? null,
    hashInvestigationInput(input),
  );
  appendEvent(db, id, "investigation.created", {
    question: input.question,
    mode: input.mode,
    surfaces: input.surfaces,
    locale: input.locale,
  });
  return id;
}

export function enqueueInitialSearchTasks(db: Database.Database, investigationId: string, surfaces: InvestigationCreateInput["surfaces"]) {
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT OR IGNORE INTO tasks (
    id, investigation_id, kind, logical_key, state, input_hash, next_eligible_at, created_at, updated_at
  ) VALUES (?, ?, 'search_initial', ?, 'queued', ?, ?, ?, ?)`);
  const enqueue = db.transaction(() => {
    for (const surface of surfaces) {
      const logicalKey = `search:initial:${surface}`;
      insert.run(crypto.randomUUID(), investigationId, logicalKey, crypto.createHash("sha256").update(`${investigationId}:${logicalKey}`).digest("hex"), now, now, now);
    }
  });
  enqueue();
}

export function enqueueClaimExtractionTasks(db: Database.Database, investigationId: string) {
  const runs = db.prepare(`SELECT DISTINCT search_runs.id
    FROM search_runs JOIN answer_blocks ON answer_blocks.search_run_id = search_runs.id
    WHERE search_runs.investigation_id = ? AND search_runs.status = 'answer'
    ORDER BY search_runs.created_at ASC`).all(investigationId) as Array<{ id: string }>;
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT OR IGNORE INTO tasks (
    id, investigation_id, kind, logical_key, state, input_hash, next_eligible_at, created_at, updated_at
  ) VALUES (?, ?, 'claim_extract', ?, 'queued', ?, ?, ?, ?)`);
  const enqueue = db.transaction(() => {
    for (const run of runs) {
      const logicalKey = `claims:extract:run:${run.id}`;
      insert.run(crypto.randomUUID(), investigationId, logicalKey, hashText(run.id), now, now, now);
    }
  });
  enqueue();
  return runs.length;
}

export function enqueueClaimAlignmentTask(db: Database.Database, investigationId: string) {
  const occurrenceCount = db.prepare("SELECT COUNT(*) AS count FROM claim_occurrences WHERE investigation_id = ?").get(investigationId) as { count: number };
  if (!occurrenceCount.count) return false;
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT OR IGNORE INTO tasks (
    id, investigation_id, kind, logical_key, state, input_hash, next_eligible_at, created_at, updated_at
  ) VALUES (?, ?, 'claim_align', 'claims:align', 'queued', ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), investigationId, hashText(String(occurrenceCount.count)), now, now, now);
  return result.changes > 0;
}

export function enqueueDocumentFetchTasks(db: Database.Database, investigationId: string) {
  const citations = db.prepare(`SELECT citations.id, citations.url FROM citations
    JOIN search_runs ON search_runs.id = citations.search_run_id
    WHERE search_runs.investigation_id = ? ORDER BY search_runs.created_at, citations.id`).all(investigationId) as Array<{ id: string; url: string }>;
  const now = new Date().toISOString();
  const seen = new Set<string>();
  let scheduled = 0;
  const persist = db.transaction(() => {
    for (const citation of citations) {
      let normalized: string;
      try { normalized = normalizeExternalUrl(citation.url); } catch { normalized = citation.url; }
      let document = db.prepare("SELECT id FROM documents WHERE investigation_id = ? AND normalized_url = ?").get(investigationId, normalized) as { id: string } | undefined;
      if (!document && seen.size < DEFAULT_LIMITS.uniqueSourceDocuments) {
        document = { id: crypto.randomUUID() };
        db.prepare("INSERT INTO documents (id, investigation_id, normalized_url, created_at) VALUES (?, ?, ?, ?)").run(document.id, investigationId, normalized, now);
        db.prepare("INSERT INTO document_aliases (document_id, observed_url, alias_kind, corroborated) VALUES (?, ?, 'citation', 1)").run(document.id, citation.url);
      }
      if (!document) continue;
      seen.add(document.id);
      db.prepare("INSERT OR IGNORE INTO citation_documents (citation_id, document_id) VALUES (?, ?)").run(citation.id, document.id);
      const logicalKey = `document:fetch:${document.id}`;
      const inserted = db.prepare(`INSERT OR IGNORE INTO tasks (
        id, investigation_id, kind, logical_key, state, input_hash, next_eligible_at, created_at, updated_at
      ) VALUES (?, ?, 'document_fetch', ?, 'queued', ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), investigationId, logicalKey, hashText(normalized), now, now, now);
      scheduled += inserted.changes;
    }
    appendEvent(db, investigationId, "documents.scheduled", { uniqueDocuments: seen.size, fetchTasks: scheduled, limit: DEFAULT_LIMITS.uniqueSourceDocuments });
  });
  persist();
  return scheduled;
}

export function enqueueSupportTasks(db: Database.Database, investigationId: string) {
  const snapshots = db.prepare(`SELECT document_snapshots.id, document_snapshots.content_hash FROM document_snapshots
    WHERE investigation_id = ? AND document_snapshots.id = (
      SELECT latest.id FROM document_snapshots AS latest WHERE latest.document_id = document_snapshots.document_id ORDER BY latest.fetched_at DESC LIMIT 1
    ) ORDER BY fetched_at`).all(investigationId) as Array<{ id: string; content_hash: string | null }>;
  const now = new Date().toISOString();
  let scheduled = 0;
  const investigation = getInvestigationForWorker(db, investigationId);
  const limits = JSON.parse(investigation?.frozen_limits_json ?? "{}") as { modelAttempts?: number };
  const used = db.prepare(`SELECT COUNT(*) AS count FROM request_attempts JOIN tasks ON tasks.id = request_attempts.task_id
    WHERE tasks.investigation_id = ? AND tasks.kind IN ('claim_extract', 'claim_align', 'support_assess')`).get(investigationId) as { count: number };
  // Keep one attempt available for a controlled schema repair.
  const capacity = Math.max(0, Number(limits.modelAttempts ?? DEFAULT_LIMITS.modelAttempts) - used.count - 1);
  const insert = db.prepare(`INSERT OR IGNORE INTO tasks (
    id, investigation_id, kind, logical_key, state, input_hash, next_eligible_at, created_at, updated_at
  ) VALUES (?, ?, 'support_assess', ?, 'queued', ?, ?, ?, ?)`);
  const enqueue = db.transaction(() => {
    for (const snapshot of snapshots) {
      if (scheduled >= capacity) break;
      const logicalKey = `support:assess:${snapshot.id}`;
      scheduled += insert.run(crypto.randomUUID(), investigationId, logicalKey, hashText(`${snapshot.id}:${snapshot.content_hash ?? "unresolved"}`), now, now, now).changes;
    }
  });
  enqueue();
  if (snapshots.length > scheduled && capacity === scheduled) appendEvent(db, investigationId, "model.budget_capacity_reached", { phase: "support_assess", scheduled, omitted: snapshots.length - scheduled });
  return scheduled;
}

export function advanceFollowUpPlanner(db: Database.Database, investigationId: string) {
  const investigation = getInvestigationForWorker(db, investigationId);
  if (!investigation) return { state: "stopped" as const, reason: "investigation_missing" };
  const active = db.prepare("SELECT id FROM follow_up_actions WHERE investigation_id = ? AND state IN ('planned', 'searching') LIMIT 1").get(investigationId);
  if (active) return { state: "waiting" as const };

  const latest = db.prepare("SELECT * FROM follow_up_actions WHERE investigation_id = ? ORDER BY created_at DESC LIMIT 1").get(investigationId) as Record<string, unknown> | undefined;
  if (latest && latest.state === "retrieving") finalizeFollowUpAction(db, String(latest.id));

  const actions = db.prepare("SELECT * FROM follow_up_actions WHERE investigation_id = ? ORDER BY created_at").all(investigationId) as Array<Record<string, unknown>>;
  const completed = actions.filter((action) => ["complete", "failed"].includes(String(action.state)));
  const consecutiveNoGain = [...completed].reverse().findIndex((action) => Number(action.useful_gain) === 1);
  const noGainCount = consecutiveNoGain < 0 ? completed.length : consecutiveNoGain;
  const searchAttempts = { count: getSearchAttemptUnits(db, investigationId) };
  const documentCount = db.prepare("SELECT COUNT(*) AS count FROM documents WHERE investigation_id = ?").get(investigationId) as { count: number };

  let stopReason: string | undefined;
  if (actions.length >= DEFAULT_LIMITS.followUpActions) stopReason = "follow_up_action_limit";
  else if (noGainCount >= 2) stopReason = "two_consecutive_actions_without_gain";
  else if (searchAttempts.count >= DEFAULT_LIMITS.serpApiAttempts) stopReason = "serpapi_attempt_limit";
  else if (documentCount.count >= DEFAULT_LIMITS.uniqueSourceDocuments) stopReason = "source_document_limit";

  const usedQueries = new Set(actions.map((action) => normalizePlannerQuery(String(action.query))));
  const candidate = stopReason ? undefined : chooseFollowUpAction(getPlannerGaps(db, investigationId), usedQueries);
  if (!candidate) {
    stopReason ??= "no_eligible_follow_up_action";
    persistPlannerStop(db, investigationId, stopReason);
    return { state: "stopped" as const, reason: stopReason };
  }
  return createFollowUpAction(db, investigationId, candidate, searchAttempts.count, documentCount.count);
}

export function getFollowUpActionForWorker(db: Database.Database, actionId: string) {
  return db.prepare("SELECT * FROM follow_up_actions WHERE id = ?").get(actionId) as Record<string, unknown> | undefined;
}

export function getSearchAttemptUnits(db: Database.Database, investigationId: string) {
  const rows = db.prepare(`SELECT request_attempts.budget_reservation_json FROM request_attempts
    JOIN tasks ON tasks.id = request_attempts.task_id
    WHERE tasks.investigation_id = ? AND tasks.kind IN ('search_initial', 'follow_up_search')`).all(investigationId) as Array<{ budget_reservation_json: string }>;
  return rows.reduce((sum, row) => {
    const reservation = JSON.parse(row.budget_reservation_json) as { providerAttempts?: number };
    return sum + Math.max(1, Number(reservation.providerAttempts ?? 1));
  }, 0);
}

export function markFollowUpSearching(db: Database.Database, actionId: string) {
  db.prepare("UPDATE follow_up_actions SET state = 'searching' WHERE id = ? AND state = 'planned'").run(actionId);
}

export function persistFollowUpDiscovery(
  db: Database.Database,
  investigationId: string,
  actionId: string,
  searchRunId: string,
  results: NormalizedObservation["organicResults"],
) {
  const action = getFollowUpActionForWorker(db, actionId);
  if (!action || action.investigation_id !== investigationId) throw new Error("Follow-up action does not belong to this investigation.");
  const remaining = Math.max(0, DEFAULT_LIMITS.uniqueSourceDocuments - Number((db.prepare("SELECT COUNT(*) AS count FROM documents WHERE investigation_id = ?").get(investigationId) as { count: number }).count));
  const ranked = [...results].sort((left, right) => discoveryScore(right, String(action.query)) - discoveryScore(left, String(action.query))).slice(0, Math.min(3, remaining));
  const now = new Date().toISOString();
  const documentIds: string[] = [];
  const artifactIds: string[] = [];
  const persist = db.transaction(() => {
    ranked.forEach((result, index) => {
      let normalized: string;
      try { normalized = normalizeExternalUrl(result.url); } catch { return; }
      let document = db.prepare("SELECT id FROM documents WHERE investigation_id = ? AND normalized_url = ?").get(investigationId, normalized) as { id: string } | undefined;
      if (!document) {
        document = { id: crypto.randomUUID() };
        db.prepare("INSERT INTO documents (id, investigation_id, normalized_url, created_at) VALUES (?, ?, ?, ?)").run(document.id, investigationId, normalized, now);
        db.prepare("INSERT INTO document_aliases (document_id, observed_url, alias_kind, corroborated) VALUES (?, ?, 'citation', 1)").run(document.id, result.url);
        artifactIds.push(document.id);
      }
      const citationId = crypto.randomUUID();
      db.prepare("INSERT INTO citations (id, search_run_id, provider_reference_id, url, title, source) VALUES (?, ?, ?, ?, ?, 'Follow-up discovery result')")
        .run(citationId, searchRunId, `organic:${index}`, result.url, result.title ?? null);
      artifactIds.push(citationId);
      db.prepare("INSERT OR IGNORE INTO citation_documents (citation_id, document_id) VALUES (?, ?)").run(citationId, document.id);
      db.prepare("INSERT OR IGNORE INTO follow_up_action_documents (action_id, document_id, provider_rank) VALUES (?, ?, ?)").run(actionId, document.id, index);
      const logicalKey = `document:fetch:${document.id}`;
      db.prepare(`INSERT OR IGNORE INTO tasks (id, investigation_id, kind, logical_key, state, input_hash, next_eligible_at, created_at, updated_at)
        VALUES (?, ?, 'document_fetch', ?, 'queued', ?, ?, ?, ?)`).run(crypto.randomUUID(), investigationId, logicalKey, hashText(normalized), now, now, now);
      documentIds.push(document.id);
    });
    db.prepare("UPDATE follow_up_actions SET state = 'retrieving', search_run_id = ?, actual_artifact_ids_json = ? WHERE id = ?")
      .run(searchRunId, JSON.stringify(artifactIds), actionId);
    appendEvent(db, investigationId, "follow_up.results_saved", { actionId, searchRunId, documentIds, artifactIds, candidateCount: results.length });
  });
  persist();
  return artifactIds;
}

export function failFollowUpAction(db: Database.Database, investigationId: string, actionId: string, reason: string) {
  const after = getAccountingSnapshot(db, investigationId);
  db.prepare("UPDATE follow_up_actions SET state = 'failed', useful_gain = 0, after_metrics_json = ?, stop_reason = ?, finished_at = ? WHERE id = ?")
    .run(JSON.stringify(after), reason, new Date().toISOString(), actionId);
  appendEvent(db, investigationId, "follow_up.failed", { actionId, reason });
}

export function getDocumentForWorker(db: Database.Database, documentId: string) {
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as { id: string; investigation_id: string; normalized_url: string } | undefined;
}

export function persistDocumentSnapshot(db: Database.Database, investigationId: string, documentId: string, result: RetrievalResult) {
  const document = getDocumentForWorker(db, documentId);
  if (!document || document.investigation_id !== investigationId) throw new Error("Document does not belong to this investigation.");
  const id = crypto.randomUUID();
  const persist = db.transaction(() => {
    db.prepare(`INSERT INTO document_snapshots (
      id, investigation_id, document_id, requested_url, final_url, outcome, http_status, mime_type,
      content_hash, extracted_text, title, outbound_links_json, redirect_chain_json, document_date,
      date_source, date_uncertain, truncated, unresolved_reason, retrieval_version, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'safe-html.v1', ?)`)
      .run(id, investigationId, documentId, result.requestedUrl, result.finalUrl ?? null, result.outcome,
        result.httpStatus ?? null, result.mimeType ?? null, result.contentHash ?? null, result.extractedText ?? null,
        result.title ?? null, JSON.stringify(result.outboundLinks), JSON.stringify(result.redirectChain),
        result.documentDate ?? null, result.dateSource ?? null, result.dateUncertain ? 1 : 0,
        result.truncated ? 1 : 0, result.unresolvedReason ?? null, result.fetchedAt);
    for (const alias of result.redirectChain) {
      db.prepare("INSERT OR IGNORE INTO document_aliases (document_id, observed_url, alias_kind, corroborated) VALUES (?, ?, 'redirect', 1)").run(documentId, alias);
    }
    deriveDeterministicProvenance(db, investigationId, id, documentId, result);
    appendFollowUpArtifactsForDocument(db, documentId, [id]);
    appendEvent(db, investigationId, "document.retrieved", { documentId, snapshotId: id, outcome: result.outcome, truncated: result.truncated, reason: result.unresolvedReason });
  });
  persist();
  return id;
}

export function getSupportInputForWorker(db: Database.Database, snapshotId: string) {
  const snapshot = db.prepare("SELECT * FROM document_snapshots WHERE id = ?").get(snapshotId) as Record<string, unknown> | undefined;
  if (!snapshot) return undefined;
  const candidates = db.prepare(`SELECT claim_occurrences.id AS occurrence_id, citations.id AS citation_id,
      claim_occurrences.proposition, claim_occurrences.source_quote, claim_occurrences.polarity,
      claim_occurrences.certainty, claim_occurrences.population, claim_occurrences.time_scope,
      claim_occurrences.units, claim_occurrences.denominator, claim_occurrences.conditions
    FROM document_snapshots
    JOIN citation_documents ON citation_documents.document_id = document_snapshots.document_id
    JOIN citations ON citations.id = citation_documents.citation_id
    JOIN answer_block_citations ON answer_block_citations.citation_id = citations.id
    JOIN claim_occurrences ON claim_occurrences.answer_block_id = answer_block_citations.answer_block_id
    WHERE document_snapshots.id = ?`).all(snapshotId) as Array<Record<string, unknown>>;
  const followUpCandidates = db.prepare(`SELECT claim_occurrences.id AS occurrence_id, citations.id AS citation_id,
      claim_occurrences.proposition, claim_occurrences.source_quote, claim_occurrences.polarity,
      claim_occurrences.certainty, claim_occurrences.population, claim_occurrences.time_scope,
      claim_occurrences.units, claim_occurrences.denominator, claim_occurrences.conditions
    FROM document_snapshots
    JOIN follow_up_action_documents ON follow_up_action_documents.document_id = document_snapshots.document_id
    JOIN follow_up_actions ON follow_up_actions.id = follow_up_action_documents.action_id
    JOIN claim_group_members ON claim_group_members.group_id = follow_up_actions.claim_group_id
    JOIN claim_occurrences ON claim_occurrences.id = claim_group_members.occurrence_id
    JOIN citation_documents ON citation_documents.document_id = document_snapshots.document_id
    JOIN citations ON citations.id = citation_documents.citation_id AND citations.source = 'Follow-up discovery result'
    WHERE document_snapshots.id = ?`).all(snapshotId) as Array<Record<string, unknown>>;
  const uniqueCandidates = [...new Map([...candidates, ...followUpCandidates].map((candidate) => [`${candidate.occurrence_id}|${candidate.citation_id}`, candidate])).values()];
  return { snapshot, candidates: uniqueCandidates };
}

export function persistSupportAssessments(
  db: Database.Database,
  investigationId: string,
  snapshotId: string,
  assessments: SupportAssessment[],
  modelVersion: string,
) {
  const input = getSupportInputForWorker(db, snapshotId);
  if (!input || input.snapshot.investigation_id !== investigationId) throw new Error("Snapshot does not belong to this investigation.");
  const text = String(input.snapshot.extracted_text ?? "");
  const now = new Date().toISOString();
  const ids: string[] = [];
  const persist = db.transaction(() => {
    for (const assessment of assessments) {
      const validCandidate = input.candidates.some((candidate) => candidate.occurrence_id === assessment.occurrenceId && candidate.citation_id === assessment.citationId);
      if (!validCandidate) throw new Error("Support assessment references an unrelated claim or citation.");
      let evidenceSpanId: string | undefined;
      if (["supports", "qualifies", "contradicts"].includes(assessment.status)) {
        if (assessment.startOffset === null || assessment.endOffset === null || text.slice(assessment.startOffset, assessment.endOffset) !== assessment.evidenceQuote) throw new Error("Support evidence span does not resolve.");
        evidenceSpanId = crypto.randomUUID();
        db.prepare(`INSERT INTO evidence_spans (id, investigation_id, snapshot_id, start_offset, end_offset, exact_quote, context)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(evidenceSpanId, investigationId, snapshotId, assessment.startOffset, assessment.endOffset, assessment.evidenceQuote,
            text.slice(Math.max(0, assessment.startOffset - 160), Math.min(text.length, assessment.endOffset + 160)));
      }
      const supportId = crypto.randomUUID();
      db.prepare(`INSERT OR REPLACE INTO claim_support (
        id, investigation_id, occurrence_id, citation_id, snapshot_id, status, rationale,
        analysis_method, model_version, prompt_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'model_assessed', ?, 'claim-support-prompt.v1', ?)`)
        .run(supportId, investigationId, assessment.occurrenceId, assessment.citationId, snapshotId, assessment.status, assessment.rationale, modelVersion, now);
      if (evidenceSpanId) db.prepare("INSERT INTO claim_support_evidence (claim_support_id, evidence_span_id) VALUES (?, ?)").run(supportId, evidenceSpanId);
      if (evidenceSpanId && ["supports", "qualifies"].includes(assessment.status)) {
        const roots = db.prepare("SELECT root_id FROM evidence_root_snapshots WHERE snapshot_id = ?").all(snapshotId) as Array<{ root_id: string }>;
        const group = db.prepare("SELECT group_id FROM claim_group_members WHERE occurrence_id = ?").get(assessment.occurrenceId) as { group_id: string } | undefined;
        const documentId = String(input.snapshot.document_id);
        for (const root of roots) {
          const exists = db.prepare(`SELECT id FROM relationships WHERE investigation_id = ? AND relationship_type = 'USES_EVIDENCE'
            AND from_document_id = ? AND to_root_id = ? AND claim_group_id IS ?`).get(investigationId, documentId, root.root_id, group?.group_id ?? null);
          if (!exists) db.prepare(`INSERT INTO relationships (
            id, investigation_id, relationship_type, from_document_id, to_root_id, claim_group_id,
            status, explanation, rule_version, evidence_span_id, created_at
          ) VALUES (?, ?, 'USES_EVIDENCE', ?, ?, ?, 'observed', ?, 'doi-root.v1', ?, ?)`)
            .run(crypto.randomUUID(), investigationId, documentId, root.root_id, group?.group_id ?? null,
              "The inspected document contains a stable DOI and relevant claim support.", evidenceSpanId, now);
        }
      }
      ids.push(supportId);
    }
    appendFollowUpArtifactsForSnapshot(db, snapshotId, ids);
    appendEvent(db, investigationId, "support.assessed", { snapshotId, assessments: assessments.length, supportIds: ids });
  });
  persist();
  return ids;
}

export function persistUnresolvedSupports(db: Database.Database, investigationId: string, snapshotId: string, reason: string) {
  const input = getSupportInputForWorker(db, snapshotId);
  if (!input) return [];
  const assessments: SupportAssessment[] = input.candidates.map((candidate) => ({
    occurrenceId: String(candidate.occurrence_id), citationId: String(candidate.citation_id), status: "unresolved",
    evidenceQuote: "", startOffset: null, endOffset: null, rationale: reason,
  }));
  return persistSupportAssessments(db, investigationId, snapshotId, assessments, "deterministic-unresolved.v1");
}

export function updateInvestigationStatus(db: Database.Database, investigationId: string, status: string, stage = status) {
  if (["complete", "partial", "failed", "cancelled"].includes(status)) {
    db.prepare("UPDATE investigations SET status = ?, stage = ?, finished_at = ? WHERE id = ?")
      .run(status, stage, new Date().toISOString(), investigationId);
  } else {
    db.prepare("UPDATE investigations SET status = ?, stage = ? WHERE id = ?").run(status, stage, investigationId);
  }
  appendEvent(db, investigationId, "investigation.status", { status, stage });
}

export function setInvestigationStage(db: Database.Database, investigationId: string, stage: string, status?: string) {
  if (status && ["complete", "partial", "failed", "cancelled"].includes(status)) db.prepare("UPDATE investigations SET stage = ?, status = ?, finished_at = ? WHERE id = ?").run(stage, status, new Date().toISOString(), investigationId);
  else if (status) db.prepare("UPDATE investigations SET stage = ?, status = ? WHERE id = ? AND status NOT IN ('complete', 'partial', 'failed', 'cancelled')").run(stage, status, investigationId);
  else db.prepare("UPDATE investigations SET stage = ? WHERE id = ?").run(stage, investigationId);
  appendEvent(db, investigationId, "investigation.stage", { stage, status });
}

export function appendEvent(db: Database.Database, investigationId: string, type: string, payload: unknown) {
  const sequenceRow = db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM investigation_events WHERE investigation_id = ?")
    .get(investigationId) as { next_sequence: number };
  db.prepare("INSERT INTO investigation_events (investigation_id, sequence, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(investigationId, sequenceRow.next_sequence, type, JSON.stringify(payload), new Date().toISOString());
}

export function persistObservation(
  db: Database.Database,
  investigationId: string,
  purpose: SearchPurpose,
  query: string,
  observation: NormalizedObservation,
  rawResponse: unknown,
  latencyMs: number,
  cacheProvenance: "local" | "provider" | "fresh_dispatch" | "unknown" = observation.providerCache === "hit" ? "provider" : "fresh_dispatch",
) {
  const searchRunId = crypto.randomUUID();
  const savedAt = new Date().toISOString();
  const insert = db.transaction(() => {
    db.prepare(`INSERT INTO search_runs (
      id, investigation_id, surface, query, effective_parameters_json,
      purpose, status, latency_ms, provider_request_id, cache_provenance,
      retrieved_at, created_at, organic_results_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(searchRunId, investigationId, observation.surface, query, JSON.stringify(observation.effectiveParameters), purpose,
        observation.outcome, latencyMs, observation.providerRequestId ?? null, cacheProvenance, observation.retrievedAt, savedAt, JSON.stringify(observation.organicResults));
    db.prepare("INSERT INTO raw_responses (id, search_run_id, payload_json, schema_version, sanitized_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), searchRunId, JSON.stringify(sanitizeProviderPayload(rawResponse)), "raw-response.v1", savedAt);

    const citationIds = observation.citations.map(() => crypto.randomUUID());
    observation.citations.forEach((citation, index) => {
      db.prepare("INSERT INTO citations (id, search_run_id, provider_reference_id, url, title, source) VALUES (?, ?, ?, ?, ?, ?)")
        .run(citationIds[index], searchRunId, citation.providerReferenceId ?? null, citation.url, citation.title ?? null, citation.source ?? null);
    });
    observation.blocks.forEach((block) => {
      const blockId = crypto.randomUUID();
      db.prepare("INSERT INTO answer_blocks (id, search_run_id, position, text, provider_reference_indexes_json) VALUES (?, ?, ?, ?, ?)")
        .run(blockId, searchRunId, block.position, block.text, JSON.stringify(block.referenceIndexes));
      for (const index of block.referenceIndexes) {
        if (!citationIds[index]) continue;
        db.prepare("INSERT OR IGNORE INTO answer_block_citations (answer_block_id, citation_id, attachment_scope) VALUES (?, ?, 'block')")
          .run(blockId, citationIds[index]);
      }
    });
    appendEvent(db, investigationId, "search.completed", {
      searchRunId,
      surface: observation.surface,
      outcome: observation.outcome,
      citationCount: observation.citations.length,
      blockCount: observation.blocks.length,
      warnings: observation.warnings,
    });
  });
  insert();
  return searchRunId;
}

export function getInvestigation(db: Database.Database, id: string) {
  const investigation = db.prepare("SELECT * FROM investigations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!investigation) return undefined;
  const runs = db.prepare("SELECT * FROM search_runs WHERE investigation_id = ? ORDER BY created_at ASC").all(id) as Array<Record<string, unknown>>;
  const blocks = db.prepare(`SELECT answer_blocks.*, search_runs.surface FROM answer_blocks
    JOIN search_runs ON search_runs.id = answer_blocks.search_run_id
    WHERE search_runs.investigation_id = ? ORDER BY search_runs.created_at ASC, answer_blocks.position ASC`).all(id) as Array<Record<string, unknown>>;
  const citations = db.prepare(`SELECT citations.*, search_runs.surface FROM citations
    JOIN search_runs ON search_runs.id = citations.search_run_id
    WHERE search_runs.investigation_id = ? ORDER BY search_runs.created_at ASC`).all(id) as Array<Record<string, unknown>>;
  const occurrences = db.prepare(`SELECT claim_occurrences.*, search_runs.surface
    FROM claim_occurrences
    JOIN answer_blocks ON answer_blocks.id = claim_occurrences.answer_block_id
    JOIN search_runs ON search_runs.id = answer_blocks.search_run_id
    WHERE claim_occurrences.investigation_id = ?
    ORDER BY claim_occurrences.created_at ASC, claim_occurrences.source_start_offset ASC`).all(id) as Array<Record<string, unknown>>;
  const occurrenceCitations = db.prepare(`SELECT claim_occurrences.id AS occurrence_id, citations.id AS citation_id,
      citations.url, citations.title, citations.source, answer_block_citations.attachment_scope
    FROM claim_occurrences
    JOIN answer_block_citations ON answer_block_citations.answer_block_id = claim_occurrences.answer_block_id
    JOIN citations ON citations.id = answer_block_citations.citation_id
    WHERE claim_occurrences.investigation_id = ?`).all(id) as Array<Record<string, unknown>>;
  const claimGroups = db.prepare(`SELECT claim_groups.id, claim_groups.canonical_occurrence_id,
      claim_group_members.occurrence_id
    FROM claim_groups JOIN claim_group_members ON claim_group_members.group_id = claim_groups.id
    WHERE claim_groups.investigation_id = ? ORDER BY claim_groups.created_at ASC`).all(id) as Array<Record<string, unknown>>;
  const claimRelations = db.prepare("SELECT * FROM claim_relations WHERE investigation_id = ? ORDER BY created_at ASC").all(id) as Array<Record<string, unknown>>;
  const documents = db.prepare(`SELECT documents.*, document_snapshots.id AS snapshot_id, document_snapshots.final_url,
      document_snapshots.outcome, document_snapshots.http_status, document_snapshots.mime_type,
      document_snapshots.title, document_snapshots.fetched_at, document_snapshots.truncated,
      document_snapshots.unresolved_reason, document_snapshots.document_date, document_snapshots.date_source,
      document_snapshots.date_uncertain
    FROM documents LEFT JOIN document_snapshots ON document_snapshots.id = (
      SELECT id FROM document_snapshots WHERE document_id = documents.id ORDER BY fetched_at DESC LIMIT 1
    ) WHERE documents.investigation_id = ? ORDER BY documents.created_at`).all(id) as Array<Record<string, unknown>>;
  const supports = db.prepare(`SELECT claim_support.*, evidence_spans.id AS evidence_span_id,
      evidence_spans.exact_quote, evidence_spans.context, evidence_spans.start_offset, evidence_spans.end_offset
    FROM claim_support LEFT JOIN claim_support_evidence ON claim_support_evidence.claim_support_id = claim_support.id
    LEFT JOIN evidence_spans ON evidence_spans.id = claim_support_evidence.evidence_span_id
    WHERE claim_support.investigation_id = ? ORDER BY claim_support.created_at`).all(id) as Array<Record<string, unknown>>;
  const roots = db.prepare("SELECT * FROM evidence_roots WHERE investigation_id = ? ORDER BY created_at").all(id) as Array<Record<string, unknown>>;
  const relationships = db.prepare("SELECT * FROM relationships WHERE investigation_id = ? ORDER BY created_at").all(id) as Array<Record<string, unknown>>;
  const followUps = db.prepare("SELECT * FROM follow_up_actions WHERE investigation_id = ? ORDER BY created_at").all(id) as Array<Record<string, unknown>>;
  const events = db.prepare("SELECT * FROM investigation_events WHERE investigation_id = ? ORDER BY sequence ASC").all(id) as Array<Record<string, unknown>>;
  const tasks = db.prepare("SELECT id, kind, logical_key, state, attempts, next_eligible_at, error_category, created_at, updated_at FROM tasks WHERE investigation_id = ? ORDER BY created_at ASC").all(id) as Array<Record<string, unknown>>;
  const taskCounts = db.prepare("SELECT state, COUNT(*) AS count FROM tasks WHERE investigation_id = ? GROUP BY state").all(id) as Array<{ state: string; count: number }>;
  return {
    ...investigation,
    requestedLocale: JSON.parse(String(investigation.requested_locale_json)),
    effectiveLocale: JSON.parse(String(investigation.effective_locale_json)),
    selectedSurfaces: JSON.parse(String(investigation.selected_surfaces_json)),
    frozenLimits: JSON.parse(String(investigation.frozen_limits_json)),
    stopReasons: JSON.parse(String(investigation.stop_reasons_json)),
    runs: runs.map((run) => ({ ...run, effectiveParameters: JSON.parse(String(run.effective_parameters_json)), organicResults: JSON.parse(String(run.organic_results_json ?? "[]")) })),
    blocks: blocks.map((block) => ({ ...block, referenceIndexes: JSON.parse(String(block.provider_reference_indexes_json)) })),
    citations,
    claims: occurrences.map((occurrence) => ({
      ...occurrence,
      citations: occurrenceCitations.filter((citation) => citation.occurrence_id === occurrence.id),
    })),
    claimGroups: claimGroups.reduce<Array<{ id: unknown; canonical_occurrence_id: unknown; memberIds: unknown[] }>>((groups, row) => {
      let group = groups.find((candidate) => candidate.id === row.id);
      if (!group) {
        group = { id: row.id, canonical_occurrence_id: row.canonical_occurrence_id, memberIds: [] };
        groups.push(group);
      }
      group.memberIds.push(row.occurrence_id);
      return groups;
    }, []),
    claimRelations,
    documents,
    supports,
    roots,
    relationships,
    followUps: followUps.map((action) => ({
      ...action,
      triggerEvidenceIds: JSON.parse(String(action.trigger_evidence_ids_json)),
      budgetSnapshot: JSON.parse(String(action.budget_snapshot_json)),
      beforeMetrics: JSON.parse(String(action.before_metrics_json)),
      afterMetrics: action.after_metrics_json ? JSON.parse(String(action.after_metrics_json)) : null,
      actualArtifactIds: JSON.parse(String(action.actual_artifact_ids_json)),
    })),
    evidenceAccounting: calculateEvidenceAccounting(db, id, documents, supports, roots),
    tasks,
    progress: Object.fromEntries(taskCounts.map((row) => [row.state, row.count])),
    events: events.map((event) => ({ ...event, payload: JSON.parse(String(event.payload_json)) })),
  };
}

export function getInvestigationGraph(db: Database.Database, investigationId: string, claimGroupId?: string) {
  const investigation = db.prepare("SELECT id FROM investigations WHERE id = ?").get(investigationId);
  if (!investigation) return undefined;
  if (claimGroupId && !db.prepare("SELECT id FROM claim_groups WHERE id = ? AND investigation_id = ?").get(claimGroupId, investigationId)) return undefined;
  const surfaces = db.prepare(`SELECT DISTINCT search_runs.surface FROM search_runs
    WHERE investigation_id = ? AND status = 'answer'`).all(investigationId) as Array<{ surface: string }>;
  const documents = db.prepare("SELECT id, normalized_url FROM documents WHERE investigation_id = ?").all(investigationId) as Array<{ id: string; normalized_url: string }>;
  const roots = db.prepare("SELECT id, label, root_type FROM evidence_roots WHERE investigation_id = ?").all(investigationId) as Array<{ id: string; label: string; root_type: string }>;
  const citationEdges = db.prepare(`SELECT DISTINCT search_runs.surface, citation_documents.document_id, answer_block_citations.attachment_scope
    FROM claim_group_members
    JOIN claim_occurrences ON claim_occurrences.id = claim_group_members.occurrence_id
    JOIN answer_blocks ON answer_blocks.id = claim_occurrences.answer_block_id
    JOIN search_runs ON search_runs.id = answer_blocks.search_run_id
    JOIN answer_block_citations ON answer_block_citations.answer_block_id = answer_blocks.id
    JOIN citation_documents ON citation_documents.citation_id = answer_block_citations.citation_id
    WHERE claim_group_members.group_id = COALESCE(?, claim_group_members.group_id)
      AND claim_occurrences.investigation_id = ?`).all(claimGroupId ?? null, investigationId) as Array<{ surface: string; document_id: string; attachment_scope: string }>;
  const relationships = db.prepare(`SELECT * FROM relationships WHERE investigation_id = ?
    AND (? IS NULL OR claim_group_id = ? OR claim_group_id IS NULL)`).all(investigationId, claimGroupId ?? null, claimGroupId ?? null) as Array<Record<string, unknown>>;
  return {
    schemaVersion: "evidence-graph.v1",
    claimGroupId: claimGroupId ?? null,
    nodes: [
      ...surfaces.map((surface) => ({ id: `surface:${surface.surface}`, type: "surface", label: surface.surface })),
      ...documents.map((document) => ({ id: `document:${document.id}`, type: "document", label: document.normalized_url, evidenceId: document.id })),
      ...roots.map((root) => ({ id: `root:${root.id}`, type: "root", label: root.label, rootType: root.root_type, evidenceId: root.id })),
    ],
    edges: [
      ...citationEdges.map((edge, index) => ({ id: `citation:${index}:${edge.surface}:${edge.document_id}`, type: "CITES", source: `surface:${edge.surface}`, target: `document:${edge.document_id}`, status: "observed", attachmentScope: edge.attachment_scope })),
      ...relationships.map((relationship) => ({
        id: String(relationship.id), type: relationship.relationship_type, source: `document:${relationship.from_document_id}`,
        target: relationship.to_document_id ? `document:${relationship.to_document_id}` : `root:${relationship.to_root_id}`,
        status: relationship.status, explanation: relationship.explanation, evidenceId: relationship.evidence_span_id,
      })),
    ],
  };
}

export function getInvestigationEvidence(db: Database.Database, investigationId: string, evidenceId: string) {
  const span = db.prepare(`SELECT evidence_spans.*, document_snapshots.final_url, document_snapshots.fetched_at,
      document_snapshots.document_date, document_snapshots.date_source, document_snapshots.date_uncertain
    FROM evidence_spans LEFT JOIN document_snapshots ON document_snapshots.id = evidence_spans.snapshot_id
    WHERE evidence_spans.id = ? AND evidence_spans.investigation_id = ?`).get(evidenceId, investigationId) as Record<string, unknown> | undefined;
  if (span) return { type: "span", ...span };
  const document = db.prepare(`SELECT documents.*, document_snapshots.id AS snapshot_id, document_snapshots.final_url,
      document_snapshots.outcome, document_snapshots.mime_type, document_snapshots.title,
      document_snapshots.fetched_at, document_snapshots.document_date, document_snapshots.date_source,
      document_snapshots.date_uncertain, document_snapshots.truncated, document_snapshots.unresolved_reason
    FROM documents LEFT JOIN document_snapshots ON document_snapshots.document_id = documents.id
    WHERE documents.id = ? AND documents.investigation_id = ? ORDER BY document_snapshots.fetched_at DESC LIMIT 1`).get(evidenceId, investigationId) as Record<string, unknown> | undefined;
  if (document) return { type: "document", ...document };
  const root = db.prepare(`SELECT evidence_roots.*, evidence_spans.exact_quote, evidence_spans.context
    FROM evidence_roots LEFT JOIN evidence_spans ON evidence_spans.id = evidence_roots.identification_evidence_span_id
    WHERE evidence_roots.id = ? AND evidence_roots.investigation_id = ?`).get(evidenceId, investigationId) as Record<string, unknown> | undefined;
  return root ? { type: "root", ...root } : undefined;
}

export function getInvestigationForWorker(db: Database.Database, id: string) {
  return db.prepare("SELECT id, question, mode, selected_surfaces_json, effective_locale_json, status, stage, frozen_limits_json FROM investigations WHERE id = ?").get(id) as {
    id: string; question: string; mode: "live" | "fixture"; selected_surfaces_json: string; effective_locale_json: string; status: string; stage: string; frozen_limits_json: string;
  } | undefined;
}

export function getClaimBlockForWorker(db: Database.Database, blockId: string) {
  return db.prepare(`SELECT answer_blocks.id, answer_blocks.text, search_runs.investigation_id, search_runs.surface
    FROM answer_blocks JOIN search_runs ON search_runs.id = answer_blocks.search_run_id
    WHERE answer_blocks.id = ?`).get(blockId) as {
      id: string; text: string; investigation_id: string; surface: string;
    } | undefined;
}

export function getClaimSurfaceForWorker(db: Database.Database, runId: string) {
  const run = db.prepare("SELECT id, investigation_id, surface FROM search_runs WHERE id = ?").get(runId) as { id: string; investigation_id: string; surface: string } | undefined;
  if (!run) return undefined;
  const rows = db.prepare("SELECT id, text, position FROM answer_blocks WHERE search_run_id = ? ORDER BY position").all(runId) as Array<{ id: string; text: string; position: number }>;
  const seen = new Set<string>();
  const blocks: Array<{ id: string; text: string }> = [];
  let characters = 0;
  for (const row of rows) {
    const text = row.text.trim();
    if (!text || /^\s*(?:\[?\d+\]?|sources?|citations?)\s*$/i.test(text)) continue;
    const normalized = text.replace(/\s+/g, " ").toLocaleLowerCase();
    if ([...seen].some((prior) => prior === normalized || prior.includes(normalized) || normalized.includes(prior))) continue;
    const remaining = 24_000 - characters;
    if (remaining <= 0) break;
    const bounded = text.slice(0, remaining);
    seen.add(normalized);
    blocks.push({ id: row.id, text: bounded });
    characters += bounded.length;
  }
  return { ...run, blocks };
}

export function persistSurfaceClaimOccurrences(db: Database.Database, investigationId: string, extraction: SurfaceClaimExtractionOutput, modelVersion: string, warnings: string[]) {
  const ids: string[] = [];
  const grouped = new Map<string, SurfaceClaimExtractionOutput["claims"]>();
  for (const claim of extraction.claims) grouped.set(claim.blockId, [...(grouped.get(claim.blockId) ?? []), claim]);
  for (const [blockId, claims] of grouped) {
    ids.push(...persistClaimOccurrences(db, investigationId, blockId, { claims: claims.map(({ blockId: _blockId, ...claim }) => claim), truncated: extraction.truncated }, modelVersion, warnings));
  }
  return ids;
}

export function getClaimOccurrencesForWorker(db: Database.Database, investigationId: string) {
  return db.prepare(`SELECT claim_occurrences.*, search_runs.surface, answer_blocks.id AS block_id
    FROM claim_occurrences
    JOIN answer_blocks ON answer_blocks.id = claim_occurrences.answer_block_id
    JOIN search_runs ON search_runs.id = answer_blocks.search_run_id
    WHERE claim_occurrences.investigation_id = ?
    ORDER BY claim_occurrences.created_at ASC, claim_occurrences.source_start_offset ASC`).all(investigationId) as Array<Record<string, unknown>>;
}

export function persistClaimOccurrences(
  db: Database.Database,
  investigationId: string,
  blockId: string,
  extraction: ClaimExtractionOutput,
  modelVersion: string,
  warnings: string[],
) {
  const block = getClaimBlockForWorker(db, blockId);
  if (!block || block.investigation_id !== investigationId) throw new Error("Claim block does not belong to this investigation.");
  const totalCount = db.prepare("SELECT COUNT(*) AS count FROM claim_occurrences WHERE investigation_id = ?").get(investigationId) as { count: number };
  const surfaceCount = db.prepare(`SELECT COUNT(*) AS count FROM claim_occurrences
    JOIN answer_blocks ON answer_blocks.id = claim_occurrences.answer_block_id
    JOIN search_runs ON search_runs.id = answer_blocks.search_run_id
    WHERE claim_occurrences.investigation_id = ? AND search_runs.surface = ?`).get(investigationId, block.surface) as { count: number };
  const available = Math.max(0, Math.min(DEFAULT_LIMITS.extractedClaimOccurrences - totalCount.count, DEFAULT_LIMITS.perSurfaceClaimOccurrences - surfaceCount.count));
  const acceptedClaims = extraction.claims.slice(0, available);
  const capped = acceptedClaims.length < extraction.claims.length;
  const now = new Date().toISOString();
  const persistedIds: string[] = [];
  const insert = db.prepare(`INSERT OR IGNORE INTO claim_occurrences (
    id, investigation_id, answer_block_id, source_start_offset, source_end_offset, source_quote,
    proposition, polarity, certainty, population, time_scope, units, denominator, conditions,
    evidence_scope, extraction_version, model_version, prompt_version, input_hash, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const persist = db.transaction(() => {
    for (const claim of acceptedClaims) {
      if (claim.endOffset <= claim.startOffset || claim.endOffset > block.text.length || block.text.slice(claim.startOffset, claim.endOffset) !== claim.sourceSpan) {
        throw new Error("Model returned a claim span that does not match the immutable answer block.");
      }
      const id = crypto.randomUUID();
      insert.run(
        id, investigationId, blockId, claim.startOffset, claim.endOffset, claim.sourceSpan,
        claim.proposition, claim.polarity, claim.certainty, claim.population, claim.timeScope,
        claim.units, claim.denominator, claim.conditions, claim.evidenceScope,
        "claim-extraction.v1", modelVersion, "claim-extraction-prompt.v1", hashText(`${blockId}:${block.text}`), now,
      );
      const saved = db.prepare(`SELECT id FROM claim_occurrences WHERE investigation_id = ? AND answer_block_id = ?
        AND source_start_offset = ? AND source_end_offset = ? AND proposition = ?`).get(investigationId, blockId, claim.startOffset, claim.endOffset, claim.proposition) as { id: string } | undefined;
      if (saved) persistedIds.push(saved.id);
    }
    appendEvent(db, investigationId, "claims.extracted", {
      blockId,
      occurrenceIds: persistedIds,
      count: persistedIds.length,
      truncated: extraction.truncated || capped,
      warnings: capped ? [...warnings, "Claim occurrence limit reached; additional extracted claims were not persisted."] : warnings,
    });
  });
  persist();
  return persistedIds;
}

export function persistClaimRelationsAndGroups(
  db: Database.Database,
  investigationId: string,
  proposals: ClaimRelationProposal[],
  modelVersion: string,
  warnings: string[],
) {
  const rows = getClaimOccurrencesForWorker(db, investigationId);
  const occurrences = rows.map(toClaimOccurrence);
  const byId = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]));
  const acceptedPairs: ClaimPair[] = [];
  const now = new Date().toISOString();
  const persist = db.transaction(() => {
    for (const proposal of proposals) {
      const left = byId.get(proposal.leftId);
      const right = byId.get(proposal.rightId);
      if (!left || !right || left.id === right.id) continue;
      const ordered = left.id.localeCompare(right.id) < 0 ? [left, right] as const : [right, left] as const;
      const accepted = canAcceptEquivalent(ordered[0], ordered[1], proposal.relation);
      db.prepare(`INSERT OR IGNORE INTO claim_relations (
        id, investigation_id, left_occurrence_id, right_occurrence_id, relation,
        accepted_equivalence, rationale, model_version, prompt_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), investigationId, ordered[0].id, ordered[1].id, proposal.relation, accepted ? 1 : 0,
          accepted ? proposal.rationale : `${proposal.rationale} Not merged because claim scope or certainty is not compatible.`,
          modelVersion, "claim-alignment-prompt.v1", now);
      if (accepted) acceptedPairs.push({ left: ordered[0], right: ordered[1] });
    }
    const groups = buildClaimGroups(occurrences, acceptedPairs);
    const insertGroup = db.prepare("INSERT OR IGNORE INTO claim_groups (id, investigation_id, canonical_occurrence_id, created_at) VALUES (?, ?, ?, ?)");
    const insertMember = db.prepare("INSERT OR IGNORE INTO claim_group_members (group_id, occurrence_id) VALUES (?, ?)");
    for (const group of groups) {
      const groupId = crypto.randomUUID();
      insertGroup.run(groupId, investigationId, group.canonicalOccurrenceId, now);
      for (const occurrenceId of group.memberIds) insertMember.run(groupId, occurrenceId);
    }
    appendEvent(db, investigationId, "claims.aligned", {
      relationCount: proposals.length,
      acceptedEquivalences: acceptedPairs.length,
      groupCount: groups.length,
      warnings,
    });
  });
  persist();
}

function toClaimOccurrence(row: Record<string, unknown>): ClaimOccurrenceLike {
  return {
    id: String(row.id),
    blockId: String(row.block_id ?? row.answer_block_id),
    surface: String(row.surface),
    sourceSpan: String(row.source_quote),
    startOffset: Number(row.source_start_offset),
    endOffset: Number(row.source_end_offset),
    proposition: String(row.proposition),
    polarity: row.polarity as ClaimOccurrenceLike["polarity"],
    certainty: row.certainty as ClaimOccurrenceLike["certainty"],
    population: row.population === null ? null : String(row.population),
    timeScope: row.time_scope === null ? null : String(row.time_scope),
    units: row.units === null ? null : String(row.units),
    denominator: row.denominator === null ? null : String(row.denominator),
    conditions: row.conditions === null ? null : String(row.conditions),
    evidenceScope: row.evidence_scope === null ? null : String(row.evidence_scope),
  };
}

export type ClaimedTask = Record<string, unknown> & { id: string; investigation_id: string; logical_key: string; attempts: number };

export function claimNextTask(db: Database.Database, owner: string, leaseMs = 120_000): ClaimedTask | undefined {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + leaseMs).toISOString();
  const claim = db.transaction(() => {
    const task = db.prepare(`SELECT * FROM tasks WHERE state = 'queued' AND (next_eligible_at IS NULL OR next_eligible_at <= ?)
      ORDER BY created_at ASC LIMIT 1`).get(nowIso) as Record<string, unknown> | undefined;
    if (!task) return undefined;
    const updated = db.prepare(`UPDATE tasks SET state = 'running', lease_owner = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND state = 'queued'`).run(owner, expiresIso, nowIso, task.id);
    return updated.changes ? { ...task, attempts: Number(task.attempts ?? 0) + 1, lease_owner: owner, lease_expires_at: expiresIso } as unknown as ClaimedTask : undefined;
  });
  return claim();
}

export function renewTaskLease(db: Database.Database, taskId: string, owner: string, leaseMs = 120_000) {
  db.prepare("UPDATE tasks SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND state = 'running' AND lease_owner = ?")
    .run(new Date(Date.now() + leaseMs).toISOString(), new Date().toISOString(), taskId, owner);
}

export function recoverExpiredTasks(db: Database.Database) {
  const expired = db.prepare("SELECT id, investigation_id FROM tasks WHERE state = 'running' AND lease_expires_at < ?").all(new Date().toISOString()) as Array<{ id: string; investigation_id: string }>;
  for (const task of expired) {
    const dispatched = db.prepare("SELECT COUNT(*) AS count FROM request_attempts WHERE task_id = ? AND dispatch_state IN ('dispatched', 'unknown_outcome')").get(task.id) as { count: number };
    if (dispatched.count > 0) {
      db.prepare("UPDATE tasks SET state = 'unknown_outcome', error_category = 'expired_after_dispatch', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      appendEvent(db, task.investigation_id, "task.unknown_outcome", { taskId: task.id, reason: "lease expired after provider dispatch" });
    } else {
      db.prepare("UPDATE tasks SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      appendEvent(db, task.investigation_id, "task.requeued", { taskId: task.id, reason: "lease expired before dispatch" });
    }
  }
  return expired.length;
}

export function createRequestAttempt(db: Database.Database, taskId: string, parameterHash: string, budget: unknown) {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO request_attempts (id, task_id, dispatch_state, sanitized_parameter_hash, started_at, budget_reservation_json)
    VALUES (?, ?, 'dispatched', ?, ?, ?)`).run(id, taskId, parameterHash, new Date().toISOString(), JSON.stringify(budget));
  return id;
}

export function finishRequestAttempt(db: Database.Database, attemptId: string, outcome: string, providerRequestId: string | undefined, usage: unknown, state: "completed" | "unknown_outcome" = "completed") {
  db.prepare("UPDATE request_attempts SET dispatch_state = ?, provider_request_id = ?, ended_at = ?, outcome = ?, usage_json = ? WHERE id = ?")
    .run(state, providerRequestId ?? null, new Date().toISOString(), outcome, JSON.stringify(usage), attemptId);
}

export function updateTaskState(db: Database.Database, taskId: string, state: string, errorCategory?: string, nextEligibleAt?: string, outputIds?: string[]) {
  db.prepare("UPDATE tasks SET state = ?, error_category = ?, next_eligible_at = ?, output_ids_json = COALESCE(?, output_ids_json), lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?")
    .run(state, errorCategory ?? null, nextEligibleAt ?? null, outputIds ? JSON.stringify(outputIds) : null, new Date().toISOString(), taskId);
}

export function getLocalCache(db: Database.Database, cacheKey: string) {
  const row = db.prepare("SELECT * FROM local_search_cache WHERE cache_key = ? AND expires_at > ?").get(cacheKey, new Date().toISOString()) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    observation: JSON.parse(String(row.normalized_observation_json)) as NormalizedObservation,
    rawResponses: JSON.parse(String(row.raw_responses_json)) as unknown[],
    retrievedAt: String(row.retrieved_at),
  };
}

export function putLocalCache(db: Database.Database, cacheKey: string, surface: string, query: string, effectiveParameters: Record<string, string>, observation: NormalizedObservation, rawResponses: unknown[]) {
  if (!["answer", "no_answer"].includes(observation.outcome)) return;
  const retrievedAt = new Date().toISOString();
  db.prepare(`INSERT INTO local_search_cache (
    cache_key, surface, query, effective_parameters_json, normalized_observation_json,
    raw_responses_json, adapter_version, retrieved_at, expires_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(cache_key) DO UPDATE SET normalized_observation_json = excluded.normalized_observation_json,
    raw_responses_json = excluded.raw_responses_json, retrieved_at = excluded.retrieved_at, expires_at = excluded.expires_at`)
    .run(cacheKey, surface, query, JSON.stringify(effectiveParameters), JSON.stringify(observation), JSON.stringify(rawResponses), SEARCH_ADAPTER_VERSION, retrievedAt, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
}

export function cancelInvestigation(db: Database.Database, investigationId: string) {
  const result = db.transaction(() => {
    db.prepare("UPDATE investigations SET status = 'cancelled', stage = 'finalizing', finished_at = COALESCE(finished_at, ?) WHERE id = ? AND status NOT IN ('complete', 'partial', 'failed', 'cancelled')")
      .run(new Date().toISOString(), investigationId);
    const cancelled = db.prepare("UPDATE tasks SET state = 'cancelled', updated_at = ? WHERE investigation_id = ? AND state IN ('queued', 'running')").run(new Date().toISOString(), investigationId);
    appendEvent(db, investigationId, "investigation.cancelled", { cancelledTasks: cancelled.changes });
    return cancelled.changes;
  });
  return result();
}

function hashInvestigationInput(input: InvestigationCreateInput) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function hashText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function deriveDeterministicProvenance(db: Database.Database, investigationId: string, snapshotId: string, documentId: string, result: RetrievalResult) {
  if (result.outcome !== "fetched" || !result.extractedText || !result.contentHash) return;
  const text = result.extractedText;
  const duplicate = db.prepare(`SELECT document_snapshots.document_id, document_snapshots.id
    FROM document_snapshots WHERE investigation_id = ? AND content_hash = ? AND document_id <> ?
    ORDER BY fetched_at LIMIT 1`).get(investigationId, result.contentHash, documentId) as { document_id: string; id: string } | undefined;
  if (duplicate) {
    const quote = text.slice(0, Math.min(240, text.length));
    const spanId = crypto.randomUUID();
    db.prepare(`INSERT INTO evidence_spans (id, investigation_id, snapshot_id, start_offset, end_offset, exact_quote, context)
      VALUES (?, ?, ?, 0, ?, ?, ?)`)
      .run(spanId, investigationId, snapshotId, quote.length, quote, quote);
    const relationshipType = classifyExactContentRelationship(text);
    db.prepare(`INSERT INTO relationships (
      id, investigation_id, relationship_type, from_document_id, to_document_id, status,
      explanation, rule_version, evidence_span_id, created_at
    ) VALUES (?, ?, ?, ?, ?, 'observed', ?, 'exact-main-text.v1', ?, ?)`)
      .run(crypto.randomUUID(), investigationId, relationshipType, documentId, duplicate.document_id,
        relationshipType === "REPRINT_OF"
          ? "The document explicitly identifies republication and has an identical normalized main-text hash."
          : "Normalized extracted main text has an identical SHA-256 hash.", spanId, new Date().toISOString());
  }

  const doiPattern = /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/gi;
  for (const match of text.matchAll(doiPattern)) {
    const identifier = `doi:${match[0].toLocaleLowerCase().replace(/[.,;]+$/, "")}`;
    const exact = match[0].slice(0, identifier.length - 4);
    const start = match.index ?? 0;
    const spanId = crypto.randomUUID();
    db.prepare(`INSERT INTO evidence_spans (id, investigation_id, snapshot_id, start_offset, end_offset, exact_quote, context)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(spanId, investigationId, snapshotId, start, start + exact.length, exact,
        text.slice(Math.max(0, start - 120), Math.min(text.length, start + exact.length + 120)));
    let root = db.prepare("SELECT id FROM evidence_roots WHERE investigation_id = ? AND stable_identifier = ?").get(investigationId, identifier) as { id: string } | undefined;
    if (!root) {
      root = { id: crypto.randomUUID() };
      db.prepare(`INSERT INTO evidence_roots (id, investigation_id, stable_identifier, root_type, label, identification_evidence_span_id, created_at)
        VALUES (?, ?, ?, 'study', ?, ?, ?)`)
        .run(root.id, investigationId, identifier, exact, spanId, new Date().toISOString());
    }
    db.prepare("INSERT OR IGNORE INTO evidence_root_snapshots (root_id, snapshot_id) VALUES (?, ?)").run(root.id, snapshotId);
  }
}

function calculateEvidenceAccounting(
  db: Database.Database,
  investigationId: string,
  documents: Array<Record<string, unknown>>,
  supports: Array<Record<string, unknown>>,
  roots: Array<Record<string, unknown>>,
) {
  const citationCount = db.prepare(`SELECT COUNT(*) AS count FROM citations JOIN search_runs ON search_runs.id = citations.search_run_id
    WHERE search_runs.investigation_id = ? AND search_runs.purpose = 'initial'`).get(investigationId) as { count: number };
  const duplicateGroups = db.prepare(`SELECT from_document_id, to_document_id FROM relationships
    WHERE investigation_id = ? AND relationship_type IN ('SAME_DOCUMENT', 'REPRINT_OF') AND status = 'observed'`).all(investigationId);
  const rootMappings = db.prepare(`SELECT from_document_id, to_root_id FROM relationships
    WHERE investigation_id = ? AND relationship_type = 'USES_EVIDENCE' AND status = 'observed'`).all(investigationId) as Array<{ from_document_id: string; to_root_id: string }>;
  const dependencyEdges = db.prepare(`SELECT from_document_id, to_document_id FROM relationships
    WHERE investigation_id = ? AND relationship_type = 'EXPLICITLY_CITES' AND status = 'observed' AND to_document_id IS NOT NULL`).all(investigationId) as Array<{ from_document_id: string; to_document_id: string }>;
  const fetchedIds = documents.filter((document) => document.outcome === "fetched").map((document) => String(document.id));
  const graphAnalysis = analyzeProvenanceGraph(
    fetchedIds,
    rootMappings.map((mapping) => ({ documentId: mapping.from_document_id, rootId: mapping.to_root_id })),
    dependencyEdges.map((edge) => ({ fromDocumentId: edge.from_document_id, toDocumentId: edge.to_document_id })),
  );
  graphAnalysis.documentBuckets.unresolved += documents.length - fetchedIds.length;
  const rootedDocuments = new Set(rootMappings.map((mapping) => mapping.from_document_id));
  return {
    accountingVersion: "evidence-accounting.v1",
    citationOccurrences: citationCount.count,
    resolvedUniqueDocuments: documents.filter((document) => document.outcome === "fetched").length,
    unresolvedCitationIdentities: documents.filter((document) => document.outcome !== "fetched").length,
    duplicateRelationships: duplicateGroups,
    observedRoots: roots.length,
    documentBuckets: graphAnalysis.documentBuckets,
    cycles: graphAnalysis.cycles,
    inspectedPrimaryEvidence: supports.filter((support) => ["supports", "qualifies"].includes(String(support.status)) && rootedDocuments.has(String(documents.find((document) => document.snapshot_id === support.snapshot_id)?.id))).length,
    contradictoryEvidence: supports.filter((support) => support.status === "contradicts").length,
    unresolvedSupport: supports.filter((support) => ["unresolved", "not_found"].includes(String(support.status))).length,
  };
}

function getPlannerGaps(db: Database.Database, investigationId: string): PlannerClaimGap[] {
  const groups = db.prepare(`SELECT claim_groups.id, claim_occurrences.proposition, claim_occurrences.evidence_scope
    FROM claim_groups JOIN claim_occurrences ON claim_occurrences.id = claim_groups.canonical_occurrence_id
    WHERE claim_groups.investigation_id = ?`).all(investigationId) as Array<{ id: string; proposition: string; evidence_scope: string | null }>;
  return groups.map((group) => {
    const supports = db.prepare(`SELECT claim_support.id, claim_support.status, claim_support_evidence.evidence_span_id
      FROM claim_group_members JOIN claim_support ON claim_support.occurrence_id = claim_group_members.occurrence_id
      LEFT JOIN claim_support_evidence ON claim_support_evidence.claim_support_id = claim_support.id
      WHERE claim_group_members.group_id = ?`).all(group.id) as Array<{ id: string; status: string; evidence_span_id: string | null }>;
    const root = db.prepare(`SELECT 1 FROM relationships WHERE investigation_id = ? AND claim_group_id = ?
      AND relationship_type = 'USES_EVIDENCE' AND status = 'observed' LIMIT 1`).get(investigationId, group.id);
    const surfaces = db.prepare(`SELECT COUNT(DISTINCT search_runs.surface) AS count FROM claim_group_members
      JOIN claim_occurrences ON claim_occurrences.id = claim_group_members.occurrence_id
      JOIN answer_blocks ON answer_blocks.id = claim_occurrences.answer_block_id
      JOIN search_runs ON search_runs.id = answer_blocks.search_run_id WHERE claim_group_members.group_id = ?`).get(group.id) as { count: number };
    return {
      claimGroupId: group.id,
      proposition: group.proposition,
      evidenceScope: group.evidence_scope,
      qualificationEvidenceIds: supports.filter((support) => support.status === "qualifies").flatMap((support) => support.evidence_span_id ? [support.evidence_span_id] : []),
      supportEvidenceIds: supports.filter((support) => ["supports", "qualifies"].includes(support.status)).flatMap((support) => support.evidence_span_id ? [support.evidence_span_id] : [support.id]),
      hasObservedRoot: Boolean(root),
      hasContradiction: supports.some((support) => support.status === "contradicts"),
      expressedSurfaceCount: surfaces.count,
    };
  });
}

function createFollowUpAction(db: Database.Database, investigationId: string, candidate: PlannerCandidate, searchAttempts: number, documentCount: number) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const before = getAccountingSnapshot(db, investigationId);
  const budget = {
    followUpActionsRemaining: DEFAULT_LIMITS.followUpActions - Number((db.prepare("SELECT COUNT(*) AS count FROM follow_up_actions WHERE investigation_id = ?").get(investigationId) as { count: number }).count),
    serpApiAttemptsRemaining: DEFAULT_LIMITS.serpApiAttempts - searchAttempts,
    sourceDocumentsRemaining: DEFAULT_LIMITS.uniqueSourceDocuments - documentCount,
  };
  db.transaction(() => {
    db.prepare(`INSERT INTO follow_up_actions (
      id, investigation_id, claim_group_id, trigger_evidence_ids_json, action_type, state,
      engine, query, reason, expected_gain, budget_snapshot_json, before_metrics_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'planned', 'google_search', ?, ?, ?, ?, ?, ?)`)
      .run(id, investigationId, candidate.claimGroupId, JSON.stringify(candidate.triggerEvidenceIds), candidate.actionType,
        candidate.query, candidate.reason, candidate.expectedGain, JSON.stringify(budget), JSON.stringify(before), now);
    const logicalKey = `follow_up:search:${id}`;
    db.prepare(`INSERT INTO tasks (id, investigation_id, kind, logical_key, state, input_hash, next_eligible_at, created_at, updated_at)
      VALUES (?, ?, 'follow_up_search', ?, 'queued', ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), investigationId, logicalKey, hashText(`${candidate.query}:google_search`), now, now, now);
    db.prepare("UPDATE investigations SET stage = 'following_up', status = 'following_up', finished_at = NULL WHERE id = ?").run(investigationId);
    appendEvent(db, investigationId, "follow_up.planned", { actionId: id, ...candidate, engine: "google_search", budget });
  })();
  return { state: "scheduled" as const, actionId: id };
}

function finalizeFollowUpAction(db: Database.Database, actionId: string) {
  const action = getFollowUpActionForWorker(db, actionId);
  if (!action) return;
  const after = getAccountingSnapshot(db, String(action.investigation_id));
  const before = JSON.parse(String(action.before_metrics_json)) as Record<string, number>;
  const gain = after.inspectedDocuments > Number(before.inspectedDocuments ?? 0)
    || after.observedRoots > Number(before.observedRoots ?? 0)
    || after.resolvedSupport > Number(before.resolvedSupport ?? 0)
    || after.contradictoryEvidence > Number(before.contradictoryEvidence ?? 0);
  db.prepare("UPDATE follow_up_actions SET state = 'complete', after_metrics_json = ?, useful_gain = ?, finished_at = ? WHERE id = ?")
    .run(JSON.stringify(after), gain ? 1 : 0, new Date().toISOString(), actionId);
  appendEvent(db, String(action.investigation_id), "follow_up.completed", { actionId, usefulGain: gain, before, after });
}

function getAccountingSnapshot(db: Database.Database, investigationId: string) {
  const inspectedDocuments = db.prepare("SELECT COUNT(DISTINCT document_id) AS count FROM document_snapshots WHERE investigation_id = ? AND outcome = 'fetched'").get(investigationId) as { count: number };
  const observedRoots = db.prepare("SELECT COUNT(*) AS count FROM evidence_roots WHERE investigation_id = ?").get(investigationId) as { count: number };
  const resolvedSupport = db.prepare("SELECT COUNT(*) AS count FROM claim_support WHERE investigation_id = ? AND status IN ('supports', 'qualifies', 'contradicts')").get(investigationId) as { count: number };
  const contradictoryEvidence = db.prepare("SELECT COUNT(*) AS count FROM claim_support WHERE investigation_id = ? AND status = 'contradicts'").get(investigationId) as { count: number };
  const relationships = db.prepare("SELECT COUNT(*) AS count FROM relationships WHERE investigation_id = ? AND status = 'observed'").get(investigationId) as { count: number };
  return { inspectedDocuments: inspectedDocuments.count, observedRoots: observedRoots.count, resolvedSupport: resolvedSupport.count, contradictoryEvidence: contradictoryEvidence.count, observedRelationships: relationships.count };
}

function persistPlannerStop(db: Database.Database, investigationId: string, reason: string) {
  const row = db.prepare("SELECT stop_reasons_json FROM investigations WHERE id = ?").get(investigationId) as { stop_reasons_json: string };
  const reasons = JSON.parse(row.stop_reasons_json) as string[];
  if (!reasons.includes(reason)) reasons.push(reason);
  db.prepare("UPDATE investigations SET stop_reasons_json = ? WHERE id = ?").run(JSON.stringify(reasons), investigationId);
  appendEvent(db, investigationId, "follow_up.stopped", { reason });
}

function discoveryScore(result: NormalizedObservation["organicResults"][number], query: string) {
  const terms = query.toLocaleLowerCase().match(/[a-z0-9.\/-]{4,}/g) ?? [];
  const haystack = `${result.title ?? ""} ${result.url}`.toLocaleLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function appendFollowUpArtifactsForDocument(db: Database.Database, documentId: string, artifactIds: string[]) {
  const actions = db.prepare("SELECT action_id FROM follow_up_action_documents WHERE document_id = ?").all(documentId) as Array<{ action_id: string }>;
  for (const action of actions) appendFollowUpArtifacts(db, action.action_id, artifactIds);
}

function appendFollowUpArtifactsForSnapshot(db: Database.Database, snapshotId: string, artifactIds: string[]) {
  const actions = db.prepare(`SELECT follow_up_action_documents.action_id FROM document_snapshots
    JOIN follow_up_action_documents ON follow_up_action_documents.document_id = document_snapshots.document_id
    WHERE document_snapshots.id = ?`).all(snapshotId) as Array<{ action_id: string }>;
  for (const action of actions) appendFollowUpArtifacts(db, action.action_id, artifactIds);
}

function appendFollowUpArtifacts(db: Database.Database, actionId: string, artifactIds: string[]) {
  const row = db.prepare("SELECT actual_artifact_ids_json FROM follow_up_actions WHERE id = ?").get(actionId) as { actual_artifact_ids_json: string } | undefined;
  if (!row) return;
  const existing = JSON.parse(row.actual_artifact_ids_json) as string[];
  db.prepare("UPDATE follow_up_actions SET actual_artifact_ids_json = ? WHERE id = ?").run(JSON.stringify([...new Set([...existing, ...artifactIds])]), actionId);
}

export function findByIdempotencyKey(db: Database.Database, key: string) {
  return db.prepare("SELECT id FROM investigations WHERE idempotency_key = ?").get(key) as { id: string } | undefined;
}

export function sanitizeProviderPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeProviderPayload);
  if (typeof value === "string") return redactUrlSecrets(value);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (["api_key", "apikey", "secret", "authorization", "token", "access_token"].includes(key.toLowerCase())) {
      result[key] = "[redacted]";
    } else {
      result[key] = sanitizeProviderPayload(child);
    }
  }
  return result;
}

function redactUrlSecrets(value: string) {
  return value.replace(/([?&](?:api_key|apikey|access_token|token)=)[^&#\s]+/gi, "$1[redacted]");
}
