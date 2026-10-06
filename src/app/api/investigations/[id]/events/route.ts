import { getDatabase } from "../../../../../server/db/client";
import { getInvestigation } from "../../../../../server/db/repositories";

export const runtime = "nodejs";

const TERMINAL_STATUSES = new Set(["complete", "partial", "failed", "cancelled"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = getDatabase();
  if (!getInvestigation(db, id)) {
    return new Response(JSON.stringify({ code: "not_found", message: "Investigation not found.", retryable: false }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const parsedLastEventId = Number(request.headers.get("Last-Event-ID") ?? 0);
  let lastSequence = Number.isFinite(parsedLastEventId) ? parsedLastEventId : 0;
  const encoder = new TextEncoder();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        request.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* stream already closed */ }
      };

      const sendSnapshot = (force = false) => {
        if (closed) return;
        const snapshot = getInvestigation(db, id);
        if (!snapshot) return cleanup();
        const events = snapshot.events as unknown as Array<{ sequence: number }>;
        const pending = events.filter((event) => event.sequence > lastSequence);
        if (force && pending.length === 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ snapshot })}\n\n`));
        }
        for (const event of pending) {
          lastSequence = event.sequence;
          controller.enqueue(encoder.encode(`id: ${event.sequence}\ndata: ${JSON.stringify({ snapshot })}\n\n`));
        }
        if (TERMINAL_STATUSES.has(String((snapshot as unknown as { status: string }).status))) cleanup();
      };

      request.signal.addEventListener("abort", cleanup);
      sendSnapshot(true);
      if (!closed) {
        pollTimer = setInterval(() => sendSnapshot(), 500);
        heartbeatTimer = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }, 15_000);
      }
    },
    cancel() {
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
