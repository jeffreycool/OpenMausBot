// Per-bot directory write allowlist (`dirAccess`): validate what a person may save on a bot, and resolve the absolute
// directories a turn may write. Reading is never restricted here; engines enforce writes at their own layer
// (codex: OS sandbox, claude: permission system, chat drivers: prompt only).
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

export type BotDirAccessMode = "workspace" | "custom" | "open";

/** Directory write policy. Absent = unrestricted (existing bots keep their behavior). */
export interface BotDirAccess {
  /** workspace = only this bot's OpenMausBot folders; custom = those plus extraDirs; open = anywhere. */
  mode: BotDirAccessMode;
  /** Extra writable absolute directories for mode "custom"; resolved and ~-expanded when saved. */
  extraDirs?: string[];
}

export const botDirAccessSchema = z.object({
  mode: z.enum(["workspace", "custom", "open"]),
  extraDirs: z.array(z.string().max(4096)).max(20).optional(),
}).strict();

export type DirAccessValidation =
  | { ok: true; dirAccess?: BotDirAccess }
  | { ok: false; error: string };

/** Same path rules as a bot's working folder (validateBotCwd): ~ expanded, absolute, an existing folder — then
 * real-pathed so the allowlist names where writes actually land. `null` clears the policy (back to unrestricted). */
export function validateBotDirAccessInput(input: unknown): DirAccessValidation {
  if (input === null) return { ok: true, dirAccess: undefined };
  const parsed = botDirAccessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "dirAccess must be { mode: workspace | custom | open, extraDirs?: string[] } with at most 20 directories of 4096 bytes each" };
  const { mode, extraDirs } = parsed.data;
  if (mode !== "custom" || !extraDirs?.length) return { ok: true, dirAccess: extraDirs?.length ? { mode, extraDirs } : { mode } };
  const resolved: string[] = [];
  for (const dir of extraDirs) {
    const expanded = dir.trim() === "~" || dir.trim().startsWith("~/") ? homedir() + dir.trim().slice(1) : dir.trim();
    if (!isAbsolute(expanded)) return { ok: false, error: `each allowed directory must be an absolute path: ${dir}` };
    const path = resolve(expanded);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return { ok: false, error: `that folder doesn't exist: ${path}` };
    }
    if (!stat.isDirectory()) return { ok: false, error: `that path is not a folder: ${path}` };
    if (!resolved.includes(path)) resolved.push(path);
  }
  return { ok: true, dirAccess: { mode, extraDirs: resolved } };
}

/** Path as the allowlist should compare it: the real location (through links) when it exists, else the resolved absolute path. */
function normalizedDir(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(path);
  try {
    if (statSync(absolute).isDirectory()) return realpathSync(absolute);
  } catch {
  }
  return absolute;
}

/** The directories a turn may write, or null when this bot is unrestricted. A restricted bot's own workspace folders and
 * the conversation's working folder are always writable (a room collaboration must not cut itself off from its own
 * folder); mode "custom" adds the allowlist. Pure: callers ensure the folders exist before dispatch. */
export function resolveWritableDirs(
  bot: { id: string; dirAccess?: BotDirAccess },
  turnCwd: string | undefined,
  dataDir: string,
): string[] | null {
  const policy = bot.dirAccess;
  if (!policy || policy.mode === "open") return null;
  const dirs = [join(dataDir, "workspaces", bot.id), join(dataDir, "task-workspaces", bot.id)];
  if (turnCwd) dirs.push(turnCwd);
  if (policy.mode === "custom") for (const dir of policy.extraDirs ?? []) dirs.push(normalizedDir(dir));
  return [...new Set(dirs)];
}

/** Whether `after` lets the bot write anywhere `before` could not. An absent policy — before or after — is
 * unrestricted, so every first restriction tightens (open > custom > workspace in reach, except a custom list
 * grows over another); the widening guard (patch route) sends this through the idle-bots check. */
export function dirAccessWidens(before: BotDirAccess | undefined, after: BotDirAccess | undefined): boolean {
  const rank = (mode: BotDirAccessMode | undefined) => (mode === "open" ? 2 : mode === "custom" ? 1 : 0);
  const beforeMode = before?.mode ?? "open";
  const afterMode = after?.mode ?? "open";
  const beforeRank = rank(beforeMode), afterRank = rank(afterMode);
  if (afterRank < beforeRank) return false; // a tightening never widens
  if (afterMode === "custom") {
    const known = beforeMode === "custom" ? new Set(before?.extraDirs ?? []) : new Set<string>();
    return (after?.extraDirs ?? []).some((dir) => !known.has(dir));
  }
  return afterRank > beforeRank;
}
