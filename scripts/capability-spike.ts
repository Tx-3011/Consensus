import fs from "node:fs";
import path from "node:path";
import { getSearchAdapter } from "../src/server/adapters/search";
import { getConfig } from "../src/server/config";
import type { Surface } from "../src/contracts/search";

const questions = [
  "What is the capital of Australia?",
  "Does moderate exercise improve sleep quality in older adults?",
  "What percentage of Earth's surface is covered by oceans?",
  "What major policy change happened in the United States in January 2025?",
  "What is the obscure historical origin of the Antikythera mechanism?",
];

const allSurfaces: Surface[] = ["google_search", "google_ai_mode", "bing_copilot", "google_ai_overview", "brave_ai_mode"];
const fixture = process.argv.includes("--fixture");
const config = getConfig();
const surfaces = parseSurfaces(process.argv.find((argument) => argument.startsWith("--surfaces=")));
const requestedAttemptCap = parseNumberFlag("--max-attempts", 24);
const developmentCap = parseNumberFlag("--development-cap", config.SERPAPI_DEV_MAX_SEARCHES);
const outputDir = path.join(process.cwd(), "docs");
const outputPath = path.join(outputDir, "capabilities.md");
const records: Array<Record<string, unknown>> = [];
let attempts = 0;

async function main() {
  const accountUsage = fixture ? undefined : await getAccountUsage(config.SERPAPI_API_KEY);
  const remainingDevelopmentAttempts = Math.max(0, developmentCap - (accountUsage?.this_month_usage ?? 0));
  const attemptCap = Math.min(requestedAttemptCap, remainingDevelopmentAttempts);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const surface of surfaces) {
    for (const question of questions) {
      if (attempts >= attemptCap) {
        records.push({ surface, question, outcome: "unvalidated", attempts: 0, warnings: [`Attempt cap of ${attemptCap} reached before this probe.`] });
        continue;
      }
      const started = Date.now();
      const execution = await getSearchAdapter(surface, fixture ? "fixture" : "live").search({
        question,
        surface,
        locale: { hl: "en", gl: "us" },
        purpose: "capability_spike",
      });
      attempts += execution.rawResponses.length || 1;
      const observation = execution.observation;
      records.push({
        surface,
        question,
        outcome: observation.outcome,
        answerText: observation.blocks.length > 0,
        citationUrls: observation.citations.length,
        referenceIds: observation.citations.map((citation) => citation.providerReferenceId ?? "unresolved"),
        warnings: observation.warnings,
      effectiveParameters: redactParameters(observation.effectiveParameters),
        providerRequestId: observation.providerRequestId ?? "unavailable",
        providerCache: observation.providerCache,
        latencyMs: Date.now() - started,
        requestAttempts: execution.rawResponses.length || 1,
      });
    }
  }

  const rows = surfaces.map((surface) => {
    const tested = records.filter((record) => record.surface === surface && record.outcome !== "unvalidated");
    const technical = tested.filter((record) => ["answer", "no_answer", "unavailable"].includes(String(record.outcome))).length;
    const answersWithUrls = tested.filter((record) => record.outcome === "answer" && Number(record.citationUrls) > 0).length;
    const qualifies = technical >= 4 && answersWithUrls >= 3 && tested.every((record) => Array.isArray(record.referenceIds));
    return { surface, tested: tested.length, technical, answersWithUrls, qualifies };
  });

  const markdown = [
    "# SerpApi capability matrix",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${fixture ? "fixture (no provider requests)" : "live"}`,
    `Attempt accounting: ${attempts}/${attemptCap} request attempts; no automatic retries in this spike.`,
    `Development guard: ${developmentCap} total successful searches maximum; account usage at start was ${accountUsage?.this_month_usage ?? "fixture mode"}.`,
    "",
    "The fixture run proves adapter and persistence wiring only. A live run is required before claiming provider feasibility.",
    "",
    "## Surface gate",
    "",
    "| Surface | Probes tested | Technical completions | Answers with URLs | Qualifies |",
    "|---|---:|---:|---:|---|",
    ...rows.map((row) => `| ${row.surface} | ${row.tested} | ${row.technical} | ${row.answersWithUrls} | ${row.qualifies ? "yes" : "no"} |`),
    "",
    "## Redacted probe record",
    "",
    "```json",
    JSON.stringify({ questions, records }, null, 2),
    "```",
    "",
  ].join("\n");
  fs.writeFileSync(outputPath, markdown, "utf8");
  console.log(`Wrote ${outputPath}`);
  console.log(JSON.stringify({ fixture, attempts, rows }, null, 2));

  if (!fixture && !config.SERPAPI_API_KEY) process.exitCode = 2;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

function redactParameters(parameters: Record<string, string>) {
  return Object.fromEntries(Object.entries(parameters).map(([key, value]) =>
    [key, ["api_key", "page_token", "subsequent_request_token"].includes(key) ? "[redacted]" : value]));
}

function parseNumberFlag(name: string, fallback: number) {
  const argument = process.argv.find((value) => value.startsWith(`${name}=`));
  if (!argument) return fallback;
  const parsed = Number(argument.slice(name.length + 1));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseSurfaces(argument: string | undefined): Surface[] {
  if (!argument) return allSurfaces;
  const requested = argument.slice("--surfaces=".length).split(",").filter((value): value is Surface => allSurfaces.includes(value as Surface));
  if (!requested.length) throw new Error(`No valid surfaces in ${argument}. Valid values: ${allSurfaces.join(", ")}`);
  return requested;
}

async function getAccountUsage(apiKey: string) {
  if (!apiKey) return undefined;
  const url = new URL("https://serpapi.com/account.json");
  url.searchParams.set("api_key", apiKey);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`SerpApi Account API returned HTTP ${response.status}`);
  const account = await response.json() as { this_month_usage?: number; searches_per_month?: number; total_searches_left?: number };
  return {
    this_month_usage: Number(account.this_month_usage ?? 0),
    searches_per_month: Number(account.searches_per_month ?? 0),
    total_searches_left: Number(account.total_searches_left ?? 0),
  };
}
