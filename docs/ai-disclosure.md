# AI-Tool Disclosure

The application uses Groq's hosted `openai/gpt-oss-120b` model in live mode for structured claim extraction, claim-pair classification, and citation-support assessment. Prompts identify provider and document content as untrusted data. Outputs are schema-validated, constrained to supplied identifiers, and checked against exact saved text spans before persistence. Fixture mode uses deterministic local outputs and makes no model request.

AI coding assistance was used during implementation for code generation, review, tests, and documentation. All generated changes remained subject to repository tests, TypeScript checks, linting, and production builds. No coding assistant is part of the deployed runtime path.

The product does not expose model chain-of-thought. It stores provider responses needed for reproducibility after recursive credential redaction and shows user-inspectable claims, quotes, source snapshots, uncertainty, request accounting, and deterministic graph relationships.
