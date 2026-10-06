import crypto from "node:crypto";
import { SafeDocumentRetriever, type DocumentRetriever, type RetrievalResult } from "./fetch";

const fixtureText: Record<string, string> = {
  "www.nist.gov": "NIST publishes standard reference data. This fixture source reports that the answer is a qualified comparison and cites report DOI 10.1000/consensus-fixture.",
  "www.example.org": "Originally published by Example Research. This labeled fixture describes the methods used for the qualified comparison. It does not independently verify every claim in the answer.",
  "mirror.example.net": "Originally published by Example Research. This labeled fixture describes the methods used for the qualified comparison. It does not independently verify every claim in the answer.",
};

export class FixtureDocumentRetriever implements DocumentRetriever {
  async fetch(url: string): Promise<RetrievalResult> {
    const parsed = new URL(url);
    const text = parsed.pathname === "/counter-evidence"
      ? "A later controlled trial found no improvement in the tested outcome and contradicts the broad headline claim. DOI 10.1000/contrasting-fixture."
      : fixtureText[parsed.hostname] || `Labeled fixture document for ${parsed.hostname}.`;
    return {
      requestedUrl: url,
      finalUrl: url,
      outcome: "fetched",
      httpStatus: 200,
      mimeType: "text/html",
      contentHash: crypto.createHash("sha256").update(text).digest("hex"),
      extractedText: text,
      title: `Fixture source: ${parsed.hostname}`,
      outboundLinks: [],
      redirectChain: [],
      dateUncertain: true,
      truncated: false,
      fetchedAt: new Date().toISOString(),
    };
  }
}

export function getDocumentRetriever(mode: "live" | "fixture"): DocumentRetriever {
  return mode === "fixture" ? new FixtureDocumentRetriever() : new SafeDocumentRetriever();
}
