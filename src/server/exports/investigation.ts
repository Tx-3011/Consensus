export function buildInvestigationExport(snapshot: Record<string, unknown>) {
  return {
    schemaVersion: "investigation-export.v1",
    exportedAt: new Date().toISOString(),
    investigation: sanitizeExportValue(snapshot),
  };
}

export function sanitizeExportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeExportValue);
  if (typeof value === "string") return value.replace(/([?&](?:api_key|apikey|access_token|token)=)[^&#\s]+/gi, "$1[redacted]");
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    ["api_key", "apikey", "secret", "authorization", "token", "access_token"].includes(key.toLowerCase()) ? "[redacted]" : sanitizeExportValue(child),
  ]));
}

export function renderInvestigationHtml(snapshot: Record<string, unknown>) {
  const question = escapeHtml(String(snapshot.question ?? "Investigation"));
  const status = escapeHtml(String(snapshot.status ?? "unknown"));
  const claims = Array.isArray(snapshot.claims) ? snapshot.claims as Array<Record<string, unknown>> : [];
  const documents = Array.isArray(snapshot.documents) ? snapshot.documents as Array<Record<string, unknown>> : [];
  const followUps = Array.isArray(snapshot.followUps) ? snapshot.followUps as Array<Record<string, unknown>> : [];
  const accounting = snapshot.evidenceAccounting && typeof snapshot.evidenceAccounting === "object" ? snapshot.evidenceAccounting as Record<string, unknown> : {};
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${question} - Consensus Trap</title>
<style>body{margin:0;background:#101313;color:#e7e4da;font:16px/1.55 Arial,sans-serif}main{max-width:900px;margin:auto;padding:40px 24px}h1,h2{font-family:Georgia,serif;font-weight:400}h1{font-size:42px;line-height:1.08}h2{margin-top:36px;border-bottom:1px solid #2b3230;padding-bottom:8px}.meta{color:#8b8f89}.card{border:1px solid #2b3230;background:#171b1b;padding:16px;margin:10px 0}.label{color:#e6a75e;font-size:12px;text-transform:uppercase}blockquote{border-left:2px solid #e6a75e;margin:12px 0;padding-left:12px;color:#b6bab5}a{color:#e6a75e;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:200px 1fr;gap:8px}dt{color:#8b8f89}dd{margin:0}@media(max-width:600px){h1{font-size:30px}dl{grid-template-columns:1fr}}</style></head><body><main>
<p class="label">Consensus Trap evidence export</p><h1>${question}</h1><p class="meta">Saved status: ${status}. Static export; no network or model calls were made.</p>
<h2>Evidence accounting</h2><dl>${Object.entries(accounting).filter(([, value]) => typeof value !== "object").map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd>`).join("")}</dl>
<h2>Claims</h2>${claims.map((claim) => `<article class="card"><p class="label">${escapeHtml(String(claim.surface ?? "claim"))}</p><h3>${escapeHtml(String(claim.proposition ?? ""))}</h3><blockquote>${escapeHtml(String(claim.source_quote ?? ""))}</blockquote><p>${escapeHtml(String(claim.certainty ?? ""))}${claim.population ? ` · ${escapeHtml(String(claim.population))}` : ""}</p></article>`).join("") || "<p>No extracted claims.</p>"}
<h2>Documents</h2>${documents.map((document) => `<article class="card"><a href="${safeExternalUrl(String(document.normalized_url ?? ""))}">${escapeHtml(String(document.title ?? document.normalized_url ?? "Document"))}</a><p>${escapeHtml(String(document.outcome ?? "unresolved"))}${document.unresolved_reason ? ` · ${escapeHtml(String(document.unresolved_reason))}` : ""}</p></article>`).join("") || "<p>No saved documents.</p>"}
<h2>Follow-ups</h2>${followUps.map((action) => `<article class="card"><p class="label">${escapeHtml(String(action.action_type ?? "action"))}</p><p>${escapeHtml(String(action.reason ?? ""))}</p><code>${escapeHtml(String(action.query ?? ""))}</code><p>${Number(action.useful_gain) === 1 ? "Useful gain recorded" : "No useful gain recorded"}</p></article>`).join("") || "<p>No follow-up actions.</p>"}
</main></body></html>`;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? escapeHtml(url.toString()) : "#";
  } catch {
    return "#";
  }
}
