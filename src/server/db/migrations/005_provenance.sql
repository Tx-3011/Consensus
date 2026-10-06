CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  normalized_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (investigation_id, normalized_url)
);

CREATE TABLE IF NOT EXISTS document_aliases (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  observed_url TEXT NOT NULL,
  alias_kind TEXT NOT NULL CHECK (alias_kind IN ('citation', 'redirect', 'canonical_hint')),
  corroborated INTEGER NOT NULL DEFAULT 0 CHECK (corroborated IN (0, 1)),
  PRIMARY KEY (document_id, observed_url)
);

CREATE TABLE IF NOT EXISTS citation_documents (
  citation_id TEXT PRIMARY KEY REFERENCES citations(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_snapshots (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  requested_url TEXT NOT NULL,
  final_url TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('fetched', 'unsupported', 'blocked', 'failed')),
  http_status INTEGER,
  mime_type TEXT,
  content_hash TEXT,
  extracted_text TEXT,
  title TEXT,
  outbound_links_json TEXT NOT NULL DEFAULT '[]',
  redirect_chain_json TEXT NOT NULL DEFAULT '[]',
  document_date TEXT,
  date_source TEXT,
  date_uncertain INTEGER NOT NULL DEFAULT 1 CHECK (date_uncertain IN (0, 1)),
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  unresolved_reason TEXT,
  retrieval_version TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_spans (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  snapshot_id TEXT REFERENCES document_snapshots(id) ON DELETE CASCADE,
  answer_block_id TEXT REFERENCES answer_blocks(id) ON DELETE CASCADE,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  exact_quote TEXT NOT NULL,
  context TEXT NOT NULL,
  CHECK ((snapshot_id IS NOT NULL) <> (answer_block_id IS NOT NULL)),
  CHECK (end_offset >= start_offset)
);

CREATE TABLE IF NOT EXISTS claim_support (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL REFERENCES claim_occurrences(id) ON DELETE CASCADE,
  citation_id TEXT NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
  snapshot_id TEXT REFERENCES document_snapshots(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('supports', 'qualifies', 'contradicts', 'not_found', 'unresolved')),
  rationale TEXT NOT NULL,
  analysis_method TEXT NOT NULL CHECK (analysis_method IN ('model_assessed', 'deterministic_rule')),
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (occurrence_id, citation_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS claim_support_evidence (
  claim_support_id TEXT NOT NULL REFERENCES claim_support(id) ON DELETE CASCADE,
  evidence_span_id TEXT NOT NULL REFERENCES evidence_spans(id) ON DELETE CASCADE,
  PRIMARY KEY (claim_support_id, evidence_span_id)
);

CREATE TABLE IF NOT EXISTS evidence_roots (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  stable_identifier TEXT NOT NULL,
  root_type TEXT NOT NULL CHECK (root_type IN ('study', 'dataset', 'report', 'interview', 'other')),
  label TEXT NOT NULL,
  identification_evidence_span_id TEXT REFERENCES evidence_spans(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (investigation_id, stable_identifier)
);

CREATE TABLE IF NOT EXISTS evidence_root_snapshots (
  root_id TEXT NOT NULL REFERENCES evidence_roots(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES document_snapshots(id) ON DELETE CASCADE,
  PRIMARY KEY (root_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('SAME_DOCUMENT', 'REPRINT_OF', 'EXPLICITLY_CITES', 'SHARES_WORDING', 'USES_EVIDENCE')),
  from_document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  to_document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  to_root_id TEXT REFERENCES evidence_roots(id) ON DELETE CASCADE,
  claim_group_id TEXT REFERENCES claim_groups(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('observed', 'possible', 'likely')),
  explanation TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  evidence_span_id TEXT REFERENCES evidence_spans(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (from_document_id IS NOT NULL),
  CHECK ((to_document_id IS NOT NULL) <> (to_root_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_documents_investigation ON documents(investigation_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_document ON document_snapshots(document_id, fetched_at);
CREATE INDEX IF NOT EXISTS idx_support_investigation ON claim_support(investigation_id, occurrence_id);
CREATE INDEX IF NOT EXISTS idx_relationships_investigation ON relationships(investigation_id, relationship_type);
