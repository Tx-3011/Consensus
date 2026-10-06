# Known Limitations

## Supported

- English-language observations from Google AI Mode, Bing Copilot, and Brave AI Mode through SerpApi.
- Google Search for bounded follow-up discovery.
- Public HTTP/HTTPS HTML, XHTML, and plain-text evidence on ports 80 and 443.
- Exact-text identity and explicit republication wording.
- Saved SQLite investigations, local replay, and static JSON/HTML exports.

## Not Supported

- PDFs, authentication walls, private-network sources, JavaScript-only pages, and bodies over 2 MiB.
- Approximate plagiarism detection or inferred copying direction from similar prose.
- Proof of statistical independence. A shared DOI or dataset is an observed common root, not a complete causal account.
- Exhaustive web research. Search, document, model, retry, and follow-up budgets are intentionally bounded.
- Medical, legal, financial, or scientific truth adjudication. The product exposes evidence and dependency signals; it does not certify conclusions.
- Multilingual comparison, historical monitoring, collaborative accounts, or hosted production operations.

Model classifications can be wrong. Exact quote validation prevents fabricated spans from being accepted, but it does not prove that a support label is semantically correct. `not_found` means support was not located in the inspected snapshot; inaccessible or truncated content remains `unresolved`. Provider APIs and response shapes can change after the documented capability run.

The checked-in evaluation is synthetic and offline. It verifies precision-oriented invariants, not live claim-extraction accuracy or provider reliability. A submission should distinguish fixture demonstrations from findings collected live.
