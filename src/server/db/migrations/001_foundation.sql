PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  requested_locale_json TEXT NOT NULL,
  effective_locale_json TEXT NOT NULL,
  selected_surfaces_json TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'replay', 'fixture')),
  status TEXT NOT NULL CHECK (status IN ('created', 'collecting', 'analyzing', 'tracing', 'following_up', 'finalizing', 'complete', 'partial', 'failed', 'cancelled')),
  stage TEXT NOT NULL,
  frozen_limits_json TEXT NOT NULL,
  stop_reasons_json TEXT NOT NULL DEFAULT '[]',
  analysis_revision INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  logical_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'unknown_outcome', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TEXT,
  next_eligible_at TEXT,
  input_hash TEXT NOT NULL,
  output_ids_json TEXT NOT NULL DEFAULT '[]',
  error_category TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (investigation_id, logical_key)
);

CREATE TABLE IF NOT EXISTS request_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dispatch_state TEXT NOT NULL CHECK (dispatch_state IN ('reserved', 'dispatched', 'completed', 'unknown_outcome')),
  sanitized_parameter_hash TEXT NOT NULL,
  provider_request_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  outcome TEXT,
  usage_json TEXT,
  budget_reservation_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_runs (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  surface TEXT NOT NULL,
  query TEXT NOT NULL,
  effective_parameters_json TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'answer', 'no_answer', 'unavailable', 'failed')),
  latency_ms INTEGER,
  provider_request_id TEXT,
  cache_provenance TEXT NOT NULL CHECK (cache_provenance IN ('local', 'provider', 'fresh_dispatch', 'unknown')),
  retrieved_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_responses (
  id TEXT PRIMARY KEY,
  search_run_id TEXT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  sanitized_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS answer_blocks (
  id TEXT PRIMARY KEY,
  search_run_id TEXT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  provider_reference_indexes_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  search_run_id TEXT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE,
  provider_reference_id TEXT,
  url TEXT NOT NULL,
  title TEXT,
  source TEXT
);

CREATE TABLE IF NOT EXISTS answer_block_citations (
  answer_block_id TEXT NOT NULL REFERENCES answer_blocks(id) ON DELETE CASCADE,
  citation_id TEXT NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
  attachment_scope TEXT NOT NULL CHECK (attachment_scope IN ('block', 'answer', 'unresolved')),
  PRIMARY KEY (answer_block_id, citation_id)
);

CREATE TABLE IF NOT EXISTS investigation_events (
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (investigation_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_tasks_ready ON tasks(state, next_eligible_at);
CREATE INDEX IF NOT EXISTS idx_search_runs_investigation ON search_runs(investigation_id, created_at);
