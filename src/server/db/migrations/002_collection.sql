ALTER TABLE investigations ADD COLUMN request_hash TEXT;

CREATE TABLE IF NOT EXISTS local_search_cache (
  cache_key TEXT PRIMARY KEY,
  surface TEXT NOT NULL,
  query TEXT NOT NULL,
  effective_parameters_json TEXT NOT NULL,
  normalized_observation_json TEXT NOT NULL,
  raw_responses_json TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_search_cache_expiry ON local_search_cache(expires_at);
