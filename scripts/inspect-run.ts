import { getDatabase } from "../src/server/db/client";

const db = getDatabase();
const id = process.argv[2];
const blockRows = db.prepare("SELECT search_runs.surface, answer_blocks.id, length(answer_blocks.text) AS characters, substr(answer_blocks.text, 1, 180) AS preview FROM answer_blocks JOIN search_runs ON search_runs.id = answer_blocks.search_run_id WHERE search_runs.investigation_id = ? ORDER BY search_runs.surface, answer_blocks.position").all(id);
console.log(JSON.stringify({
  blocks: blockRows,
  tasks: db.prepare("SELECT kind, logical_key, state, attempts, error_category, next_eligible_at FROM tasks WHERE investigation_id = ? ORDER BY kind, logical_key").all(id),
  attempts: db.prepare("SELECT request_attempts.outcome, request_attempts.dispatch_state, request_attempts.usage_json, tasks.kind, tasks.logical_key FROM request_attempts JOIN tasks ON tasks.id = request_attempts.task_id WHERE tasks.investigation_id = ? ORDER BY request_attempts.started_at").all(id),
  events: db.prepare("SELECT type, payload_json FROM investigation_events WHERE investigation_id = ? ORDER BY sequence DESC LIMIT 20").all(id),
}, null, 2));
db.close();
