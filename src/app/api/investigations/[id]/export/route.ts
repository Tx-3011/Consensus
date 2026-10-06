import { NextResponse } from "next/server";
import { getDatabase } from "../../../../../server/db/client";
import { getInvestigation } from "../../../../../server/db/repositories";
import { buildInvestigationExport, renderInvestigationHtml } from "../../../../../server/exports/investigation";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const snapshot = getInvestigation(getDatabase(), id) as Record<string, unknown> | undefined;
  if (!snapshot) return NextResponse.json({ code: "not_found", message: "Investigation not found.", retryable: false }, { status: 404 });
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format === "html") {
    return new Response(renderInvestigationHtml(snapshot), { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="consensus-${id}.html"` } });
  }
  if (format !== "json") return NextResponse.json({ code: "invalid_format", message: "Format must be json or html.", retryable: false }, { status: 400 });
  return new Response(JSON.stringify(buildInvestigationExport(snapshot), null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="consensus-${id}.json"` } });
}
