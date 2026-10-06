import type { SearchAdapter, SearchExecution } from "./adapter";
import { normalizedObservationSchema, type AnswerBlock, type Citation, type NormalizedObservation, type SearchRequest, type Surface } from "../../../contracts/search";
import { getConfig } from "../../config";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
type JsonRecord = Record<string, unknown>;

export class SerpApiAdapter implements SearchAdapter {
  constructor(public readonly surface: Surface) {}

  async search(request: SearchRequest): Promise<SearchExecution> {
    const config = getConfig();
    if (!config.SERPAPI_API_KEY) {
      return { observation: unavailableObservation(this.surface, request, "SERPAPI_API_KEY is not configured. Switch to fixture mode or add the key to .env.local."), rawResponses: [] };
    }
    try {
      const usage = await getMonthlyUsage(config.SERPAPI_API_KEY);
      const estimatedAttempts = this.surface === "google_ai_overview" ? 2 : 1;
      if (usage + estimatedAttempts > config.SERPAPI_DEV_MAX_SEARCHES) {
        return { observation: unavailableObservation(this.surface, request, `Development search cap reached: ${usage} successful searches used; maximum is ${config.SERPAPI_DEV_MAX_SEARCHES}.`), rawResponses: [] };
      }
    } catch (error) {
      return { observation: unavailableObservation(this.surface, request, `Development budget could not be verified; no provider request was made. ${error instanceof Error ? error.message : "Account API error"}`), rawResponses: [] };
    }
    const first = await this.fetchJson(buildSearchParameters(request, this.surface));
    if (this.surface === "google_ai_overview") {
      const followUp = extractOverviewFollowUp(first.payload);
      if (followUp) {
        const overview = await this.fetchJson({ engine: "google_ai_overview", page_token: followUp, hl: request.locale.hl, gl: request.locale.gl });
        return { observation: normalizeResponse(this.surface, overview.payload, overview.effectiveParameters, overview.providerRequestId, overview.providerCache, ["Google AI Overview required a follow-up request."]), rawResponses: [first.payload, overview.payload], retryable: Boolean(first.error?.retryable || overview.error?.retryable), ambiguous: Boolean(first.ambiguous || overview.ambiguous) };
      }
      return { observation: normalizeResponse(this.surface, first.payload, first.effectiveParameters, first.providerRequestId, first.providerCache, []), rawResponses: [first.payload], retryable: Boolean(first.error?.retryable), ambiguous: Boolean(first.ambiguous) };
    }
    return { observation: normalizeResponse(this.surface, first.payload, first.effectiveParameters, first.providerRequestId, first.providerCache, []), rawResponses: [first.payload], retryable: Boolean(first.error?.retryable), ambiguous: Boolean(first.ambiguous) };
  }

  private async fetchJson(parameters: Record<string, string>) {
    const config = getConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.SERPAPI_TIMEOUT_MS);
    try {
      const url = new URL(SERPAPI_ENDPOINT);
      Object.entries({ ...parameters, api_key: config.SERPAPI_API_KEY }).forEach(([key, value]) => url.searchParams.set(key, value));
      const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
      const payload = await response.json() as JsonRecord;
      const metadata = payload.search_metadata as JsonRecord | undefined;
      const providerRequestId = typeof metadata?.id === "string" ? metadata.id : undefined;
      const providerCache = metadata?.cached === true ? "hit" : "unknown";
      if (!response.ok || typeof payload.error === "string") {
        throw new SearchProviderError(typeof payload.error === "string" ? payload.error : `SerpApi returned HTTP ${response.status}`, response.status >= 500 || response.status === 429);
      }
      return { payload, effectiveParameters: parameters, providerRequestId, providerCache: providerCache as "hit" | "unknown" };
    } catch (error) {
      if (error instanceof SearchProviderError) return { payload: { error: error.message }, effectiveParameters: parameters, providerRequestId: undefined, providerCache: "unknown" as const, error, ambiguous: false };
      const message = error instanceof Error ? error.message : "Unknown SerpApi error";
      return { payload: { error: message }, effectiveParameters: parameters, providerRequestId: undefined, providerCache: "unknown" as const, error: new SearchProviderError(message, true), ambiguous: true };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function getMonthlyUsage(apiKey: string) {
  const url = new URL("https://serpapi.com/account.json");
  url.searchParams.set("api_key", apiKey);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`SerpApi Account API returned HTTP ${response.status}`);
  const account = await response.json() as { this_month_usage?: number };
  return Number(account.this_month_usage ?? 0);
}

export class SearchProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "SearchProviderError";
  }
}

export function buildSearchParameters(request: SearchRequest, surface: Surface) {
  const params: Record<string, string> = { q: request.question, hl: request.locale.hl, gl: request.locale.gl };
  if (surface === "google_search" || surface === "google_ai_overview") params.engine = "google";
  if (surface === "google_ai_mode") { params.engine = "google_ai_mode"; params.continuable = "true"; }
  if (surface === "bing_copilot") params.engine = "bing_copilot";
  if (surface === "brave_ai_mode") params.engine = "brave_ai_mode";
  return params;
}

export function normalizeResponse(surface: Surface, payload: JsonRecord, effectiveParameters: Record<string, string>, providerRequestId: string | undefined, providerCache: "hit" | "unknown", extraWarnings: string[]): NormalizedObservation {
  const blocks = extractBlocks(surface, payload);
  const citations = extractCitations(surface, payload);
  const warnings = [...extraWarnings];
  if (typeof payload.error === "string") warnings.push(payload.error);
  const metadata = payload.search_metadata as JsonRecord | undefined;
  if (metadata?.status === "Error" && typeof payload.error !== "string") warnings.push("SerpApi reported search_metadata.status=Error.");
  const failed = typeof payload.error === "string" || metadata?.status === "Error";
  return normalizedObservationSchema.parse({
    schemaVersion: "search-observation.v1",
    surface,
    outcome: failed ? "failed" : blocks.length > 0 ? "answer" : "no_answer",
    blocks,
    citations,
    organicResults: extractOrganicResults(payload),
    warnings,
    effectiveParameters,
    retrievedAt: new Date().toISOString(),
    providerRequestId,
    providerCache,
  });
}

function extractBlocks(surface: Surface, payload: JsonRecord): AnswerBlock[] {
  const section = getResponseSection(surface, payload);
  const blocks: AnswerBlock[] = [];
  collectTextBlocks(section, surface, blocks);
  if (blocks.length) return blocks;
  const markdown = typeof section.reconstructed_markdown === "string" ? section.reconstructed_markdown : "";
  if (markdown.trim()) return [{ id: `${surface}-markdown-0`, text: markdown.trim(), position: 0, referenceIndexes: [] }];
  if (typeof section.answer === "string" && section.answer.trim()) return [{ id: `${surface}-answer-0`, text: section.answer.trim(), position: 0, referenceIndexes: [] }];
  return [];
}

function extractCitations(surface: Surface, payload: JsonRecord): Citation[] {
  const section = getResponseSection(surface, payload);
  const source = Array.isArray(section.references) ? section.references : Array.isArray(section.citations) ? section.citations : [];
  return source.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const citation = item as JsonRecord;
    const url = typeof citation.link === "string" ? citation.link : typeof citation.url === "string" ? citation.url : "";
    try {
      new URL(url);
      return [{ providerReferenceId: String(citation.index ?? citation.id ?? index), url, title: typeof citation.title === "string" ? citation.title : undefined, source: typeof citation.source === "string" ? citation.source : surface }];
    } catch {
      return [];
    }
  });
}

function getResponseSection(surface: Surface, payload: JsonRecord): JsonRecord {
  if (surface === "google_ai_overview" && payload.ai_overview && typeof payload.ai_overview === "object") return payload.ai_overview as JsonRecord;
  return payload;
}

function collectTextBlocks(section: JsonRecord, surface: Surface, output: AnswerBlock[]) {
  const source = Array.isArray(section.text_blocks) ? section.text_blocks : [];
  for (const item of source) collectTextBlock(item, surface, output);
}

function collectTextBlock(item: unknown, surface: Surface, output: AnswerBlock[]) {
  if (!item || typeof item !== "object") return;
  const block = item as JsonRecord;
  const indexes = new Set<number>();
  const directIndexes = Array.isArray(block.reference_indexes) ? block.reference_indexes : [];
  for (const value of directIndexes) if (typeof value === "number") indexes.add(value);
  const segments = Array.isArray(block.segments) ? block.segments : [];
  const segmentText: string[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment !== "object") continue;
    const record = segment as JsonRecord;
    if (typeof record.snippet === "string") segmentText.push(record.snippet);
    const citations = Array.isArray(record.citations) ? record.citations : [];
    for (const citation of citations) {
      if (!citation || typeof citation !== "object") continue;
      const referenceIndex = (citation as JsonRecord).reference_index;
      if (typeof referenceIndex === "number") indexes.add(referenceIndex);
    }
  }
  const text = typeof block.snippet === "string" ? block.snippet : typeof block.text === "string" ? block.text : typeof block.content === "string" ? block.content : segmentText.join(" ");
  if (text.trim()) output.push({ id: `${surface}-block-${output.length}`, text: text.trim(), position: output.length, referenceIndexes: [...indexes] });
  for (const key of ["text_blocks", "list"]) {
    const nested = block[key];
    if (!Array.isArray(nested)) continue;
    for (const child of nested) collectTextBlock(child, surface, output);
  }
}

function extractOrganicResults(payload: JsonRecord) {
  const source = Array.isArray(payload.organic_results) ? payload.organic_results : [];
  return source.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const result = item as JsonRecord;
    const url = typeof result.link === "string" ? result.link : "";
    try {
      new URL(url);
      return [{ url, title: typeof result.title === "string" ? result.title : undefined, snippet: typeof result.snippet === "string" ? result.snippet : undefined }];
    } catch {
      return [];
    }
  });
}

function extractOverviewFollowUp(payload: JsonRecord) {
  const overview = payload.ai_overview;
  if (!overview || typeof overview !== "object") return undefined;
  const record = overview as JsonRecord;
  return typeof record.page_token === "string" ? record.page_token : undefined;
}

function unavailableObservation(surface: Surface, request: SearchRequest, warning: string): NormalizedObservation {
  return normalizedObservationSchema.parse({
    schemaVersion: "search-observation.v1",
    surface,
    outcome: "unavailable",
    blocks: [],
    citations: [],
    organicResults: [],
    warnings: [warning],
    effectiveParameters: buildSearchParameters(request, surface),
    retrievedAt: new Date().toISOString(),
    providerCache: "unknown",
  });
}
