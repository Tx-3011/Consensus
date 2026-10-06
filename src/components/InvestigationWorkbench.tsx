"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Surface = "google_ai_mode" | "bing_copilot" | "google_ai_overview" | "google_search" | "brave_ai_mode";
type Investigation = {
  id: string;
  question: string;
  mode: string;
  status: string;
  stage: string;
  selectedSurfaces: Surface[];
  progress: Record<string, number>;
  tasks: Array<{ state: string }>;
  runs: Array<{ surface: Surface; status: string; latency_ms: number | null; cache_provenance: string; warnings?: string[] }>;
  blocks: Array<{ surface: Surface; text: string; referenceIndexes: number[] }>;
  citations: Array<{ surface: Surface; url: string; title: string | null; source: string | null }>;
  claims: Array<{
    id: string;
    surface: Surface;
    source_quote: string;
    source_start_offset: number;
    source_end_offset: number;
    proposition: string;
    polarity: string;
    certainty: string;
    population: string | null;
    time_scope: string | null;
    units: string | null;
    denominator: string | null;
    conditions: string | null;
    evidence_scope: string | null;
    citations: Array<{ url: string; title: string | null; attachment_scope: string }>;
  }>;
  claimGroups: Array<{ id: string; canonical_occurrence_id: string; memberIds: string[] }>;
  claimRelations: Array<{ relation: string; accepted_equivalence: number; left_occurrence_id: string; right_occurrence_id: string; rationale: string }>;
  documents: Array<{ id: string; normalized_url: string; outcome: string | null; title: string | null; unresolved_reason: string | null }>;
  supports: Array<{ id: string; occurrence_id: string; citation_id: string; status: string; rationale: string; exact_quote: string | null; evidence_span_id: string | null }>;
  roots: Array<{ id: string; label: string; root_type: string }>;
  relationships: Array<{ id: string; relationship_type: string; status: string; explanation: string; evidence_span_id: string | null }>;
  stopReasons: string[];
  followUps: Array<{
    id: string;
    action_type: string;
    state: string;
    query: string;
    reason: string;
    expected_gain: string;
    useful_gain: number | null;
    stop_reason: string | null;
    triggerEvidenceIds: string[];
    budgetSnapshot: Record<string, number>;
    beforeMetrics: Record<string, number>;
    afterMetrics: Record<string, number> | null;
    actualArtifactIds: string[];
  }>;
  evidenceAccounting: {
    citationOccurrences: number;
    resolvedUniqueDocuments: number;
    unresolvedCitationIdentities: number;
    observedRoots: number;
    contradictoryEvidence: number;
    unresolvedSupport: number;
    documentBuckets: { mappedOnlyOneRoot: number; mappedMultipleRoots: number; unresolved: number };
  };
  events: Array<{ sequence: number; type: string; payload: Record<string, unknown>; created_at?: string }>;
};

type HistoryItem = { id: string; question: string; mode: string; status: string; stage: string; created_at: string; finished_at: string | null };

const surfaceNames: Record<Surface, string> = {
  google_ai_mode: "Google AI Mode",
  bing_copilot: "Bing Copilot",
  google_ai_overview: "Google AI Overview",
  google_search: "Google Search baseline",
  brave_ai_mode: "Brave AI Mode",
};

const defaultSurfaces: Surface[] = ["google_ai_mode", "bing_copilot", "brave_ai_mode"];
const terminalStatuses = new Set(["complete", "partial", "failed", "cancelled"]);
const terminalTaskStates = new Set(["succeeded", "failed", "unknown_outcome", "cancelled"]);

export function InvestigationWorkbench() {
  const [question, setQuestion] = useState("What are the main causes of the 1918 influenza pandemic's high mortality?");
  const [mode, setMode] = useState<"fixture" | "live">("fixture");
  const [surfaces, setSurfaces] = useState<Surface[]>(defaultSurfaces);
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isReplay, setIsReplay] = useState(false);
  const [selectedClaimGroupId, setSelectedClaimGroupId] = useState<string | null>(null);
  const [groupSharedEvidence, setGroupSharedEvidence] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("investigation");
    if (id) { setActiveId(id); setIsReplay(true); }
    void loadHistoryPage();
  }, []);

  useEffect(() => {
    if (!investigation?.claimGroups.length) return;
    if (!selectedClaimGroupId || !investigation.claimGroups.some((group) => group.id === selectedClaimGroupId)) setSelectedClaimGroupId(investigation.claimGroups[0].id);
  }, [investigation, selectedClaimGroupId]);

  useEffect(() => {
    if (!activeId) return;
    let stopped = false;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/investigations/${activeId}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Investigation could not be loaded.");
        const snapshot = await response.json() as { investigation: Investigation };
        if (!stopped) setInvestigation(snapshot.investigation);
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : "Investigation could not be loaded.");
      }
    };
    void load();
    const source = new EventSource(`/api/investigations/${activeId}/events`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { snapshot: Investigation };
        setInvestigation(payload.snapshot);
        if (terminalStatuses.has(payload.snapshot.status)) source.close();
      } catch {
        setError("The progress stream returned an invalid update.");
      }
    };
    source.onerror = () => {
      source.close();
      if (!fallbackTimer) fallbackTimer = setInterval(() => void load(), 3_000);
    };
    return () => {
      stopped = true;
      source.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, [activeId]);

  const grouped = useMemo(() => {
    if (!investigation) return [];
    return investigation.selectedSurfaces.map((surface) => {
      const run = investigation.runs.find((item) => item.surface === surface);
      return {
        surface,
        run,
        block: run ? investigation.blocks.find((block) => block.surface === run.surface) : undefined,
        citations: run ? investigation.citations.filter((citation) => citation.surface === run.surface) : [],
      };
    });
  }, [investigation]);

  async function runInvestigation(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setInvestigation(null);
    setIsReplay(false);
    setSelectedClaimGroupId(null);
    try {
      const response = await fetch("/api/investigations", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ question, mode, surfaces, locale: { hl: "en", gl: "us" } }),
      });
      const created = await response.json() as { id?: string; message?: string };
      if (!response.ok || !created.id) throw new Error(created.message || "Investigation could not be created.");
      setActiveId(created.id);
      window.history.replaceState(null, "", `/?investigation=${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Investigation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadHistoryPage(cursor?: string) {
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/investigations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { items: HistoryItem[]; nextCursor: string | null };
      setHistory((current) => cursor ? [...current, ...body.items] : body.items);
      setHistoryCursor(body.nextCursor);
    } finally {
      setHistoryLoading(false);
    }
  }

  function openReplay(id: string) {
    setInvestigation(null);
    setActiveId(id);
    setIsReplay(true);
    setSelectedClaimGroupId(null);
    setGroupSharedEvidence(false);
    window.history.replaceState(null, "", `/?investigation=${id}`);
  }

  async function cancelActiveInvestigation() {
    if (!activeId) return;
    await fetch(`/api/investigations/${activeId}/cancel`, { method: "POST" });
  }

  function toggleSurface(surface: Surface) {
    setSurfaces((current) => current.includes(surface) ? current.filter((item) => item !== surface) : [...current, surface]);
  }

  const completedTasks = investigation ? investigation.tasks.filter((task) => terminalTaskStates.has(task.state)).length : 0;
  const taskTotal = investigation?.tasks.length ?? 0;
  const isActive = Boolean(investigation && !terminalStatuses.has(investigation.status));

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="wordmark" href="/">consensus<span>trap</span></Link>
         <div className="topbar-note"><span className="pulse" /> research demo · saved evidence <span className="topbar-version">batch 07</span></div>
      </header>

      <section className="intro">
        <div>
          <p className="kicker">Search surfaces are witnesses, not votes</p>
          <h1>What survives<br /><em>the citation trail?</em></h1>
        </div>
        <p className="intro-copy">Run one question through several answer surfaces. Keep the exact response, its references, and the conditions of collection together before making any claim about agreement.</p>
      </section>

      <section className="workbench">
        <form className="question-panel" onSubmit={runInvestigation}>
          <div className="panel-heading"><span>01</span><h2>Ask a question</h2></div>
          <label htmlFor="question">Factual question</label>
          <textarea id="question" value={question} maxLength={1000} onChange={(event) => setQuestion(event.target.value)} />
          <div className="field-meta"><span>{question.length}/1,000 characters</span><span>English / United States</span></div>

          <div className="panel-heading surfaces-heading"><span>02</span><h2>Choose witnesses</h2></div>
          <div className="surface-options">
            {["google_ai_mode", "bing_copilot", "brave_ai_mode", "google_ai_overview"].map((surface) => (
              <label className={`surface-option ${surfaces.includes(surface as Surface) ? "selected" : ""}`} key={surface}>
                <input type="checkbox" checked={surfaces.includes(surface as Surface)} onChange={() => toggleSurface(surface as Surface)} />
                <span className="checkbox" /><span>{surface === "google_ai_overview" ? "Google AI Overview · experimental" : surfaceNames[surface as Surface]}</span>
              </label>
            ))}
          </div>
          <label className="optional-surface surface-option">
            <input type="checkbox" checked={surfaces.includes("google_search")} onChange={() => toggleSurface("google_search")} />
            <span className="checkbox" /><span>+ Google Search baseline</span>
          </label>

           <div className="mode-row">
             <label htmlFor="mode">Run type</label>
             <select id="mode" value={mode} onChange={(event) => setMode(event.target.value as "fixture" | "live")}>
               <option value="fixture">Demo fixture · offline</option>
               <option value="live">Live research · SerpApi</option>
             </select>
           </div>
           <button className="run-button" type="submit" disabled={loading || !question.trim() || surfaces.length === 0}>
             {loading ? "Queueing…" : "Collect answers"}<span>↗</span>
           </button>
            <div className={`mode-explainer mode-${mode}`}>
              <strong>{mode === "fixture" ? "Demo fixture" : "Live research"}</strong>
              <p>{mode === "fixture" ? "Bundled, deterministic answers and sources. Safe for demos; it makes no provider requests and is not real-world evidence." : "Calls SerpApi and Groq with your server-side keys. Provider results, source access, and model analysis can be incomplete."}</p>
            </div>
            {mode === "live" && <p className="helper">Requires <code>SERPAPI_API_KEY</code> for collection and <code>GROQ_API_KEY</code> for claim analysis.</p>}
           {error && <p className="error-message">{error}</p>}
           <HistoryPanel items={history} activeId={activeId} loading={historyLoading} hasMore={Boolean(historyCursor)} onOpen={openReplay} onMore={() => historyCursor && void loadHistoryPage(historyCursor)} />
        </form>

        <section className="results-panel" aria-live="polite">
           <div className="panel-heading"><span>03</span><h2>Research result</h2>{investigation && <><span className={`status-chip status-${investigation.status}`}>{runStatusLabel(investigation.status)}</span>{isActive && <button className="cancel-button" type="button" onClick={() => void cancelActiveInvestigation()}>Stop run</button>}</>}</div>
          {!investigation && !loading && <div className="empty-state"><div className="empty-mark">⌁</div><h3>Nothing collected yet</h3><p>Your first run will keep raw responses, normalized answer blocks, citation mappings, and an ordered event trail.</p></div>}
          {loading && <div className="empty-state loading-state"><div className="loader" /><h3>Queueing selected surfaces</h3><p>The API returns immediately; the worker saves each surface independently.</p></div>}
          {investigation && <>
             <div className="question-receipt"><span>Question</span><p>{investigation.question}</p><small>{isReplay ? "saved replay · immutable · no network calls" : investigation.mode === "fixture" ? "fixture observation" : "fresh live SerpApi observation"}</small><div className="export-links"><a href={`/api/investigations/${investigation.id}/export?format=json`} download>Export JSON</a><a href={`/api/investigations/${investigation.id}/export?format=html`} download>Export HTML</a></div></div>
             <div className="progress-wrap"><div className="progress-label"><span>{isActive ? `${completedTasks}/${taskTotal || investigation.selectedSurfaces.length} steps complete` : "Run complete"}</span><span>{isActive ? stageLabel(investigation.stage) : runStatusLabel(investigation.status)}</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${taskTotal ? Math.round((completedTasks / taskTotal) * 100) : 0}%` }} /></div></div>
             <RunOutcome investigation={investigation} />
             <div className="answer-grid">
              {grouped.map((item) => {
                const status = item.run?.status ?? "pending";
                return <article className="answer-card" key={item.surface}>
                  <div className="card-topline"><span>{surfaceNames[item.surface]}</span><span className={`outcome outcome-${status}`}>{status.replace("_", " ")}</span></div>
                  <p className="answer-text">{item.block?.text || (item.run ? "No answer text returned." : "Waiting for a saved observation.")}</p>
                   <div className="card-footer"><span>{item.citations.length} citation{item.citations.length === 1 ? "" : "s"}</span><span>{item.run?.latency_ms ?? "—"} ms</span><span>{provenanceLabel(item.run?.cache_provenance, investigation.mode)}</span></div>
                  {item.citations.length > 0 && <div className="citation-list">{item.citations.map((citation) => <a href={citation.url} target="_blank" rel="noreferrer" key={`${item.surface}-${citation.url}`}>{citation.title || citation.url}</a>)}</div>}
                </article>;
               })}
             </div>
             <ClaimComparison investigation={investigation} selectedGroupId={selectedClaimGroupId} onSelect={setSelectedClaimGroupId} />
             <FollowUpTrail investigation={investigation} />
             <EvidenceGraph investigation={investigation} claimGroupId={selectedClaimGroupId} grouped={groupSharedEvidence} onToggleGrouping={() => setGroupSharedEvidence((current) => !current)} />
             <details className="event-log" open={!isActive}><summary className="log-title">Collection log <span>{investigation.events.length} events</span></summary>{investigation.events.slice(-12).map((event) => <div className="event-line" key={event.sequence}><span>{String(event.sequence).padStart(2, "0")}</span><span>{event.type}</span><span>{new Date(String(event.created_at || Date.now())).toLocaleTimeString()}</span></div>)}</details>
           </>}
        </section>
      </section>
      <footer><span>Consensus Trap</span><span>Observation before interpretation · no overall truth score</span></footer>
    </main>
  );
}

function HistoryPanel({ items, activeId, loading, hasMore, onOpen, onMore }: { items: HistoryItem[]; activeId: string | null; loading: boolean; hasMore: boolean; onOpen: (id: string) => void; onMore: () => void }) {
  return <details className="history-panel" open={items.length === 0}>
    <summary className="history-heading"><span>Saved runs</span><span>{items.length} saved · open</span></summary>
    {items.length === 0 && !loading && <p>No saved investigations yet.</p>}
    <div className="history-list">{items.map((item) => <button type="button" className={item.id === activeId ? "active" : ""} key={item.id} onClick={() => onOpen(item.id)}>
      <span>{item.question}</span><small>{item.mode} · {item.status} · {new Date(item.created_at).toLocaleDateString()}</small>
    </button>)}</div>
    {hasMore && <button className="history-more" type="button" disabled={loading} onClick={onMore}>{loading ? "Loading…" : "Load older"}</button>}
  </details>;
}

function RunOutcome({ investigation }: { investigation: Investigation }) {
  const accounting = investigation.evidenceAccounting;
  const answerRuns = investigation.runs.filter((run) => ["answer", "no_answer"].includes(run.status));
  const answeredRuns = investigation.runs.filter((run) => run.status === "answer");
  const unresolved = accounting.unresolvedCitationIdentities + accounting.unresolvedSupport;
  const reprintCount = investigation.relationships.filter((relationship) => relationship.relationship_type === "REPRINT_OF").length;
  const rootCount = accounting.observedRoots;
  const analysisIssue = investigation.events
    .filter((event) => event.type === "claims.extraction_failed" || event.type === "claims.alignment_failed")
    .at(-1);
  const issueMessage = typeof analysisIssue?.payload.message === "string" ? analysisIssue.payload.message : "Claim analysis did not produce a usable comparison.";
  const active = !terminalStatuses.has(investigation.status);
  const noClaims = !investigation.claims.length;
  const claimsById = new Map(investigation.claims.map((claim) => [claim.id, claim]));
  const recurring = [...investigation.claimGroups]
    .sort((left, right) => right.memberIds.length - left.memberIds.length)
    .slice(0, 3)
    .flatMap((group) => claimsById.get(group.canonical_occurrence_id)?.proposition ?? []);
  const supported = investigation.supports.filter((support) => ["supports", "qualifies"].includes(support.status)).length;
  const conflicts = investigation.claimRelations.filter((relation) => relation.relation === "conflicting").length;
  let headline = "Evidence review is ready";
  let body = `${investigation.claimGroups.length} observed claim group${investigation.claimGroups.length === 1 ? "" : "s"} can be inspected across ${answeredRuns.length} answer surface${answeredRuns.length === 1 ? "" : "s"}.`;
  if (active) {
    headline = "Collecting answer surfaces";
    body = "The worker is collecting answers, citations, and source receipts. You can stop the run at any time.";
  } else if (investigation.status === "cancelled") {
    headline = "Run stopped";
    body = "The saved answers and partial work remain available, but no final comparison was completed.";
  } else if (investigation.status === "failed") {
    headline = "No usable answer was collected";
    body = "The run finished without a usable answer surface. Check the collection log for the provider error.";
  } else if (noClaims) {
    headline = "Answers collected; comparison unavailable";
    body = `${answeredRuns.length} answer surface${answeredRuns.length === 1 ? "" : "s"} returned text and ${investigation.citations.length} citation${investigation.citations.length === 1 ? "" : "s"}, but no comparable claims were produced. This run cannot support a consensus or dependency finding.`;
  } else if (investigation.status === "partial") {
    headline = recurring.length ? `Finding: ${recurring.join("; ")}` : "Answers collected; evidence review incomplete";
    body = `${investigation.claimGroups.length} claim group${investigation.claimGroups.length === 1 ? "" : "s"} were found; ${supported} claim-source link${supported === 1 ? "" : "s"} received inspected support across ${rootCount} evidence root${rootCount === 1 ? "" : "s"}. ${conflicts ? `${conflicts} materially conflicting interpretation${conflicts === 1 ? " was" : "s were"} found.` : "No material contradiction was established."} Confidence is provisional because some tasks or sources did not finish.`;
  } else if (reprintCount > 0) {
    headline = "A documented reprint chain was found";
    body = `${reprintCount} source relationship${reprintCount === 1 ? "" : "s"} explicitly identifies republished content. The graph separates that documented reuse from independent evidence roots.`;
  } else if (rootCount > 1) {
    headline = recurring.length ? `Finding: ${recurring.join("; ")}` : "Evidence remains distributed across independent roots";
    body = `${recurring.length ? `The strongest recurring reasons appeared across ${Math.max(...investigation.claimGroups.map((group) => group.memberIds.length), 1)} surfaces. ` : ""}${supported} claim-source link${supported === 1 ? "" : "s"} received inspected support across ${rootCount} evidence roots. ${reprintCount} shared or republished relationship${reprintCount === 1 ? " was" : "s were"} identified; ${conflicts || "no"} material conflict${conflicts === 1 ? "" : "s"} were recorded. Confidence is supported.`;
  } else if (recurring.length) {
    headline = `Finding: ${recurring.join("; ")}`;
    body = `${supported} claim-source link${supported === 1 ? "" : "s"} received inspected support. ${rootCount || "No"} independent evidence root${rootCount === 1 ? "" : "s"} ${rootCount === 1 ? "was" : "were"} identified, and ${conflicts || "no"} material conflict${conflicts === 1 ? "" : "s"} were recorded. Confidence is ${supported > 0 ? "supported" : "provisional"}.`;
  }
  return <section className={`run-outcome outcome-${investigation.status}`} aria-label="Run outcome">
    <div className="outcome-heading"><span className="outcome-eyebrow">{active ? "Live progress" : "Final result"}</span><span className="outcome-status">{runStatusLabel(investigation.status)}</span></div>
    <h3>{headline}</h3>
    <p>{body}</p>
    <div className="outcome-metrics">
      <div><strong>{answeredRuns.length}</strong><span>answers returned</span></div>
      <div><strong>{investigation.citations.length}</strong><span>citations collected</span></div>
      <div><strong>{accounting.resolvedUniqueDocuments}</strong><span>source pages inspected</span></div>
      <div><strong>{unresolved}</strong><span>items unresolved</span></div>
    </div>
    {!active && noClaims && <div className="outcome-next"><strong>Why there is no graph</strong><span>{answerRuns.length > 0 ? `A graph needs an accepted claim and an inspected source. ${issueMessage} No dependency relationship was invented.` : "No answer was saved, so there is nothing to compare yet."}</span></div>}
    {!active && unresolved > 0 && <div className="outcome-next"><strong>What to do next</strong><span>Open the collection log and unresolved evidence items. Retry with accessible sources or switch to Demo fixture to see the complete workflow without provider uncertainty.</span></div>}
    <small>Observed agreement is not a truth score. Every relationship must remain tied to inspectable evidence.</small>
  </section>;
}

function runStatusLabel(status: string) {
  if (status === "complete") return "Finished · ready to inspect";
  if (status === "partial") return "Finished with gaps";
  if (status === "failed") return "Finished · no usable result";
  if (status === "cancelled") return "Stopped";
  if (status === "created") return "Queued";
  return "Running · " + stageLabel(status);
}

function stageLabel(stage: string) {
  return stage.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function provenanceLabel(value: string | undefined, mode: string) {
  if (mode === "fixture") return "offline fixture";
  if (value === "local") return "cached locally";
  if (value === "provider") return "provider cache";
  if (value === "fresh_dispatch") return "new provider request";
  return value || "not collected";
}

function ClaimComparison({ investigation, selectedGroupId, onSelect }: { investigation: Investigation; selectedGroupId: string | null; onSelect: (id: string) => void }) {
  const claimsById = new Map(investigation.claims.map((claim) => [claim.id, claim]));
  if (!investigation.claims.length) {
    if (investigation.stage !== "analyzing" && investigation.status !== "collecting") {
      const failed = investigation.events.some((event) => event.type === "claims.extraction_failed" || event.type === "claims.alignment_failed");
      return <section className="claim-panel"><div className="claim-heading"><span>04</span><h2>Claim comparison</h2><span className="claim-count">not available</span></div><div className="analysis-empty"><strong>{failed ? "Claim analysis did not complete" : "No comparable claims found"}</strong><p>{failed ? "The answer text was collected, but the claim-analysis step failed or was unavailable. That is a processing gap, not disagreement between the surfaces." : "The collected answers did not contain a claim that could be compared safely."}</p></div></section>;
    }
    return null;
  }
  return <section className="claim-panel">
    <div className="claim-heading"><span>04</span><h2>Claim comparison</h2><span className="claim-count">{investigation.claims.length} occurrences · {investigation.claimGroups.length} groups</span></div>
    <p className="analysis-note">Groups contain only compatible equivalent occurrences. Citation links below are provider attachments to the answer block; source support is not assessed until retrieval.</p>
    <div className="claim-list">
      {investigation.claimGroups.map((group) => {
        const members = group.memberIds.map((id) => claimsById.get(id)).filter((claim): claim is NonNullable<typeof claim> => Boolean(claim));
        const canonical = claimsById.get(group.canonical_occurrence_id) || members[0];
        if (!canonical) return null;
        const surfaces = [...new Set(members.map((claim) => surfaceNames[claim.surface]))];
        const variants = members.filter((claim) => claim.id !== canonical.id);
        return <article className={`claim-row ${selectedGroupId === group.id ? "selected" : ""}`} key={group.id}>
          <div className="claim-main">
            <div className="claim-label"><span>Observed claim</span><span>{surfaces.length} surface{surfaces.length === 1 ? "" : "s"}</span></div>
            <h3>{canonical.proposition}</h3>
            <blockquote>“{canonical.source_quote}”</blockquote>
            <div className="claim-qualifiers">{qualifiers(canonical).map((item) => <span key={item}>{item}</span>)}</div>
            <button className="select-claim" type="button" aria-pressed={selectedGroupId === group.id} onClick={() => onSelect(group.id)}>{selectedGroupId === group.id ? "Shown in evidence view" : "Show this evidence"}</button>
          </div>
          <div className="claim-evidence">
            <div className="claim-surfaces">{surfaces.join(" · ")}</div>
            {variants.length > 0 && <div className="claim-variants"><strong>Variants</strong>{variants.map((variant) => <div key={variant.id}><span>{variant.proposition}</span><small>{variant.certainty}{variant.population ? ` · ${variant.population}` : ""}</small></div>)}</div>}
            <div className="claim-links">{members.flatMap((claim) => claim.citations.map((citation) => <a href={citation.url} target="_blank" rel="noreferrer" key={`${claim.id}-${citation.url}`}>{citation.title || citation.url}<small>provider attachment to answer block</small></a>))}</div>
            <div className="support-list">{members.flatMap((claim) => investigation.supports.filter((support) => support.occurrence_id === claim.id).map((support) => <div className={`support support-${support.status}`} key={support.id}><strong>{support.status.replace("_", " ")}</strong><span>{support.exact_quote || support.rationale}</span><small>model assessment of inspected text</small></div>))}</div>
          </div>
        </article>;
      })}
    </div>
  </section>;
}

function qualifiers(claim: Investigation["claims"][number]) {
  return [
    claim.certainty,
    claim.population,
    claim.time_scope,
    claim.units,
    claim.denominator,
    claim.conditions,
    claim.evidence_scope,
  ].filter((value): value is string => Boolean(value));
}

function FollowUpTrail({ investigation }: { investigation: Investigation }) {
  if (!investigation.followUps.length) return null;
  return <section className="follow-up-panel">
    <div className="claim-heading"><span>05</span><h2>Targeted follow-ups</h2><span className="claim-count">{investigation.followUps.length}/4 actions</span></div>
    <p className="analysis-note">Each Google Search action responds to a persisted evidence gap. Search failure or no result does not establish absence.</p>
    <div className="follow-up-list">{investigation.followUps.map((action, index) => <article key={action.id}>
      <div className="follow-up-top"><span>Action {index + 1} · {action.action_type.replaceAll("_", " ")}</span><strong className={action.useful_gain === 1 ? "gain" : "no-gain"}>{action.state}{action.useful_gain === null ? "" : action.useful_gain === 1 ? " · useful gain" : " · no gain"}</strong></div>
      <p>{action.reason}</p>
      <code>{action.query}</code>
      <div className="follow-up-meta"><span>Google Search</span><span>expected gain: {action.expected_gain}</span><span>{action.actualArtifactIds.length} saved artifact{action.actualArtifactIds.length === 1 ? "" : "s"}</span></div>
      {action.afterMetrics && <div className="metric-delta">
        <span>Documents {action.beforeMetrics.inspectedDocuments ?? 0} → {action.afterMetrics.inspectedDocuments ?? 0}</span>
        <span>Roots {action.beforeMetrics.observedRoots ?? 0} → {action.afterMetrics.observedRoots ?? 0}</span>
        <span>Contrary evidence {action.beforeMetrics.contradictoryEvidence ?? 0} → {action.afterMetrics.contradictoryEvidence ?? 0}</span>
      </div>}
    </article>)}</div>
    {investigation.stopReasons.length > 0 && <p className="planner-stop"><strong>Planner stopped:</strong> {investigation.stopReasons.at(-1)?.replaceAll("_", " ")}. Remaining gaps stay unresolved.</p>}
  </section>;
}

type GraphData = {
  nodes: Array<{ id: string; type: string; label: string; evidenceId?: string }>;
  edges: Array<{ id: string; type: string; source: string; target: string; status: string; evidenceId?: string; explanation?: string }>;
};

function EvidenceGraph({ investigation, claimGroupId, grouped, onToggleGrouping }: { investigation: Investigation; claimGroupId: string | null; grouped: boolean; onToggleGrouping: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null);
  const viewGraph = useMemo(() => graph && grouped ? groupEvidenceGraph(graph) : graph, [graph, grouped]);
  const canGroup = Boolean(graph?.edges.some((edge) => edge.type === "SAME_DOCUMENT" || edge.type === "REPRINT_OF"));

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setEvidence(null);
    const query = claimGroupId ? `?claimId=${encodeURIComponent(claimGroupId)}` : "";
    void fetch(`/api/investigations/${investigation.id}/graph${query}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Graph could not be loaded.")))
      .then((data: GraphData) => { if (!cancelled) setGraph(data); })
      .catch(() => { if (!cancelled) setGraph(null); });
    return () => { cancelled = true; };
  }, [claimGroupId, investigation.documents.length, investigation.id, investigation.runs.length, investigation.claimGroups.length, investigation.status]);

  useEffect(() => {
    if (!viewGraph || !containerRef.current) return;
    let disposed = false;
    let instance: import("cytoscape").Core | undefined;
    void import("cytoscape").then(({ default: cytoscape }) => {
      if (disposed || !containerRef.current) return;
      instance = cytoscape({
        container: containerRef.current,
        elements: [
          ...viewGraph.nodes.map((node) => ({ data: { ...node, label: nodeLabel(node) } })),
          ...viewGraph.edges.map((edge) => ({ data: edge })),
        ],
        layout: { name: "breadthfirst", directed: true, animate: false, padding: 34, spacingFactor: 1.35 },
        style: [
          { selector: "node", style: { label: "data(label)", color: "#e7e4da", "font-size": "11px", "font-family": "Arial", "font-weight": 600, "text-wrap": "ellipsis", "text-max-width": "150px", "text-valign": "center", "text-halign": "center", "background-color": "#789b86", width: "34px", height: "34px", "border-width": 1, "border-color": "#b4d4bd" } },
          { selector: "node[type = 'surface']", style: { "background-color": "#e6a75e", color: "#101313", shape: "round-rectangle", width: 92, height: 36, "text-max-width": "82px" } },
          { selector: "node[type = 'document']", style: { "background-color": "#789b86", shape: "round-rectangle", width: 105, height: 34, "text-max-width": "92px" } },
          { selector: "node[type = 'root']", style: { "background-color": "#d17f6f", shape: "diamond", width: 48, height: 48, "text-max-width": "85px" } },
          { selector: "edge", style: { width: "2px", "line-color": "#59615d", "target-arrow-color": "#59615d", "target-arrow-shape": "triangle", "curve-style": "bezier", label: "data(type)", color: "#b6bab5", "font-size": "9px", "font-family": "Arial", "text-background-color": "#0e1211", "text-background-opacity": 1, "text-background-padding": "3px" } },
          { selector: "edge[type = 'REPRINT_OF']", style: { "line-color": "#e6a75e", "target-arrow-color": "#e6a75e", width: "3px", color: "#e6a75e" } },
          { selector: "edge[type = 'USES_EVIDENCE']", style: { "line-color": "#8eb89e", "target-arrow-color": "#8eb89e", color: "#8eb89e" } },
        ],
      });
      instance.on("tap", "node, edge", (event) => {
        const evidenceId = event.target.data("evidenceId") as string | undefined;
        if (evidenceId) {
          returnFocusRef.current = containerRef.current;
          void loadEvidence(investigation.id, evidenceId, setEvidence);
        }
      });
    });
    return () => { disposed = true; instance?.destroy(); };
  }, [viewGraph, investigation.id]);

  useEffect(() => {
    if (!evidence) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeEvidence(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [evidence]);

  function openEvidence(evidenceId: string, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    void loadEvidence(investigation.id, evidenceId, setEvidence);
  }

  function closeEvidence() {
    setEvidence(null);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }

  const metrics = investigation.evidenceAccounting;
  const hasInspectableEvidence = investigation.documents.length > 0 || investigation.roots.length > 0;
  const relationshipEdges = viewGraph?.edges.filter((edge) => edge.type !== "CITES") ?? [];
  return <section className="evidence-panel">
    <div className="claim-heading"><span>06</span><h2>Evidence map</h2><span className="claim-count">saved view · no new request</span></div>
    <div className="metric-strip">
      <div><strong>{metrics.citationOccurrences}</strong><span>citation occurrences</span></div>
      <div><strong>{metrics.resolvedUniqueDocuments}</strong><span>source pages inspected</span></div>
      <div><strong>{metrics.observedRoots}</strong><span>evidence roots</span></div>
      <div><strong>{metrics.unresolvedCitationIdentities + metrics.unresolvedSupport}</strong><span>unresolved items</span></div>
    </div>
    <div className="graph-tools"><p className="analysis-note" id="graph-description">This map shows what the run actually inspected. A citation is not an inspected source, and similar wording alone never creates a dependency edge.</p><button type="button" aria-pressed={grouped} disabled={!canGroup} onClick={onToggleGrouping}>{grouped ? "Show original documents" : "Group shared evidence"}</button></div>
    {!hasInspectableEvidence && <div className="graph-empty"><strong>No source relationship can be drawn yet</strong><p>The answer surfaces returned citations, but no source page was inspected. The map stays honest instead of turning citations into evidence.</p><span>Use Demo fixture for a complete, offline graph walkthrough, or resolve the live source-access issues above.</span></div>}
    {relationshipEdges.length > 0 && <div className="graph-finding"><span>Documented relationship</span><strong>{relationshipEdges[0].type.replaceAll("_", " ")}</strong><p>{relationshipEdges[0].explanation || "This relationship is backed by a saved evidence receipt."}</p></div>}
    {viewGraph && hasInspectableEvidence && <div className="graph-layout">
      <div ref={containerRef} className="graph-canvas" role="img" tabIndex={0} aria-label="Evidence graph visualization" aria-describedby="graph-description" />
      <div className="graph-list" aria-label="Keyboard-accessible evidence graph">
        {viewGraph.nodes.filter((node) => node.evidenceId).map((node) => <button type="button" key={node.id} onClick={(event) => openEvidence(node.evidenceId!, event.currentTarget)}><strong>{node.type}</strong><span>{nodeLabel(node)}</span></button>)}
        {viewGraph.edges.filter((edge) => edge.evidenceId).map((edge) => <button type="button" key={edge.id} onClick={(event) => openEvidence(edge.evidenceId!, event.currentTarget)}><strong>{edge.type}</strong><span>{edge.explanation || edge.status}</span></button>)}
      </div>
    </div>}
    {evidence && <aside className="evidence-drawer" role="dialog" aria-modal="false" aria-labelledby="evidence-title">
      <div><span id="evidence-title">Evidence receipt</span><button ref={closeRef} type="button" onClick={closeEvidence}>Close</button></div>
      <EvidenceFields evidence={evidence} />
    </aside>}
  </section>;
}

function nodeLabel(node: GraphData["nodes"][number]) {
  if (node.type === "document") {
    try { return new URL(node.label).hostname; } catch { return node.label; }
  }
  return node.label;
}

function groupEvidenceGraph(graph: GraphData): GraphData {
  const representative = new Map<string, string>();
  for (const edge of graph.edges) if (["SAME_DOCUMENT", "REPRINT_OF"].includes(edge.type)) representative.set(edge.source, edge.target);
  const resolve = (id: string): string => {
    const seen = new Set<string>();
    let current = id;
    while (representative.has(current) && !seen.has(current)) { seen.add(current); current = representative.get(current)!; }
    return current;
  };
  const groupedCounts = new Map<string, number>();
  for (const node of graph.nodes) {
    const resolved = resolve(node.id);
    if (resolved !== node.id) groupedCounts.set(resolved, (groupedCounts.get(resolved) ?? 0) + 1);
  }
  const nodes = graph.nodes.filter((node) => resolve(node.id) === node.id).map((node) => ({ ...node, label: groupedCounts.has(node.id) ? `${node.label} · ${groupedCounts.get(node.id)! + 1} grouped documents` : node.label }));
  const edgeKeys = new Set<string>();
  const edges = graph.edges.flatMap((edge) => {
    if (["SAME_DOCUMENT", "REPRINT_OF"].includes(edge.type)) return [];
    const next = { ...edge, source: resolve(edge.source), target: resolve(edge.target) };
    if (next.source === next.target) return [];
    const key = `${next.type}|${next.source}|${next.target}`;
    if (edgeKeys.has(key)) return [];
    edgeKeys.add(key);
    return [next];
  });
  return { nodes, edges };
}

async function loadEvidence(investigationId: string, evidenceId: string, setter: (value: Record<string, unknown> | null) => void) {
  const response = await fetch(`/api/investigations/${investigationId}/evidence/${encodeURIComponent(evidenceId)}`, { cache: "no-store" });
  if (!response.ok) return;
  const body = await response.json() as { evidence: Record<string, unknown> };
  setter(body.evidence);
}

function EvidenceFields({ evidence }: { evidence: Record<string, unknown> }) {
  const fields = ["type", "title", "normalized_url", "final_url", "outcome", "exact_quote", "context", "label", "stable_identifier", "fetched_at", "document_date", "date_source", "unresolved_reason"];
  return <dl>{fields.flatMap((key) => evidence[key] === null || evidence[key] === undefined ? [] : [<div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(evidence[key])}</dd></div>])}</dl>;
}
