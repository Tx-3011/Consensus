import { NextResponse } from "next/server";
import { getDatabase } from "../../../../../server/db/client";
import { cancelInvestigation, getInvestigation } from "../../../../../server/db/repositories";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = getDatabase();
  if (!getInvestigation(db, id)) return NextResponse.json({ code: "not_found", message: "Investigation not found.", retryable: false }, { status: 404 });
  cancelInvestigation(db, id);
  return NextResponse.json({ schemaVersion: "investigation.v1", investigation: getInvestigation(db, id) });
}
