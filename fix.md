# Fix Plan

The live investigation exposed two confirmed technical causes:

1. One run created roughly 30 claim-extraction tasks from three answers, exhausting Groq's 12-attempt budget.
2. The source retriever's DNS-pinning callback is incompatible with Node's address-family selection, causing sources to fail as `ERR_INVALID_IP_ADDRESS`, hidden behind `fetch failed`.

## Phase 1: Restore Source Retrieval

**Priority: Critical**

1. Fix the pinned DNS callback to support Node's `{ all: true }` lookup contract.
2. Explicitly control address-family selection.
3. Try validated public addresses sequentially, preferring IPv4 on the current Windows environment.
4. Preserve sanitized network error codes and phases:
   - DNS
   - Connection
   - TLS
   - Timeout
   - HTTP response
   - Content extraction
5. Retry only transient failures instead of retrying every failure.
6. Display each unresolved source with its hostname and specific reason.

**Expected result:** Accessible sources such as BBC, The Guardian, CSDS, Oxford, and Wikipedia can be inspected instead of all appearing as `fetch failed`.

## Phase 2: Reduce Model Calls

**Priority: Critical**

Replace one model call per answer fragment with one batched extraction per answer surface.

Current behavior:

```text
3 surfaces x approximately 10 blocks = approximately 30 model calls
```

Target behavior:

```text
3 surfaces = 3 extraction calls
1 alignment call
remaining budget reserved for support assessment
```

Implementation:

1. Keep individual answer blocks and citation mappings in storage.
2. Schedule one extraction task per search run rather than per block.
3. Send all blocks from that surface in one structured model request.
4. Require every extracted claim to include its original `blockId`.
5. Validate every quote and UTF-16 offset against that exact saved block.
6. Deduplicate redundant parent/child answer fragments before extraction.

## Phase 3: Make the Budget Phase-Aware

**Priority: High**

Divide the 12-attempt model budget deliberately:

- 3 initial claim extractions
- 1 claim alignment
- Remaining attempts for source-support assessment and limited repair

Additional behavior:

- Read the budget from the investigation's frozen configuration instead of hard-coding `12`.
- Do not enqueue tasks that cannot run within the remaining budget.
- Reserve one controlled repair attempt.
- Use a specific `model_budget_exhausted` state instead of generic failure.
- If alignment cannot run, preserve extracted claims as singleton groups.

## Phase 4: Handle Groq Rate Limits

**Priority: High**

1. Parse Groq's `Retry-After` or retry-delay information.
2. Retry one 429 response after the required delay.
3. Avoid immediately dispatching another model call while the token window is exhausted.
4. Reduce oversized prompts by:
   - Removing duplicated answer fragments
   - Applying a bounded per-surface character budget
   - Excluding navigation and citation-only fragments
5. Record rate-limit failures separately from malformed model output.

A rate limit should produce:

> Claim analysis paused because the model rate limit was reached. Retrying in 12 seconds.

Not:

> Model attempt budget exhausted.

## Phase 5: Decouple Retrieval From Model Analysis

**Priority: High**

Source retrieval should not depend on successful claim extraction.

After answer collection:

```text
                 -> claim extraction and alignment
answer collection
                 -> citation source retrieval
```

These branches should run independently.

That means a Groq failure can still produce:

- Collected answers
- Citation inventory
- Inspected source pages
- Exact duplicate/reprint relationships
- Evidence roots
- Useful source-access diagnostics

Only claim-specific support assessment would remain unavailable.

## Phase 6: Improve the Final Finding

A successful final result should provide:

1. **Direct answer:** the recurring reasons identified across surfaces.
2. **Agreement:** which reasons appeared across multiple surfaces.
3. **Evidence quality:** how many claims were supported by inspected sources.
4. **Dependency:** whether apparently separate citations share roots or reproduce each other.
5. **Disagreement:** materially conflicting explanations.
6. **Confidence state:** supported, provisional, or unavailable.

For the Congress/BJP question, the desired structure is:

> **Finding:** The strongest recurring explanations were anti-incumbency linked to corruption and governance concerns, economic dissatisfaction, and BJP's more effective Modi-centered campaign.

Then show:

- Surfaces expressing each reason
- Exact supporting source quotes
- Independent source-root count
- Shared or republished evidence
- Unresolved sources
- Contradictory interpretations

## Phase 7: Tests

Add regression coverage for:

- Three surfaces with ten blocks each produce three extraction tasks.
- Claims retain correct block IDs and citation scope.
- Sparse or one-based provider citation IDs attach correctly.
- The model budget preserves capacity for alignment and support.
- Groq 429 responses wait and retry once.
- DNS pinning works with `{ all: true }`.
- First validated address failing can fall back to another validated address.
- Network errors retain useful sanitized causes.
- Source retrieval proceeds when claim analysis fails.
- Failed sources appear with specific reasons.
- The Congress/BJP live query reaches a useful terminal result.

## Completion Criteria

Re-run the exact question and require:

- Three answer surfaces complete
- At least one claim extracted from each substantive answer
- Claims grouped into understandable recurring reasons
- Several accessible source pages inspected
- Specific reasons for inaccessible sources
- Graph visible when inspected documents exist
- No generic `fetch failed`
- No model-budget exhaustion during initial extraction
- Final result clearly marked `Finished`, `Finished with gaps`, or `Failed`
- A concise evidence-backed finding appears above the raw answer cards

Implementation order: source-fetch fix, model batching, rate-limit handling, parallel retrieval, final-result synthesis, then the exact live-query acceptance run.
