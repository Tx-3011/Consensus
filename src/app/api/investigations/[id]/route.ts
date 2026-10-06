import { NextResponse } from "next/server";
import { getDatabase } from "../../../../server/db/client";
import { getInvestigation } from "../../../../server/db/repositories";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const investigation = getInvestigation(getDatabase(), id);
  if (!investigation) return NextResponse.json({ code: "not_found", message: "Investigation not found.", retryable: false }, { status: 404 });
  return NextResponse.json({ schemaVersion: "investigation.v1", investigation });
}
