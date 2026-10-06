import type { SearchAdapter, SearchExecution } from "./adapter";
import { normalizedObservationSchema, type SearchRequest, type Surface } from "../../../contracts/search";

const sources = [
  { url: "https://www.nist.gov/standard-reference-data", title: "NIST reference data", source: "Fixture source" },
  { url: "https://www.example.org/methods", title: "Methods overview", source: "Fixture source" },
  { url: "https://mirror.example.net/methods", title: "Republished methods overview", source: "Fixture source" },
];

export class FixtureAdapter implements SearchAdapter {
  constructor(public readonly surface: Surface) {}

  async search(request: SearchRequest): Promise<SearchExecution> {
    if (request.purpose === "investigative_follow_up") {
      const result = { url: "https://www.example.org/counter-evidence", title: "Contrasting trial result", snippet: "A later controlled trial found no improvement for the tested outcome." };
      const observation = normalizedObservationSchema.parse({
        schemaVersion: "search-observation.v1",
        surface: "google_search",
        outcome: "no_answer",
        blocks: [],
        citations: [],
        organicResults: [result],
        warnings: ["Fixture follow-up: no provider request was made."],
        effectiveParameters: { engine: "google", q: request.question, hl: request.locale.hl, gl: request.locale.gl },
        retrievedAt: new Date().toISOString(),
        providerCache: "unknown",
      });
      return { observation, rawResponses: [{ fixture: true, purpose: request.purpose, organic_results: [result] }], retryable: false, ambiguous: false };
    }
    const fixtureText = this.surface === "bing_copilot"
      ? `Fixture Copilot answer: ${request.question} is answered with a qualified comparison. The result is for interface and persistence testing only.`
      : this.surface === "google_ai_overview"
        ? `Fixture AI Overview: ${request.question} has a short answer with two inspected-looking references. This is a labeled fixture, not a live provider response.`
        : `Fixture AI Mode answer: ${request.question} is represented as an answer block with a citation mapping. This is a labeled fixture, not a live provider response.`;
    const observation = normalizedObservationSchema.parse({
      schemaVersion: "search-observation.v1",
      surface: this.surface,
      outcome: "answer",
      blocks: [{ id: `${this.surface}-fixture-block`, text: fixtureText, position: 0, referenceIndexes: [0, 1, 2] }],
      citations: sources,
      organicResults: sources.map((source) => ({ url: source.url, title: source.title, snippet: "Fixture discovery result" })),
      warnings: ["Fixture mode: no provider request was made."],
      effectiveParameters: { engine: this.surface, q: request.question, hl: request.locale.hl, gl: request.locale.gl },
      retrievedAt: new Date().toISOString(),
      providerCache: "unknown",
    });
    return { observation, rawResponses: [{ fixture: true, surface: this.surface, question: request.question, answer: fixtureText, references: sources }], retryable: false, ambiguous: false };
  }
}
