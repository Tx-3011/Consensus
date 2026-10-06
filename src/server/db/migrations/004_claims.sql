CREATE TABLE IF NOT EXISTS claim_occurrences (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  answer_block_id TEXT NOT NULL REFERENCES answer_blocks(id) ON DELETE CASCADE,
  source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
  source_end_offset INTEGER NOT NULL CHECK (source_end_offset >= source_start_offset),
  source_quote TEXT NOT NULL,
  proposition TEXT NOT NULL,
  polarity TEXT NOT NULL CHECK (polarity IN ('positive', 'negative', 'mixed', 'not_applicable')),
  certainty TEXT NOT NULL CHECK (certainty IN ('established', 'probable', 'tentative', 'uncertain', 'reported')),
  population TEXT,
  time_scope TEXT,
  units TEXT,
  denominator TEXT,
  conditions TEXT,
  evidence_scope TEXT,
  extraction_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (answer_block_id, source_start_offset, source_end_offset, proposition)
);

CREATE TABLE IF NOT EXISTS claim_relations (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  left_occurrence_id TEXT NOT NULL REFERENCES claim_occurrences(id) ON DELETE CASCADE,
  right_occurrence_id TEXT NOT NULL REFERENCES claim_occurrences(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('equivalent', 'narrower', 'broader', 'conflicting', 'unrelated', 'uncertain')),
  accepted_equivalence INTEGER NOT NULL DEFAULT 0 CHECK (accepted_equivalence IN (0, 1)),
  rationale TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (left_occurrence_id <> right_occurrence_id),
  UNIQUE (investigation_id, left_occurrence_id, right_occurrence_id)
);

CREATE TABLE IF NOT EXISTS claim_groups (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  canonical_occurrence_id TEXT NOT NULL REFERENCES claim_occurrences(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_group_members (
  group_id TEXT NOT NULL REFERENCES claim_groups(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL REFERENCES claim_occurrences(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, occurrence_id),
  UNIQUE (occurrence_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_occurrences_investigation ON claim_occurrences(investigation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_claim_relations_investigation ON claim_relations(investigation_id, created_at);
