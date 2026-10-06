import { NextResponse } from "next/server";
import { getDatabase } from "../../../../../../server/db/client";
import { getInvestigationEvidence } from "../../../../../../server/db/repositories";

export async function GET(_request: Request, context: { params: Promise<{ id: string; evidenceId: string }> }) {
  const { id, evidenceId } = await context.params;
  const evidence = getInvestigationEvidence(getDatabase(), id, evidenceId);
  if (!evidence) return NextResponse.json({ code: "not_found", message: "Evidence not found in this investigation.", retryable: false }, { status: 404 });
  return NextResponse.json({ schemaVersion: "evidence-detail.v1", evidence });
}
