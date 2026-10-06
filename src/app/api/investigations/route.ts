import { NextResponse } from "next/server";
import { investigationCreateSchema } from "../../../contracts/investigation";
import { getDatabase } from "../../../server/db/client";
import { queueInvestigation } from "../../../server/investigations/queue";
import { findByIdempotencyKey, getInvestigation } from "../../../server/db/repositories";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = investigationCreateSchema.safeParse(body);
    if (!parsed.success) return errorResponse("invalid_request", "Question, locale, or surfaces are invalid.", false, 400);
    const key = request.headers.get("Idempotency-Key")?.trim() || undefined;
    const db = getDatabase();
    if (key) {
      const existing = findByIdempotencyKey(db, key);
      if (existing) {
        const saved = getInvestigation(db, existing.id) as { question: string; mode: string; selectedSurfaces: unknown } | undefined;
        if (saved && saved.question === parsed.data.question && saved.mode === parsed.data.mode && JSON.stringify(saved.selectedSurfaces) === JSON.stringify(parsed.data.surfaces)) {
          return NextResponse.json({ id: existing.id, statusUrl: `/api/investigations/${existing.id}`, replayed: true }, { status: 202 });
        }
        return errorResponse("idempotency_conflict", "That Idempotency-Key was already used with a different request.", false, 409);
      }
    }
    const id = queueInvestigation(parsed.data, key);
    return NextResponse.json({ id, statusUrl: `/api/investigations/${id}`, eventsUrl: `/api/investigations/${id}/events`, replayed: false, queued: true }, { status: 202 });
  } catch (error) {
    return errorResponse("collection_failed", error instanceof Error ? error.message : "Unable to collect this investigation.", true, 500);
  }
}

export async function GET(request: Request) {
  const db = getDatabase();
  const cursor = decodeCursor(new URL(request.url).searchParams.get("cursor"));
  const rows = (cursor
    ? db.prepare(`SELECT id, question, mode, status, stage, created_at, finished_at FROM investigations
        WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT 21`).all(cursor.createdAt, cursor.createdAt, cursor.id)
    : db.prepare("SELECT id, question, mode, status, stage, created_at, finished_at FROM investigations ORDER BY created_at DESC, id DESC LIMIT 21").all()) as Array<Record<string, unknown>>;
  const hasMore = rows.length > 20;
  const items = rows.slice(0, 20);
  const last = items.at(-1);
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString("base64url") : null;
  return NextResponse.json({ items, nextCursor });
}

function errorResponse(code: string, message: string, retryable: boolean, status: number) {
  return NextResponse.json({ code, message, retryable }, { status });
}

function decodeCursor(value: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    return typeof parsed.createdAt === "string" && typeof parsed.id === "string" ? { createdAt: parsed.createdAt, id: parsed.id } : undefined;
  } catch {
    return undefined;
  }
}
