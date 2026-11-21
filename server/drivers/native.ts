// Tees every provider-native message beside the canonical stream, so protocol drift shows up in a diff. Lines are held
// per thread and appended together every FLUSH_MS, when a caller flushes, and at exit.
// Appends are async (fs/promises), one in flight per thread and the rest queued behind it, so a turn's stream of native
// records — including the multi-megabyte thread/resume a codex turn opens with — never blocks the server's event loop
// on disk. Publication order per thread is kept by that chain. `process.exit` cannot await: the exit hook writes what is
// still held synchronously, accepting that an append already in flight at a hard exit may be lost — the same posture as
// the canonical event log (server/harness/bus.ts), of which this tee is only the diagnostics copy.
import { appendFileSync, rmSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

import { NATIVE_DIR } from "../config.ts";
import { redactSecrets } from "../redact.ts";
import { capThreadLog, currentThreadLogCap } from "../thread-log-rotation.ts";

const INLINE_DATA_CHARS = 1024;
const DATA_URL = /^data:[^,;]{0,100};base64,/;
const FLUSH_MS = 250;
const MAX_HELD_CHARS = 256 * 1024;

const held = new Map<string, string[]>();
let heldChars = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** One append in flight per thread; appends queued behind it keep each thread's file in publication order. */
const writing = new Map<string, Promise<void>>();
/** Threads deleted while an append was in flight: the append's file is removed once it lands, so a delete cannot be
 * undone by a late write (store.ts unlinks the path right after discardNativeLog). */
const discarded = new Set<string>();

function carriesBase64(record: Record<string, unknown>): boolean {
  return record.type === "base64" || record.type === "image" || imageMedia(record);
}

function imageMedia(record: Record<string, unknown>): boolean {
  const media = record.media_type ?? record.mimeType ?? record.mime_type;
  return typeof media === "string" && media.startsWith("image/");
}

/** Screenshots and files inline as base64 carry no protocol shape, only their length. */
function withoutInlineData(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > INLINE_DATA_CHARS && DATA_URL.test(value) ? `[data URL: ${value.length} chars]` : value;
  }
  if (depth > 12 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const next = withoutInlineData(item, depth + 1);
      changed ||= next !== item;
      return next;
    });
    return changed ? items : value;
  }
  const record = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;
  for (const [key, child] of Object.entries(record)) {
    const next = key === "data" && typeof child === "string" && child.length > INLINE_DATA_CHARS && carriesBase64(record)
      ? `[${record.type === "image" || imageMedia(record) ? "image" : "base64"} data: ${child.length} base64 chars]`
      : withoutInlineData(child, depth + 1);
    if (next !== child) (copy ??= { ...record })[key] = next;
  }
  return copy ?? value;
}

/** A fragment a later record of the same protocol carries whole: Claude Code's content_block_delta stream events (then
 * the assistant message), Codex app-server item deltas (then item/completed), Pi's message and tool updates (then
 * message_end and tool_execution_end). */
export function streamedFragment(source: string, msg: unknown): boolean {
  if (msg === null || typeof msg !== "object") return false;
  const record = msg as Record<string, unknown>;
  if (source === "claude.sdk.message") return record.type === "stream_event" && (record.event as { type?: unknown } | undefined)?.type === "content_block_delta";
  if (source === "codex.app-server") return typeof record.method === "string" && record.method.startsWith("item/") && /delta$/i.test(record.method);
  if (source === "pi.rpc") return record.type === "message_update" || record.type === "tool_execution_update";
  return false;
}

export function appendNative(threadId: string, entry: { dir: "in" | "out"; source: string; msg: unknown }) {
  if (streamedFragment(entry.source, entry.msg)) return;
  let line: string;
  try {
    // Session setup carries agent credentials (boat/comms tokens, MCP headers) and
    // people paste these logs into bug reports, so values are masked.
    line = JSON.stringify({ at: new Date().toISOString(), ...entry, msg: redactSecrets(withoutInlineData(entry.msg)) }) + "\n";
  } catch {
    return;
  }
  const lines = held.get(threadId);
  if (lines) lines.push(line);
  else held.set(threadId, [line]);
  heldChars += line.length;
  // What OpenMausBot sent is a few lines a turn, and the line a bug report most needs: it lands at once.
  if (entry.dir === "out") flushNativeLog(threadId);
  else if (heldChars >= MAX_HELD_CHARS) flushNativeLogs();
  else if (!timer) {
    timer = setTimeout(flushNativeLogs, FLUSH_MS);
    timer.unref?.();
  }
}

/** Queues this thread's held lines to disk; `drainNativeLog` is the write's completion. */
export function flushNativeLog(threadId: string): void {
  const lines = take(threadId);
  if (!lines) return;
  const file = join(NATIVE_DIR, `${threadId}.ndjson`);
  const text = lines.join("");
  const chain = writing.get(threadId) ?? Promise.resolve();
  const next = chain.then(() => writeNative(file, text, threadId), () => writeNative(file, text, threadId));
  writing.set(threadId, next);
  next.finally(() => {
    if (writing.get(threadId) === next) writing.delete(threadId);
  }).catch(() => {});
}

async function writeNative(file: string, text: string, threadId: string): Promise<void> {
  try {
    await appendFile(file, text, { mode: 0o600 });
    await capThreadLog(file, currentThreadLogCap());
  } catch {
  }
  if (discarded.delete(threadId)) {
    try {
      rmSync(file, { force: true });
    } catch {
    }
  }
}

/** The write this thread's last flush queued, done; a reader of the log waits for this first. */
export function drainNativeLog(threadId: string): Promise<void> {
  return writing.get(threadId) ?? Promise.resolve();
}

/** Every write queued so far, done (and one more pass for lines a timer held back). */
export async function drainNativeLogs(): Promise<void> {
  await Promise.all(writing.values());
  if ([...held.values()].some((lines) => lines.length)) {
    flushNativeLogs();
    await Promise.all(writing.values());
  }
}

export function flushNativeLogs(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const threadId of Array.from(held.keys())) flushNativeLog(threadId);
}

/** A deleted thread's held lines are dropped, so a later flush cannot recreate its log; a write still in flight for it
 * removes its file when the write lands (writeNative), so the delete stands. */
export function discardNativeLog(threadId: string): void {
  take(threadId);
  if (writing.has(threadId)) discarded.add(threadId);
}

function take(threadId: string): string[] | undefined {
  const lines = held.get(threadId);
  if (!lines) return undefined;
  held.delete(threadId);
  for (const line of lines) heldChars -= line.length;
  return lines;
}

process.once("exit", () => {
  if (timer) clearTimeout(timer);
  // process.exit cannot await: what is still held is written synchronously (an append already in flight cannot be
  // waited for and may be lost — the same posture as the canonical event log's own exit). Queuing it through
  // flushNativeLog would only move it into an async write this exit never waits for.
  for (const [threadId, lines] of held) {
    try {
      appendFileSync(join(NATIVE_DIR, `${threadId}.ndjson`), lines.join(""), { mode: 0o600 });
    } catch {
    }
    held.delete(threadId);
  }
});
