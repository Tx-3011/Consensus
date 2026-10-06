# Architecture

The local MVP runs Next.js and a separate `tsx` worker against one SQLite database in WAL mode. Network calls occur outside database transactions; derived artifacts and task state are committed in short transactions.

## Pipeline

```text
search tasks
  -> claim extraction
  -> claim alignment
  -> unique cited document fetches
  -> claim-specific support assessment
  -> deterministic roots, relationships, and accounting
  -> one persisted deterministic follow-up action
  -> ranked discovery documents through the same retrieval/support path
  -> recompute accounting and stop or select one next action
  -> finalized saved graph
```

`src/server/retrieval/fetch.ts` is the only live source-fetch boundary. It performs URL normalization, DNS validation, destination pinning, redirect revalidation, MIME and body limits, and non-executing Readability extraction. Fixture investigations use `FixtureDocumentRetriever` and make no source request.

The model may assess claim support but cannot create document identities, budget counts, graph arithmetic, or root identifiers. Every accepted support quote is validated against immutable snapshot text. DOI extraction, exact-content identity, evidence buckets, and cycle detection are deterministic TypeScript.

## Deliberate limits

- HTML, XHTML, and plain text only; PDFs are unresolved.
- Exact normalized-main-text identity only; approximate reprint matching is deferred.
- Reprint direction requires explicit republication language.
- Outbound links are stored for later bounded expansion, but an ordinary link alone does not become a claim-specific dependency edge.
- DOI roots identify observed evidence items; they do not imply statistical independence.
- Follow-up planning is deterministic TypeScript, not an autonomous model agent. Google Search is the only follow-up engine in the MVP.
- Follow-up searches run serially and cannot reset provenance depth or global budgets.

## Engine-to-feature mapping

| Engine/service | Product role | Not treated as |
|---|---|---|
| Google AI Mode via SerpApi | Initial answer and citation observation | Independent evidence root |
| Bing Copilot via SerpApi | Initial answer and citation observation | Independent evidence root |
| Brave AI Mode via SerpApi | Initial answer and citation observation | Independent evidence root |
| Google Search via SerpApi | Bounded follow-up discovery | Vote in answer consensus |
| Google AI Overview via SerpApi | Capability-tested experimental adapter; excluded by default | Validated production surface |
| Groq `openai/gpt-oss-120b` | Structured claim extraction, pair classification, and support assessment | Authority for URLs, hashes, budgets, or graph arithmetic |
| Deterministic TypeScript | Validation, grouping gates, provenance roots, planning, accounting, and exports | Semantic source-content interpreter |

## Trust boundaries

Provider payloads and fetched pages are untrusted. Keys stay server-side; stored payloads and exports recursively redact credential-shaped fields and URL query secrets. Model output must satisfy strict schemas, supplied-ID constraints, exact UTF-16 source spans, and one repair attempt. Live retrieval blocks private destinations, unsafe ports, redirect escapes, oversized bodies, and executable parsing.
