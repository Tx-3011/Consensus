import crypto from "node:crypto";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { Agent, fetch as undiciFetch } from "undici";
import { getConfig } from "../config";
import { normalizeExternalUrl, resolvePublicAddresses, UnsafeUrlError } from "./url";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ALLOWED_MIME = new Set(["text/html", "application/xhtml+xml", "text/plain"]);

export type RetrievalResult = {
  requestedUrl: string;
  finalUrl?: string;
  outcome: "fetched" | "unsupported" | "blocked" | "failed";
  httpStatus?: number;
  mimeType?: string;
  contentHash?: string;
  extractedText?: string;
  title?: string;
  outboundLinks: string[];
  redirectChain: string[];
  documentDate?: string;
  dateSource?: string;
  dateUncertain: boolean;
  truncated: boolean;
  unresolvedReason?: string;
  errorCode?: string;
  errorPhase?: "dns" | "connection" | "tls" | "timeout" | "http_response" | "content_extraction";
  retryable?: boolean;
  fetchedAt: string;
};

export interface DocumentRetriever {
  fetch(url: string): Promise<RetrievalResult>;
}

export class SafeDocumentRetriever implements DocumentRetriever {
  async fetch(input: string): Promise<RetrievalResult> {
    const requestedUrl = input;
    const redirectChain: string[] = [];
    let phase: RetrievalResult["errorPhase"] = "dns";
    try {
      let current = normalizeExternalUrl(input);
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const url = new URL(current);
        const addresses = await resolvePublicAddresses(url.hostname);
        const ordered = [...addresses].sort((a, b) => a.family === b.family ? 0 : a.family === 4 ? -1 : 1);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), getConfig().SOURCE_TIMEOUT_MS);
        let dispatcher: Agent | undefined;
        try {
          phase = "connection";
          let response: Awaited<ReturnType<typeof undiciFetch>> | undefined;
          let lastError: unknown;
          for (const pinned of ordered) {
            dispatcher = new Agent({ connect: { lookup: createPinnedLookup(pinned) } });
            try {
              response = await undiciFetch(current, { dispatcher, redirect: "manual", signal: controller.signal, headers: { accept: "text/html, application/xhtml+xml, text/plain;q=0.9", "user-agent": "ConsensusTrap/0.1 local-research" } });
              break;
            } catch (error) {
              lastError = error;
              await dispatcher.close();
              dispatcher = undefined;
              if (controller.signal.aborted) throw error;
            }
          }
          if (!response) throw lastError ?? new Error("No validated address accepted the connection.");
          phase = "http_response";
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) return unresolved(requestedUrl, "failed", "HTTP response: redirect did not include a Location header.", redirectChain, response.status, "http_response", "ERR_REDIRECT", false);
            if (redirects === MAX_REDIRECTS) return unresolved(requestedUrl, "failed", "HTTP response: maximum redirect count exceeded.", redirectChain, response.status, "http_response", "ERR_REDIRECT_LIMIT", false);
            current = normalizeExternalUrl(new URL(location, current).toString());
            redirectChain.push(current);
            continue;
          }
          const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLocaleLowerCase() || "";
          if (!ALLOWED_MIME.has(mimeType)) {
            return { ...unresolved(requestedUrl, "unsupported", mimeType === "application/pdf" ? "PDF retrieval is outside the MVP." : `Unsupported MIME type: ${mimeType || "unknown"}.`, redirectChain, response.status), finalUrl: current, mimeType };
          }
          if (!response.ok) return { ...unresolved(requestedUrl, "failed", `HTTP response: source returned ${response.status}.`, redirectChain, response.status, "http_response", `HTTP_${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500), finalUrl: current, mimeType };
          phase = "content_extraction";
          const body = await readLimitedBody(response, MAX_BODY_BYTES);
          const html = new TextDecoder().decode(body.bytes);
          const extracted = mimeType === "text/plain" ? extractPlainText(html) : extractReadableHtml(html, current);
          if (!extracted.text) return { ...unresolved(requestedUrl, "failed", "Content extraction: no readable main text was found.", redirectChain, response.status, "content_extraction", "ERR_NO_READABLE_CONTENT", false), finalUrl: current, mimeType, truncated: body.truncated };
          return {
            requestedUrl,
            finalUrl: current,
            outcome: "fetched",
            httpStatus: response.status,
            mimeType,
            contentHash: crypto.createHash("sha256").update(extracted.text).digest("hex"),
            extractedText: extracted.text,
            title: extracted.title,
            outboundLinks: extracted.links,
            redirectChain,
            documentDate: extracted.date?.value,
            dateSource: extracted.date?.source,
            dateUncertain: !extracted.date,
            truncated: body.truncated,
            fetchedAt: new Date().toISOString(),
          };
        } finally {
          clearTimeout(timeout);
          if (dispatcher) await dispatcher.close();
        }
      }
      return unresolved(requestedUrl, "failed", "HTTP response: maximum redirect count exceeded.", redirectChain, undefined, "http_response", "ERR_REDIRECT_LIMIT", false);
    } catch (error) {
      const blocked = error instanceof UnsafeUrlError;
      const detail = networkFailure(error, phase);
      return unresolved(requestedUrl, blocked ? "blocked" : "failed", blocked ? detail.reason : `${detail.phaseLabel}: ${detail.reason}`, redirectChain, undefined, detail.phase, detail.code, detail.retryable);
    }
  }
}

async function readLimitedBody(response: Awaited<ReturnType<typeof undiciFetch>>, limit: number) {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > limit) {
        chunks.push(value.slice(0, limit - length));
        length = limit;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      length += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, truncated };
}

function extractPlainText(value: string) {
  return { text: normalizeText(value), links: [] as string[], title: undefined, date: undefined };
}

export function extractReadableHtml(html: string, baseUrl: string) {
  const { document } = parseHTML(html);
  const links = [...document.querySelectorAll("a[href]")].flatMap((element) => {
    const href = element.getAttribute("href");
    if (!href) return [];
    try { return [normalizeExternalUrl(new URL(href, baseUrl).toString())]; } catch { return []; }
  });
  const date = findDocumentDate(document);
  const article = new Readability(document as unknown as Document).parse();
  const fallback = document.querySelector("main, article, body")?.textContent || "";
  return {
    text: normalizeText(article?.textContent || fallback),
    title: normalizeText(article?.title || document.title || "") || undefined,
    links: [...new Set(links)].slice(0, 500),
    date,
  };
}

function findDocumentDate(document: ReturnType<typeof parseHTML>["document"]) {
  const selectors = [
    ["meta[property='article:published_time']", "content", "meta article:published_time"],
    ["meta[name='date']", "content", "meta date"],
    ["time[datetime]", "datetime", "time datetime"],
  ] as const;
  for (const [selector, attribute, source] of selectors) {
    const value = document.querySelector(selector)?.getAttribute(attribute);
    if (value && !Number.isNaN(Date.parse(value))) return { value: new Date(value).toISOString(), source };
  }
  return undefined;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function unresolved(requestedUrl: string, outcome: "unsupported" | "blocked" | "failed", reason: string, redirectChain: string[], httpStatus?: number, errorPhase?: RetrievalResult["errorPhase"], errorCode?: string, retryable = false): RetrievalResult {
  return { requestedUrl, outcome, httpStatus, outboundLinks: [], redirectChain, dateUncertain: true, truncated: false, unresolvedReason: reason, errorPhase, errorCode, retryable, fetchedAt: new Date().toISOString() };
}

export function createPinnedLookup(pinned: { address: string; family: number }) {
  return (_hostname: string, options: { all?: boolean } | number, callback: (error: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void) => {
    if (typeof options === "object" && options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
    else callback(null, pinned.address, pinned.family);
  };
}

function networkFailure(error: unknown, fallbackPhase: NonNullable<RetrievalResult["errorPhase"]>) {
  const value = error as Error & { code?: string; cause?: { code?: string; message?: string } };
  const code = String(value?.cause?.code ?? value?.code ?? "ERR_SOURCE_RETRIEVAL").replace(/[^A-Z0-9_]/gi, "_").slice(0, 80);
  const message = String(value?.cause?.message ?? value?.message ?? "Source retrieval failed.").replace(/https?:\/\/\S+/gi, "[url]").slice(0, 240);
  const timeout = value?.name === "AbortError" || code.includes("ABORT") || code.includes("TIMEOUT");
  const tls = /TLS|CERT|SSL/i.test(code) || /certificate|tls/i.test(message);
  const dns = /ENOTFOUND|EAI_AGAIN|DNS/i.test(code);
  const phase = timeout ? "timeout" : tls ? "tls" : dns ? "dns" : fallbackPhase;
  const retryable = timeout || dns || ["ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"].some((part) => code.includes(part));
  return { phase, phaseLabel: phase.replace("_", " ").replace(/^./, (c) => c.toUpperCase()), code, reason: message, retryable };
}
