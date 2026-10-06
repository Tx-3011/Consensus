# Consensus Trap

Consensus Trap compares answer surfaces, keeps their citations inspectable, and measures observed source dependencies without treating search engines as independent witnesses.

The complete MVP collects answer surfaces, extracts and aligns scoped claims, retrieves cited evidence, maps documented provenance, runs bounded follow-up searches, and saves immutable replay/export views. It deliberately prefers an unresolved relationship over an unsupported dependency claim.

## Requirements

- Node.js 22 LTS or newer, below 25
- npm
- SerpApi key for live capability tests (optional for fixture mode)
- Groq key for live claim extraction and alignment (optional for fixture mode)

## Setup

PowerShell:

```powershell
npm install
Copy-Item .env.example .env.local
npm run db:migrate
npm run dev
# in a second terminal
npm run worker
# in a second terminal
npm run worker
```

POSIX shell:

```sh
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Open http://localhost:3000. Fixture mode is available without credentials and is visibly labeled. Live mode keeps keys server-side and returns an actionable setup message when `SERPAPI_API_KEY` or `GROQ_API_KEY` is missing. Live claim analysis uses `openai/gpt-oss-120b` through Groq's OpenAI-compatible endpoint; set `LLM_MODEL=openai/gpt-oss-120b` explicitly in `.env.local` if overriding the example.

Run the five-question capability gate in fixture mode:

```sh
npm run eval
```

Run it live after setting `SERPAPI_API_KEY`:

```sh
npx tsx scripts/capability-spike.ts
```

The live spike has its own 24-attempt ceiling and never retries automatically. It writes `docs/capabilities.md` only from the observed run. Do not interpret fixture output as live provider validation.

## Commands

`npm run dev`, `npm run worker`, `npm run db:migrate`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run eval`, `npm run evaluate`, `npm run build`, and `npm start` are available. `npm run eval` runs the offline SerpApi capability fixtures; `npm run evaluate` regenerates the eight-case precision report without provider calls.

## Current boundary

The API returns a queued investigation ID immediately. The worker claims unique logical tasks with leases and a concurrency limit of two for collection and retrieval, while model calls are serialized and capped at twelve attempts per investigation. Each completed artifact is persisted independently, so partial results survive failures and browser refreshes. The browser reconnects to `/api/investigations/:id/events` and falls back to status polling if the stream drops.

Batch 4 source retrieval allows only HTTP/HTTPS on ports 80/443, rejects credentials and non-public DNS answers, pins a validated destination for each connection, revalidates every redirect, allows at most three redirects, applies a 15-second timeout and 2 MiB decompressed body limit, and parses HTML without executing scripts or loading subresources. PDFs, inaccessible pages, oversized analysis text, blocked destinations, and exhausted model budgets remain visibly unresolved.

Claim support is separate from provider citation attachment. `supports`, `qualifies`, and `contradicts` require exact evidence quotes that resolve in the saved snapshot. `not_found` means no support was located in inspected text, not that the claim is false. DOI roots are deterministic stable-identifier observations, not proof that all documents using a DOI support every claim. Exact normalized main-text hashes establish identity; a directed reprint additionally requires explicit republication language. Approximate reprint detection and inferred copying direction remain disabled.

Saved graph and evidence routes are available at `/api/investigations/:id/graph?claimId=…` and `/api/investigations/:id/evidence/:evidenceId`. Graph filtering and evidence inspection never dispatch provider or model requests.

## Follow-up planner

After initial retrieval and support assessment settle, Batch 5 selects at most one persisted action at a time. Priority is: identify a named missing upstream item, inspect a qualification gap, find primary evidence, then seek counter-evidence for the most-expressed claim without inspected contrary evidence. Every action records its trigger receipts, reason, Google Search query, expected gain, remaining budget, before/after metrics, saved artifacts, and outcome.

Queries are capped at 300 characters and deduplicated by normalized engine/query/locale semantics. Results are ranked by exact query-term identifier/title matches and provider order; no more than three new documents are scheduled per action. The planner stops at four actions, two consecutive no-gain actions, any global search/document limit, or no eligible action. A failed search adds no gain and never proves evidence is absent. Fixture mode demonstrates a contrary document changing the evidence accounting without making any provider request.

## Sample investigation

Use fixture mode with the prefilled 1918 influenza question and all three validated answer surfaces. The saved result demonstrates an explicitly attributed reprint pair, separate claim groups, inspected support quotes, a bounded counter-evidence follow-up, local grouping, and static JSON/HTML export. Fixture labels are synthetic and must not be presented as a live research finding.

## Submission documents

- [`docs/architecture.md`](docs/architecture.md): pipeline and engine-to-feature mapping.
- [`docs/evaluation.md`](docs/evaluation.md): generated contrasting-case results.
- [`docs/limitations.md`](docs/limitations.md): supported inputs and known constraints.
- [`docs/demo.md`](docs/demo.md): recording script and evidence checklist.
- [`docs/ai-disclosure.md`](docs/ai-disclosure.md): AI-tool and runtime-model disclosure.
