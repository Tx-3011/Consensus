# Consensus Trap — implementation handoff

Reviewed and refined on 2026-10-05. The workspace currently contains only this plan: there is no application, dependency manifest, database, or test suite to build on.

## Readiness and review findings

**Ready to hand off for staged implementation, beginning with the capability gate below. Live provider feasibility is not yet established.** The previous version was a good product brief, but required the implementation worker to invent important architecture and evidence semantics. This revision closes those gaps with explicit defaults, contracts, failure behavior, and pass/fail gates.

The main gaps corrected are:

- Three answer surfaces were not distinguished from the ordinary search baseline.
- Claim extraction had no complete storage contract, and citation attachment had no support-verification step.
- Provenance grouping lacked rules for cycles, overlapping roots, transitive equivalence, and unresolved documents.
- Exactly-once paid searches were implied even though a process can crash after a provider accepts a request.
- Resource limits omitted model calls, tokens, request attempts, and wall time.
- The stack, worker lifecycle, API, recovery behavior, and deployment boundary were unspecified.
- Evaluation had case descriptions but no minimum fixtures or release thresholds.

The implementation contract below is normative. The seven batches that follow describe the product journey and must be implemented within this contract. No application implementation or paid provider calls were performed as part of this review.

## Implementation contract

### 1. Scope, defaults, and capability gate

Build a local, single-user English-language MVP. Use an explicit locale preset of English/United States, visible and changeable before collection; record requested and effective parameters because engines may not support identical locale controls. Do not imply identical personalization or geographic behavior across surfaces.

Use Next.js App Router, React, strict TypeScript, npm with a committed lockfile, SQLite through `better-sqlite3`, checked-in SQL migrations, Zod for external schemas, Cytoscape.js for the graph, Vitest for domain/integration tests, and Playwright for the main browser journey. Run the worker as a separate Node process using `tsx` in development. Select mutually compatible stable versions and an active Node LTS during scaffolding; pin the tested runtime and versions in the README. These are implementation choices, not pre-existing repository dependencies.

Use one structured-output LLM provider behind `ModelAdapter`. Default to OpenAI with a required `LLM_MODEL` setting chosen and smoke-tested during setup; do not guess a model identifier or silently switch providers. All graph accounting, budgets, URL rules, and summary counts are deterministic TypeScript. Embeddings, autonomous model tool use, and inferred copying direction are outside the MVP.

Deploy initially as two long-lived local processes sharing one SQLite file on local disk. Enable foreign keys, WAL, and a busy timeout; keep transactions short and exclude network calls from transactions. Serverless hosting, multiple machines, public multi-user hosting, authentication, billing, browser scraping, OCR, generic PDFs, News/Scholar adapters, and multilingual comparison are deferred. Bind to loopback; a public repository does not mean a publicly writable deployment. Do not publish or upload a repository/video as part of coding unless separately requested.

Default candidate answer surfaces:

1. Google AI Mode.
2. Bing Copilot.
3. Google AI Overview obtained from the Google Search baseline, with its follow-up retrieval when required.

The Google organic results are discovery material, not a fourth answer or a vote. Google AI Mode and AI Overview share a vendor and are not independent witnesses. Brave AI Mode is a fallback only if one candidate fails the gate.

**Capability spike:** create a fixed five-question set spanning a straightforward fact, a qualified scientific claim, numerical claims, a current-event question, and an obscure question. Save the exact questions before testing. For each candidate run the same five once; record answer availability, citation availability, reference granularity, request parameters, latency, errors, provider cache metadata, and usage if reported. A surface qualifies for the default set if at least four requests complete technically, at least three produce answer text with URLs, and all returned reference IDs can either be resolved or explicitly recorded as unresolved. This is a small feasibility check, not a reliability estimate.

The spike has a separate maximum of 24 SerpApi request attempts, including token follow-ups and any Brave fallback probes. Disable automatic retries for the spike. If the cap is reached before a fallback is evaluated, mark that surface unvalidated. Produce `docs/capabilities.md` with a row for every tested surface and redacted fixtures. If only two surfaces qualify, continue in visibly degraded two-surface mode and mark the three-surface live gate unmet. If fewer than two qualify or credentials are absent, build/test with labeled fixtures but do not claim live collection is validated. Never fabricate responses to pass a gate.

Official documentation checked for this review establishes documented endpoints, not account access or live success: [Google AI Mode](https://serpapi.com/google-ai-mode-api), [Bing Copilot](https://serpapi.com/bing-copilot-api), [AI Overview in Google Search](https://serpapi.com/ai-overview), and [AI Overview follow-up API](https://serpapi.com/google-ai-overview-api). Consult these during adapter implementation and verify response shapes with the spike. Reconstruct requests using allowlisted provider endpoints and validated parameters; never fetch an arbitrary returned `serpapi_link` verbatim.

### 2. Code boundaries and operational setup

Use this layout; equivalent naming is acceptable, but preserve separation:

```text
src/app/                         pages and API routes
src/components/                  comparison, claim table, graph, evidence drawer
src/server/db/                   connection, SQL migrations, repositories
src/server/adapters/search/      provider-specific parsers and requests
src/server/adapters/model/       structured model client and schemas
src/server/worker/               leases, task handlers, stage orchestration
src/server/retrieval/            safe fetching, HTML extraction, URL identity
src/domain/                     claims, relationship rules, metrics, planner
src/contracts/                  shared Zod schemas and versioned DTOs
scripts/                        capability spike, migration and fixture import
tests/fixtures/                 sanitized provider/document/model fixtures
tests/evaluation/               labels, held-out cases, evaluation runner
docs/                           capabilities, architecture, limitations, eval report
```

Provide `.env.example` with `SERPAPI_API_KEY`, `OPENAI_API_KEY`, `LLM_MODEL`, `DATABASE_PATH`, and validated budget/timeouts. Ignore `.env*` except the example, local database/WAL files, and captured private data. Missing keys disable live mode with an actionable setup message; replay and offline tests still work. Provide `npm run dev`, `worker`, `db:migrate`, `typecheck`, `lint`, `test`, `test:e2e`, `eval`, `build`, and `start`. README setup must work in PowerShell and a POSIX shell without shell-specific inline environment assignments.

### 3. Persistent model and invariants

Use UUIDs, UTC timestamps, foreign keys, and explicit enums. Store schema, adapter, prompt, model, extraction, and accounting versions on derived artifacts. Record immutable input IDs/hashes for reproducibility. Never overwrite an original observation when recomputing analysis.

| Entity | Required fields or relationships |
|---|---|
| Investigation | question, requested/effective locale, selected surfaces, status, stage, mode (`live`/`replay`/`fixture`), frozen limits, created/finished times, stop reasons, analysis revision |
| Task | investigation, kind, unique logical key, state, attempts, lease owner/expiry, next eligible time, input hash, output IDs, error category |
| RequestAttempt | task, dispatch state, sanitized parameter hash, provider request ID when available, start/end, outcome, usage/budget reservation |
| SearchRun / RawResponse | surface or baseline, purpose, query, effective parameters, fetched time, cache lineage, sanitized response, schema version, outcome |
| AnswerBlock / Citation | ordered immutable block text; citation URL/title/provider reference ID; join table with block and exact provider mapping or `block`/`answer`/`unresolved` attachment scope |
| ClaimOccurrence | block ID, half-open UTF-16 offsets and exact quote, proposition, polarity, certainty, population, time, units, denominator, conditions; model/prompt version |
| ClaimGroup / ClaimRelation | canonical occurrence, accepted equivalent members, pairwise relation and rationale; broader/narrower/conflicting/unrelated/uncertain remain separate relationships |
| Document / DocumentSnapshot | observed URLs and aliases; per-fetch final URL/status/MIME/hash/time; immutable extracted text and outbound links; dates with source and uncertainty; truncation status |
| EvidenceSpan | snapshot or answer block ID, half-open offsets, exact quote and surrounding context |
| ClaimSupport | occurrence/group, citation, snapshot, status (`supports`/`qualifies`/`contradicts`/`not_found`/`unresolved`), evidence span IDs, rationale and analysis method |
| EvidenceRoot | normalized stable identifier when available, type (study/dataset/report/interview/other), label, inspected snapshot IDs, identification evidence |
| Relationship | typed document/root endpoints, claim scope, observed/possible/likely status, evidence span IDs, rule/model version, explanation |
| FollowUpAction | trigger evidence IDs, claim group, action type, query, state, estimated gain category, request IDs, actual new artifact IDs, stop reason |
| BudgetLedger / InvestigationEvent | atomic reservations and usage by resource; ordered per-investigation event sequence with minimal sanitized payload |

Citation occurrences are not document identities. Multiple references can point to one document; one document can support multiple claims or roots. Keep originals even when the presentation groups them. Enforce unique task keys, event sequences, and citation mappings in SQLite. Reject cross-investigation references. Derived output and task completion commit atomically.

### 4. Adapters, API, and progress contract

Search adapters accept validated query/locale/options and return a versioned normalized observation: `surface`, `outcome`, `blocks`, `citations`, `organicResults`, `warnings`, `effectiveParameters`, `retrievedAt`, `providerRequestId`, and cache provenance. Outcomes distinguish `answer`, `no_answer`, `unavailable`, and `failed`; `answer` may have zero citations. Unexpected response shapes produce a schema warning/failure, not a fabricated empty success. All provider HTTP calls must go through the budgeted request service. AI Overview token follow-ups belong to the adapter's logical task but are separately persisted request attempts.

| Route | Contract |
|---|---|
| `POST /api/investigations` | Validate question (1–1,000 trimmed characters), configured locale and surfaces; accept an `Idempotency-Key`; atomically create investigation/tasks; return 202 with ID and status URL. Same key/body returns the same ID; same key/different body returns 409. |
| `GET /api/investigations` | Cursor-paginated saved history, 20 items by default. |
| `GET /api/investigations/:id` | Versioned snapshot of status, answers, claims, counters, limitations, revision and latest event sequence. |
| `GET /api/investigations/:id/events` | SSE events with persisted sequence IDs; honor `Last-Event-ID`, heartbeat every 15 seconds, reconnect without starting work. |
| `GET /api/investigations/:id/graph?claimId=…` | Claim-filtered graph with stable IDs and evidence references. |
| `GET /api/investigations/:id/evidence/:evidenceId` | Drawer details restricted to this investigation. |
| `POST /api/investigations/:id/cancel` | Idempotent cancel request; preserve all completed artifacts. |
| `GET /api/investigations/:id/export?format=json\|html` | Sanitized, versioned export built from the saved revision; no network/model calls. |

Return consistent `{code, message, retryable}` errors, 400 for invalid input and 404 for missing IDs. Client graph grouping is a view operation, never a paid analysis request. SSE updates trigger snapshot reconciliation; if SSE fails, poll the snapshot every three seconds. On replay, no collection or model call is permitted. A new live run creates a new investigation. Export HTML must be static escaped content; omit raw page HTML and full provider payloads from exports.

### 5. Worker, failure recovery, and hard budgets

Investigation stages: `created → collecting → analyzing → tracing → following_up → finalizing`. Terminal statuses: `complete`, `partial`, `failed`, `cancelled`. Stage is independent of status. `complete` means the scheduled bounded workflow finished, not that truth or provenance is fully resolved. `partial` means usable observations exist but a requested stage failed or a limit interrupted pending work. `failed` means no usable observations remain. Missing coverage is always shown, including ordinary no-answer responses in otherwise complete runs.

Tasks use `queued`, `running`, `succeeded`, `failed`, `unknown_outcome`, and `cancelled`. Claim tasks transactionally using leases (120 seconds, renew every 20 seconds); recover expired leases on worker start. Unique logical task keys and atomic result commits prevent duplicate local execution/results. **Do not promise exactly-once external charges.** If a crash/timeout occurs after dispatch but before persisting the result, recover by provider request ID only when supported and validated; otherwise mark `unknown_outcome` and do not automatically redispatch. Retain the consumed/reserved attempt in the budget and explain the missing result. Never blindly requeue an expired dispatched task.

Default per-investigation limits (all server-enforced, snapshotted at creation):

| Resource | Default |
|---|---:|
| SerpApi HTTP attempts, including follow-ups/retries/token fetches | 12 |
| Investigative follow-up actions | 4 |
| Unique source documents scheduled, including failed fetches | 20 |
| Source HTTP attempts, including redirects/retries | 40 |
| Upstream depth from an initially cited document (depth 0) | 2 |
| Model attempts, including schema repairs | 12 |
| Aggregate model input/output tokens | 60,000 / 12,000 |
| Extracted claim occurrences | 60 (20 per answer surface) |
| Per-document extracted text sent for analysis | 20,000 characters |
| Total investigation wall time | 10 minutes |
| Concurrent SerpApi / source / model requests | 2 / 3 / 1 |

Use 60-second search/model timeouts and 15-second source-fetch timeouts, configurable after the spike. One retry maximum for explicit retryable 429/5xx responses, honoring `Retry-After` and remaining deadline; no retries for auth/validation errors. Timeout/connection outcomes after dispatch are ambiguous and follow the rule above. Source GET failures may retry once within the source budget. Reserve request units and worst-case allowed model tokens atomically before dispatch; reconcile model usage when known, retain reservation when unknown. Count every provider attempt conservatively; do not equate that count with confirmed billed credits. Persist provider-reported billing separately when available. A missing token estimator is a setup failure for live model use, not permission to bypass token limits.

On cancellation or deadline, stop scheduling, abort requests where possible, and preserve safe late responses without launching downstream work. Finalize with explicit stop reasons. Each stage is a fan-out/fan-in barrier over persisted task states; restart resumes pending safe work, never the entire stage.

Cache successful normalized searches for 24 hours by provider/engine/query/effective parameters/adapter version; case and quoted text must remain significant. Cache source snapshots for 24 hours by validated URL and retrieval version. Show original retrieval time and distinguish local cache, provider cache (when reported), fresh dispatch, and unknown provider freshness. Fresh mode bypasses local cache and requests provider refresh where supported; it cannot promise provider freshness. Cache hits create lineage to the saved observation and consume no provider attempt. Do not cache failures or expired continuation tokens. Freeze snapshots used by a completed investigation.

### 6. Claim alignment and support verification

Extract atomic occurrences with exact validated spans and all qualifiers. Reject invented quotes/IDs; permit one schema-repair call within budget, then leave that block unprocessed with a warning. Cap output rather than silently dropping overflow; expose truncation. Batch calls so the default model budget can cover extraction, alignment, and document inspection; when it cannot, show partial coverage.

Propose candidate claim pairs using deterministic token/entity overlap. Ask the model for typed relationships on bounded pairs. Merge only `equivalent` occurrences whose population, dates, units, denominator, polarity, conditions, and certainty are compatible. Require compatibility with every member before extending a group: A≈B and B≈C does not automatically establish A≈C. Uncertain pairs stay separate. Broader/narrower and qualification differences are visible variants, never silent equivalents. Contradiction requires compatible scope and a conflicting proposition; silence is not contradiction.

Count distinct surfaces per claim group once regardless of repeated blocks. Display addressed/qualified/conflicting/not-addressed/unknown-analysis states against the selected-surface denominator, with unavailable surfaces separate. Use `not_addressed` only when that answer was fully analyzed; missing/truncated/failed analysis is unknown. Do not call surface expression verified factual support.

After document retrieval, evaluate each candidate citation-to-claim association against the inspected text. Store `ClaimSupport` with validated quotes and method (`model_assessed` or explicit deterministic rule). `not_found` means no support located in inspected text, not that the claim is false; blocked or truncated relevant text remains unresolved. Block-level citations are only candidates until this step. Model assessments remain labeled assessments even when their quotes are exact. Only inspected, relevant evidence can establish claim-specific support or a primary-evidence badge. Search snippets discover documents and never substitute for inspected evidence.

### 7. Retrieval, provenance, and accounting rules

Normalize scheme/host casing, default ports and fragments; remove only allowlisted tracking parameters such as `utm_*`, `gclid`, and `fbclid`. Preserve path case and content-bearing query parameters. Record redirects as aliases. A canonical tag alone is a proposed alias; require matching extracted main text or other corroboration before merging, especially across domains. Empty/error/template pages never count as matching content. Ignore boilerplate in overlap checks. Reprints require explicit attribution and a documented overlap rule; implement exact normalized main-text matching first, and leave approximate matches as candidates until evaluated on labeled fixtures.

Use one safe-fetch module for every externally supplied URL, including source links returned by search. Permit HTTP/HTTPS on ports 80/443 only, reject URL credentials, local/internal names, private/reserved/link-local/loopback/multicast IPs and IPv4-mapped IPv6 equivalents. Resolve and validate all DNS answers, pin the validated destination for the connection while retaining hostname/TLS validation, and repeat validation on every redirect (maximum three). Do not rely on preflight DNS validation followed by an unrestricted fetch. Apply streamed decompressed body limits of 2 MiB, HTML/text MIME allowlisting and the deadline. Never execute scripts, load page subresources, or bypass access controls. PDF and unsupported content produce an inspectable unresolved reason. Extract with a non-executing DOM parser/readability library.

Keep extracted source text locally for offset validation; use short excerpts in the UI/export. Treat all fetched text as untrusted data in model prompts, disable model tools, validate every returned ID/quote, escape rendered strings, and allow only safe external-link schemes. Scrub credentials in headers, nested URLs, errors and provider payloads before persistence/logging. Do not send secrets in source fetch headers.

Relationship semantics:

- `SAME_DOCUMENT` is identity and may group globally after corroboration.
- `REPRINT_OF` needs explicit attribution plus validated text overlap; retain originals and direction evidence.
- `EXPLICITLY_CITES` records a reference. Only a claim-specific, support-assessed edge contributes to that claim's provenance path. A bibliography link alone is not support.
- `SHARES_WORDING` is undirected similarity and never reduces evidence counts.
- `LIKELY_DERIVED` is informational, inferred, and excluded from MVP counting/grouping.
- `USES_EVIDENCE` connects a document to an identified root with claim-specific evidence. A shared DOI establishes study identity, not support for every claim in that study.

Do not union connected components of the entire graph. Collapse identity/reprint nodes only under confirmed rules; represent shared roots as expandable, potentially overlapping groups in the selected claim view. A document depending on two roots belongs to both and must not merge those roots. Detect cycles, display them, and mark paths without a verified root unresolved. Reaching maximum depth does not promote a terminal article into a primary root. Distinct root identifiers mean distinct observed evidence items, not statistically independent evidence; datasets and studies may still be related.

For each claim calculate deterministic, revisioned metrics:

- Citation occurrences `C`; resolved unique cited documents `D`; unresolved citation identities separately.
- Confirmed duplicate/reprint groups, preserving each group's member IDs.
- Observed identified roots `R`, with identity evidence and support paths.
- Disjoint document buckets: mapped only to one root; mapped to multiple roots; unresolved (including incomplete provenance paths). Sum of these buckets equals `D`. Separately show provisional known paths on unresolved documents.
- Per-root coverage is overlapping and is never summed as a partition. Show `8 documents reference report A; 2 of those also reference study B` when applicable.
- Inspected primary-evidence count, contradictory evidence count, and unresolved/truncated coverage, each with evidence IDs.

Use template-based summaries from these metrics. Never output a truth score, independence score, probability of copying, or a claim that remaining unknown sources are independent. A drift finding needs two exact excerpts and compatible claim scope; record it as an assessed qualification change, not an accusation of deception.

### 8. Bounded follow-up planner

Implement deterministic action selection over persisted evidence gaps; do not build an open-ended model agent. Use Google Search for every MVP action. Priority: identify a specifically named missing upstream root; inspect a known qualification gap; find primary evidence when only secondary reporting exists; seek counter-evidence for the most-expressed claim with no inspected contrary evidence. Distinctive phrase search is eligible only when a validated unusual shared span exists. News expansion and Scholar remain deferred.

Generate query templates from validated names/quotes/claim text, cap queries at 300 characters, and persist trigger IDs, purpose, engine, query, qualitative expected gain, and current budget before dispatch. Deduplicate exact normalized engine/query/locale combinations across the investigation. Run follow-ups serially and recompute after each action. Rank new candidates by exact identifier/title match, then provider rank; fetch at most three new documents per action within global limits. Provenance depth is measured from the discovery seed at depth zero, and upstream expansion always stops after two hops; no recursive query planning can reset that depth within an action.

Useful gain means a newly inspected relevant document, a supported relationship/root, a resolved gap, or inspected counter-evidence. Stop after two consecutive actions with no gain, no eligible actions, or any exhausted global limit. A failed search adds no gain but does not establish absence. Save stop reasons and before/after metrics. Do not offer a fresh follow-up inside immutable replay in the MVP; use a separate new live run for the demo.

### 9. Verification gates and worker completion contract

Start fixtures in batch 1. Offline tests must never consume live provider credits. Include successful generated answers, no answer, zero citations, unresolved reference indexes, token follow-up, 429, malformed JSON, and unknown dispatch outcomes. Include HTML fixtures for identity, reprints, two separate reports sharing one dataset, multiple roots, cycles, unsupported PDF, inaccessible documents, and malicious links/prompt instructions.

Minimum evaluation set: 40 labeled claim pairs (10 equivalent, 10 conflicting, 10 scope/qualification/numeric variants, 10 unrelated), 30 provenance cases (10 documented dependencies, 10 similarity/ownership negatives, 10 identity/multiple-root/cycle/unresolved cases), and 20 citation-support examples covering all five statuses. Reserve at least one third before tuning as held-out examples. Report numerator/denominator by class and list all errors; this small set is a regression gate, not a general accuracy claim.

Release thresholds: 100% accepted spans/IDs resolve; zero false dependency merges and zero scope/numeric variant merges on the evaluation fixtures; at least 90% equivalence precision and 80% recall on labeled pairs; at least 80% recall for explicit dependencies; at least 90% precision on support assignments; 100% displayed consequential conclusions have inspectable receipts. If there are no predictions, precision is undefined and does not pass. When a threshold fails, fix the rule or disable that inference and report reduced coverage; do not relabel the fixtures to pass. Record model/prompt versions and disclose any held-out tuning.

Required integration checks: concurrent task claims; crash before dispatch versus after dispatch; refresh/SSE reconnect; cache key/expiry/fresh behavior; model validation failure; cancellation; budget reservations under concurrency; cycle/overlap arithmetic; redirect/private-IP/DNS rebinding blocking; secret redaction and HTML escaping. Use mocked transports for network edge cases. Playwright covers create → progress → claim selection → graph grouping → evidence drawer → saved replay/export, plus one partial failure and cancellation. Keyboard operation must work through graph-equivalent list controls and return focus from the drawer. No layout clipping at 375 px or 1280 px viewport widths.

Each batch ends with: runnable changes, exact commands run and outcomes, remaining limitations, and its acceptance evidence. Run typecheck, lint, applicable tests and build before handoff. At final delivery provide migration/setup instructions, offline fixtures, capability/evaluation reports, and one supported live example plus one contrasting diversity example if credentials permitted. Missing live validation is explicitly outstanding and prevents claiming the full live release gate passed. Do not invent a demo finding.

### 10. Execution order and scope cuts

Keep the seven batches below, with these concrete exits:

1. Scaffold runnable web/worker/database/fixture mode, complete or document the capability gate, freeze adapter fixtures and chosen runtime.
2. Implement API, budgets, leases, request attempts, cache, SSE, cancellation and failure recovery before paid collection scales up.
3. Persist claim occurrences/groups and pass span/scope/alignment gates; expose comparison table.
4. Implement safe HTML retrieval, support assessments, root identity, evidence edges and deterministic accounting; pass adversarial and multi-root tests before graph grouping.
5. Add the bounded planner and demonstrate one traceable before/after change with fixtures, then live where available.
6. Complete linked views, accessibility, history and immutable export/replay; pass the browser journey.
7. Run evaluation, clean-install checks and live smoke validation; prepare local submission materials and report unmet external publication steps.

The earlier five-day schedule is an aspirational timebox, not a delivery commitment. Cut Brave, extra follow-up action types, approximate reprint detection, inferred edges, animations, and optional export polish first. Do not cut citation receipts, safe fetching, budget enforcement, unresolved states, or evaluation. If time is short, fewer inspected sources with explicit limits is preferable to unsupported grouping. No hidden external requirement or prior conversation is needed to execute this handoff.

## Product objective and batch detail

Build Consensus Trap around one complete investigation: **enter a factual question, capture answers from several search surfaces, trace their supporting sources, and show how much apparent agreement survives after shared evidence is accounted for.**

The seven batches below are ordered so each produces something runnable. Finish the acceptance criteria for a batch before adding more scope.

One correction to the earlier plan: different search engines are **not independent witnesses by default**, and shared citations do **not imply a claim is false**. The application should measure observed agreement and documented source dependencies. It should expose uncertainty wherever the available evidence cannot establish a relationship.

Use the stack fixed in the implementation contract. Keep URL normalization, graph operations, and evidence accounting in ordinary code.

## Batch 1 — Validate SerpApi and establish the investigation foundation

**Goal:** Prove the required data is available before committing to the more difficult analysis.

Start by running a small set of questions through the documented SerpApi endpoints using your account. The earlier research verified documentation, but we have not tested actual responses, latency, coverage, or account access.

**Work**

- Test Google Search, Google AI Mode, and Bing Copilot.
- Test Brave AI Mode as an optional additional surface.
- Test AI Overview extraction and its immediate follow-up request when a token is returned.
- Inspect which responses actually contain answer text, source URLs, and claim-to-reference mappings.
- Record latency, failures, missing citations, and search-credit consumption.
- Pick three core surfaces based on these results.
- Create the application, database migrations, worker process, and environment configuration.
- Keep API keys on the server.
- Establish a typed adapter interface so engine-specific response differences stay isolated.

**Core records**

| Record | Purpose |
|---|---|
| `Investigation` | Question, locale, status, budget, creation time |
| `SearchRun` | Engine, query, parameters, status, latency, purpose |
| `RawResponse` | Original provider response with secrets removed |
| `AnswerBlock` | Text, surface, position, provider reference indexes |
| `Citation` | URL, title, source, associated answer blocks |
| `InvestigationEvent` | Progress events consumed by the interface |

Preserve the difference between an engine returning no answer, an API failure, and an answer with no citations.

**Deliverable**

A developer screen where entering a question returns saved, inspectable responses from the selected SerpApi surfaces.

**Acceptance criteria**

- Three selected surfaces pass the capability gate for the full live milestone; the documented two-surface fallback permits continued implementation but does not pass that milestone.
- Raw responses and normalized observations are stored.
- A failed surface does not discard successful results.
- Every observation includes the query, locale, retrieval time, and engine.
- There is a written capability matrix documenting unsupported or unreliable features.

**Scope decision:** If a surface is unreliable, remove it from the default investigation. Do not spend the build maintaining browser-automation fallbacks.

## Batch 2 — Build reliable parallel collection and the initial results screen

**Goal:** Turn the adapters into a bounded, resumable investigation.

**Work**

- Create an investigation endpoint that returns an ID immediately.
- Run initial searches in the worker with limited concurrency.
- Stream progress through server-sent events.
- Save each completed search independently.
- Add timeouts and limited retries for transient failures.
- Persist task states so refreshing the interface does not restart paid searches.
- Use a local cache keyed by engine, query, and relevant parameters.
- Distinguish cached observations from freshly collected ones.
- Handle AI Overview token retrieval promptly within the adapter.
- Capture ordinary Google results alongside generated answers.

Use a simple workflow:

```text
Created → Collecting → Analyzing → Tracing → Following up → Finalizing
Terminal status: Complete / Partial / Failed / Cancelled
```

“Partial” means the user still receives a usable result with missing coverage identified.

**Initial budget**

Make limits configurable. A sensible starting envelope is:

- Three answer surfaces.
- One ordinary search baseline.
- Up to four investigative follow-up searches.
- Up to twenty unique source documents.
- No more than two provenance hops.

These are engineering limits to test, not verified cost estimates. Extra requests, pagination, and retries can change consumption.

**Interface**

Show:

- The user’s question.
- One answer card per surface.
- Citation counts and links.
- Collection progress.
- A collapsible search log.
- Fresh, cached, unavailable, and failed states.

**Deliverable**

A working comparison tool that collects real answers through SerpApi and survives individual failures.

**Acceptance criteria**

- Investigations continue after a page refresh.
- The user can inspect every answer and citation.
- Duplicate queued tasks do not dispatch duplicate searches; interrupted dispatched requests use the unknown-outcome recovery policy rather than an exactly-once billing promise.
- Budget exhaustion produces a partial result.
- The interface never invents an answer for a missing surface.

## Batch 3 — Extract and align claims with traceable citations

**Goal:** Determine which specific propositions the surfaces agree about.

**Work**

Use structured LLM output to extract atomic claims from answer blocks. Each extracted claim must retain its original text span.

Example:

> “A small trial found that X may improve sleep in older adults.”

Represent:

```json
{
  "proposition": "X improves sleep",
  "population": "older adults",
  "certainty": "tentative",
  "evidence_scope": "small trial",
  "source_span": "A small trial found that X may improve sleep in older adults."
}
```

Then:

- Group equivalent claims across surfaces.
- Preserve qualifiers, population, dates, units, and conditions.
- Classify relationships as equivalent, narrower, broader, conflicting, or unrelated.
- Use embeddings to propose similar pairs if helpful.
- Use structured model evaluation for ambiguous pairs.
- Validate that extracted spans exist in the original answer.
- Preserve provider citation mappings where present.
- Mark citations attached to an entire paragraph as block-level references.

Do not assume every citation associated with a paragraph supports every claim inside it.

**Consensus display**

Prefer observable counts:

> Of three available, fully analyzed surfaces, two express this claim and one expresses a more qualified variant.

Avoid an uncalibrated “92% consensus confidence.”

**Deliverable**

A claim comparison table with linked answer excerpts and citation references.

**Acceptance criteria**

- Each claim links back to an exact answer excerpt.
- “May improve” and “proven to improve” remain distinguishable.
- Different denominators or populations do not collapse into one statistic.
- Silence is not classified as disagreement.
- Citation attachment and verified support are visibly different concepts.

**Focused evaluation**

Create a small hand-labeled set containing equivalent claims, contradictions, qualification changes, and numeric mismatches. Measure alignment errors before proceeding.

## Batch 4 — Retrieve source documents and reconstruct supported provenance

**Goal:** Establish why multiple citations might depend on the same underlying evidence.

This is the hardest batch and the largest feasibility risk.

**Work**

Build a bounded document-retrieval pipeline:

- Normalize URLs conservatively.
- Follow redirects and record the resolved address.
- Extract readable article text, outbound links, attribution, and available dates.
- Record retrieval failures and inaccessible documents.
- Support HTML/text in the MVP; record PDFs as unsupported and unresolved.
- Retain short evidence excerpts and content hashes.
- Apply outbound-request protection against private/internal addresses and unsafe redirects.

Use separate relationship types:

| Relationship | Supporting evidence |
|---|---|
| Same document | Validated redirect or matching main content; canonical hints require corroboration |
| Syndicated/reprinted | Explicit attribution plus substantial text overlap |
| Explicitly cites | Link or named reference tied to the relevant claim |
| Shares wording | Distinctive matching passage |
| Likely derived | Multiple signals supporting a directional relationship |
| Same underlying study | Matching DOI, report identifier, or explicit study reference |

A shared phrase alone establishes similarity, not copying direction. A timestamp alone does not establish the original source.

Store each relationship with its evidence and status:

```json
{
  "type": "EXPLICITLY_CITES",
  "from_document": "article-b",
  "to_document": "report-a",
  "evidence_excerpt": "According to the report published by...",
  "claim_ids": ["claim-7"],
  "status": "observed"
}
```

For inferred relationships, use labels such as “possible” or “likely” with the reasons. Do not manufacture precise probabilities.

**Graph design**

Keep three layers distinct:

- Which answer cites which document.
- Which documents cite or resemble other documents.
- Which study, dataset, interview, or report supports a specific claim.

Two articles can be independently written while relying on the same dataset. That matters without making either article a copy.

**Deliverable**

An inspectable provenance graph with evidence attached to every consequential edge.

**Acceptance criteria**

- Duplicate URLs and reprints can collapse without losing the originals.
- Shared ownership alone does not establish shared evidence.
- Similar wording is not automatically classified as derivation.
- Dates carry their source and uncertainty.
- Inaccessible documents remain unresolved.
- Dependency analysis is specific to claims where evidence permits.

## Batch 5 — Add targeted SerpApi follow-ups and evidence accounting

**Goal:** Make the system investigate gaps revealed by the graph.

The planner should choose among a small set of explicit actions rather than freely searching indefinitely.

**Available actions**

| Action | Trigger | SerpApi use |
|---|---|---|
| Find upstream source | Several documents attribute the claim to an unidentified report | Google Search |
| Search distinctive phrase | Repeated unusual wording appears | Exact-phrase Google Search |
| Find primary evidence | All support is secondary reporting | Targeted Google Search; Scholar deferred |
| Search counter-evidence | Supporting cluster dominates | Contrary and neutral reformulations |
| Check a qualification | Downstream wording is stronger than the cited evidence | Search for the exact study or report |
| Expand story coverage (deferred) | A news event has limited initial coverage | Google News, outside MVP |

Every planned search should contain:

```text
Question being tested
Observed reason for the search
Engine and query
Expected information gain
Remaining budget
```

After each result:

- Add new sources.
- Fetch only relevant documents within budget.
- Update relationships.
- Recalculate the evidence accounting.
- Stop after two consecutive actions without useful gain, no eligible actions, or exhausted budget, as defined in the planner contract.

**Result metrics**

Use understandable quantities:

- Surfaces expressing each claim.
- Total citations and unique documents.
- Confirmed duplicate/reprint groups.
- Observed upstream evidence roots.
- Documents with unresolved provenance.
- Claims with inspected primary evidence.
- Explicitly located counter-evidence.

Display uncertainty directly:

> 14 cited documents: 8 trace to one report, 2 trace to another study, and 4 remain unresolved.

Do not turn the unresolved four into independent roots or silently assign them to the dominant cluster.

For claim drift, show the text comparison:

> Report: “Associated with improvement in this sample.”  
> Article: “Proven to improve outcomes.”

Only show drift when the inspected evidence supports that conclusion.

**Deliverable**

A bounded investigation loop that visibly changes the evidence graph based on additional SerpApi searches.

**Acceptance criteria**

- Follow-up queries are justified by an actual evidence gap.
- New evidence can weaken the initial hypothesis.
- Search failure is not treated as proof that evidence does not exist.
- Every result says what was searched and what remains unresolved.
- There is no overall truth score.

## Batch 6 — Build the complete investigative interface

**Goal:** Make the analysis understandable within thirty seconds and inspectable within three minutes.

Use three connected views.

**1. Answer comparison**

Show the main claim, its variants, and the surfaces expressing each version. Keep qualification differences visible.

**2. Evidence graph**

Show answer surfaces, cited documents, and observed upstream evidence.

Offer a **Group shared evidence** control. When clicked, confirmed duplicates and supported dependency groups combine. Unknown relationships stay visible.

The reveal must reflect the investigation’s actual result. If the sources are diverse, the interface should show that equally clearly.

**3. Evidence drawer**

Clicking a node or edge opens:

- Original URL.
- Relevant excerpt.
- Retrieval time.
- Document date and its basis.
- Relationship explanation.
- Observed versus inferred status.
- Search that discovered it.

Add a concise investigation summary:

> Three answer surfaces support the headline claim. Most inspected citations rely on one report. Two sources provide separate evidence, and four documents could not be resolved.

**Additional work**

- Partial-result presentation and cancellation controls (worker cancellation is already required in batch 2).
- Saved investigation history.
- Progress without fabricated percentages.
- Simple JSON/HTML evidence export.
- A clearly labeled replay mode for saved investigations.
- Responsive layout and readable graph labels.
- Keyboard-accessible controls.

**Deliverable**

The full user journey from question to evidence inspection.

**Acceptance criteria**

- A first-time user understands the finding without reading the search log.
- Every important conclusion is one click away from supporting evidence.
- Graph grouping does not imply that shared evidence makes a claim false.
- Fresh runs and saved replays are visibly distinguished.
- A failed surface or inaccessible document does not break the presentation.

## Batch 7 — Evaluate, harden, and prepare the submission

**Goal:** Demonstrate that the product finds real dependencies without manufacturing them.

Build a small evaluation set with contrasting cases:

| Case | Expected behavior |
|---|---|
| Several reprints of one announcement | Group documented reprints |
| Independent reporting using one dataset | Show shared dataset while preserving separate reporting |
| Several distinct studies | Preserve separate evidence roots |
| Similar language without attribution | Mark similarity; avoid asserting direction |
| A missing qualifier in downstream coverage | Show the exact wording difference |
| Inaccessible sources | Report unresolved coverage |
| Conflicting numerical denominators | Keep claims separate |
| Strong independent agreement | Show strong evidence diversity |

Hand-label representative relationships and evaluate:

- Claim extraction and alignment errors.
- False dependency merges.
- Missed explicit dependencies.
- Incorrect citation-support assignments.
- Percentage of conclusions with inspectable evidence.
- Latency, API failures, and actual credit usage.

Prioritize precision over recall: missing a suspected connection is preferable to falsely claiming several sources derive from one.

**Hardening**

- Verify retries, cache behavior, cancellation, and budget limits.
- Treat fetched content as untrusted input to the LLM.
- Check malformed responses and missing fields.
- Remove secrets from stored responses, exports, and logs.
- Confirm reproducible installation from a clean checkout.
- Document limitations and supported engines.

**Demo preparation**

Find and verify one strong example through the actual implementation. The earlier “18 citations collapse into one source” scenarios were illustrative; they are not findings we have established.

Target a recording of about 2:45:

- **0:00–0:20:** State the question and show collected answers.
- **0:20–0:45:** Show apparent agreement and citation count.
- **0:45–1:25:** Group shared evidence and inspect one decisive relationship.
- **1:25–2:00:** Run a targeted follow-up through SerpApi.
- **2:00–2:25:** Show how the evidence changed the finding.
- **2:25–2:45:** Show uncertainty, source receipts, and practical value.

Use saved results to avoid waiting through the whole investigation and clearly label them. Demonstrate fresh follow-up behavior in a separate live investigation if reliable; replay itself performs no network calls.

**Submission package**

- Public repository.
- README with setup and sample investigation.
- Architecture and engine-to-feature mapping.
- Evaluation results.
- Known limitations.
- AI-tool disclosure.
- Accessible demonstration video.

**Acceptance criteria**

- The demonstrated finding is supported by actual collected evidence.
- At least one contrasting case shows the system preserving independent evidence.
- Judges can run the application with their own keys.
- Repository and video links work in a private browser window.

## Suggested allocation

Allocate effort approximately as follows:

| Batch | Effort |
|---|---:|
| 1. Capability validation and foundation | 10% |
| 2. Collection and orchestration | 12% |
| 3. Claim alignment | 16% |
| 4. Source provenance | 24% |
| 5. Follow-up investigation | 16% |
| 6. Interface | 12% |
| 7. Evaluation and submission | 10% |

If using a five-day timebox, tentatively target batches 1–2 on day one, batch 3 on day two, batch 4 on day three, batches 5–6 on day four, and batch 7 on day five. Re-estimate after the capability spike; this is not a delivery commitment. Begin evaluation examples during batch 1 so bad assumptions surface early.

The first things to cut are extra engines, multilingual comparisons, historical monitoring, generalized PDF handling, and elaborate animations. Preserve the complete chain: **real SerpApi observations → aligned claim → documented source relationship → targeted follow-up search → inspectable finding.**

