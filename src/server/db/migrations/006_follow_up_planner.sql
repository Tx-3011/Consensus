CREATE TABLE IF NOT EXISTS follow_up_actions (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  claim_group_id TEXT NOT NULL REFERENCES claim_groups(id) ON DELETE CASCADE,
  trigger_evidence_ids_json TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('find_upstream_source', 'check_qualification', 'find_primary_evidence', 'search_counter_evidence')),
  state TEXT NOT NULL CHECK (state IN ('planned', 'searching', 'retrieving', 'complete', 'failed', 'cancelled')),
  engine TEXT NOT NULL CHECK (engine = 'google_search'),
  query TEXT NOT NULL CHECK (length(query) <= 300),
  reason TEXT NOT NULL,
  expected_gain TEXT NOT NULL CHECK (expected_gain IN ('high', 'medium')),
  budget_snapshot_json TEXT NOT NULL,
  search_run_id TEXT REFERENCES search_runs(id) ON DELETE SET NULL,
  before_metrics_json TEXT NOT NULL,
  after_metrics_json TEXT,
  actual_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  useful_gain INTEGER CHECK (useful_gain IN (0, 1)),
  stop_reason TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (investigation_id, engine, query)
);

CREATE TABLE IF NOT EXISTS follow_up_action_documents (
  action_id TEXT NOT NULL REFERENCES follow_up_actions(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  provider_rank INTEGER NOT NULL,
  PRIMARY KEY (action_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_actions_investigation ON follow_up_actions(investigation_id, created_at);
