// Opt-in size cap for per-thread NDJSON logs: keep the newest half, cut on a line boundary, same filename.
// The trim reads and writes asynchronously (fs/promises): a capped log is hundreds of megabytes, and trimming it
// synchronously would hold the server's event loop off its work for the whole copy. The one synchronous writer left
// (native.ts's exit hook) bypasses the cap — at exit, getting the lines out outranks the cap.
import { closeSync, fstatSync, openSync, readSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";

/** Where no limit is set, each conversation's event log is still trimmed (to its newest half) past this: one runaway
 * conversation, or hundreds of long ones across many bots, cannot fill the disk. Transcripts are never trimmed. */
export const DEFAULT_THREAD_EVENT_LOG_MAX_BYTES = 256 * 1024 * 1024;

/** The cap the logs are trimmed to: the person's limit (config's threadEventLogMaxBytes), or the default ceiling. */
export const threadLogCapOrDefault = (cap: number | null): number | null => cap ?? DEFAULT_THREAD_EVENT_LOG_MAX_BYTES;

let capProvider: () => number | null = () => null;

export function bindThreadLogCapProvider(provider: () => number | null): void {
  capProvider = provider;
}

export function currentThreadLogCap(): number | null {
  try {
    return capProvider();
  } catch {
    return null;
  }
}

export async function capThreadLog(file: string, maxBytes: number | null): Promise<void> {
  if (typeof maxBytes !== "number" || !Number.isFinite(maxBytes) || maxBytes <= 0) return;
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return;
  }
  if (size <= maxBytes) return;
  await trimToTail(file, Math.max(1, Math.floor(maxBytes / 2)));
}

async function trimToTail(file: string, keepBytes: number): Promise<void> {
  const staging = `${file}.trim`;
  try {
    const window = Buffer.from(await readFile(file));
    if (window.length === 0) return;
    // Keep the newest keepBytes, starting on a record boundary; a window with no newline is one oversized record, so leave it.
    const start = Math.max(0, window.length - keepBytes);
    const slice = window.subarray(start);
    const firstNewline = slice.indexOf(0x0a);
    if (firstNewline === -1 || firstNewline + 1 >= slice.length) return;
    const kept = slice.subarray(firstNewline + 1);
    if (kept.length === 0) return;
    await writeFile(staging, kept, { mode: 0o600 });
    await rename(staging, file);
  } catch {
    try {
      await rm(staging, { force: true });
    } catch {
    }
  }
}

/** The synchronous trim, kept for the places that still write synchronously (native.ts's exit hook). */
export function capThreadLogSync(file: string, maxBytes: number | null): void {
  if (typeof maxBytes !== "number" || !Number.isFinite(maxBytes) || maxBytes <= 0) return;
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return;
  }
  if (size <= maxBytes) return;
  trimToTailSync(file, Math.max(1, Math.floor(maxBytes / 2)));
}

function trimToTailSync(file: string, keepBytes: number): void {
  const staging = `${file}.trim`;
  try {
    const source = openSync(file, "r");
    try {
      const size = fstatSync(source).size;
      const start = Math.max(0, size - keepBytes);
      const window = Buffer.allocUnsafe(size - start);
      // readSync may return fewer bytes than asked; zero means the file shrank, so leave it.
      let filled = 0;
      while (filled < window.length) {
        const count = readSync(source, window, filled, window.length - filled, start + filled);
        if (count === 0) return;
        filled += count;
      }
      // Start on a record boundary; a window with no newline is one oversized record, so leave the file alone.
      const firstNewline = window.indexOf(0x0a);
      if (firstNewline === -1 || firstNewline + 1 >= window.length) return;
      const target = openSync(staging, "w", 0o600);
      try {
        // writeSync can stop short too; zero progress is a failure.
        let written = firstNewline + 1;
        while (written < window.length) {
          const count = writeSync(target, window, written, window.length - written);
          if (count === 0) throw new Error(`no progress writing ${staging}`);
          written += count;
        }
      } finally {
        closeSync(target);
      }
    } finally {
      closeSync(source);
    }
    renameSync(staging, file);
  } catch {
    try {
      rmSync(staging, { force: true });
    } catch {
    }
  }
}
