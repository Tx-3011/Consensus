import { NextResponse } from "next/server";
import { getDatabase } from "../../../../../server/db/client";
import { getInvestigationGraph } from "../../../../../server/db/repositories";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const claimId = new URL(request.url).searchParams.get("claimId") || undefined;
  const graph = getInvestigationGraph(getDatabase(), id, claimId);
  if (!graph) return NextResponse.json({ code: "not_found", message: "Investigation or claim group not found.", retryable: false }, { status: 404 });
  return NextResponse.json(graph);
}
