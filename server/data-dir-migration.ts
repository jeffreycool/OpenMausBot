// The one way a data folder ever moves (TappoTeamBot fork rename: ~/.openmausbot, or older ~/.opengrokbot, to
// ~/.tappoteambot): a person runs `openmausbot migrate-data` with the app and the server closed. Nothing here runs at
// start-up; a pre-rename folder is used where it is (data-dir.ts).
// Incident 2026-11-23: a move that ensureDirs() made by itself carried the production folder into a test's DATA_DIR,
// which a clean-up then deleted. The size and bot-count thresholds that were meant to tell test data from real data,
// and the opt-in environment variable around them, are gone with that move: a left-over opt-in now does nothing.
import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

import { describeDataDirLease } from "../electron/data-dir-lease.mjs";
import { noteDataDirRenamed } from "./config.ts";
import { DATA_DIR_NAME, defaultDataDir, unusedEarlierDataDirs } from "./data-dir.ts";
import { repairRenamedDataDirPaths } from "./moved-paths-repair.ts";

export const MIGRATE_DATA_USAGE = `openmausbot migrate-data [--to DIR] [--backup FILE | --no-backup]

Moves the data folder from its earlier name (~/.openmausbot, or before that
~/.opengrokbot) to ~/.tappoteambot. Until this is run, that folder is used
where it is: nothing ever moves when the app or the server starts.

Quit the app and stop the server first. The move is refused while either is
running, and when the target folder already exists.

A compressed copy of the old folder is written before anything moves, and a
copy that cannot be written stops the move.

--to DIR        the folder to move to (default ~/.tappoteambot)
--backup FILE   where to write the copy (default ~/.tappoteambot-migration-backup-<date and time>.tar.gz)
--no-backup     move without writing a copy`;

export interface MigrateDataArgs {
  to: string | undefined;
  backup: string | undefined;
  noBackup: boolean;
  help: boolean;
}

export function parseMigrateDataArgs(argv: string[]): MigrateDataArgs | { error: string } {
  const args: MigrateDataArgs = { to: undefined, backup: undefined, noBackup: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a path`);
      index += 1;
      return next;
    };
    try {
      if (arg === "--help" || arg === "-h") args.help = true;
      else if (arg === "--to") args.to = resolve(value());
      else if (arg === "--backup") args.backup = resolve(value());
      else if (arg === "--no-backup") args.noBackup = true;
      else return { error: `unknown argument "${arg}"` };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (args.backup !== undefined && args.noBackup) return { error: "choose --backup FILE or --no-backup, not both" };
  return args;
}

function stamp(date: Date): string {
  const pad = (length: number, value: number): string => String(value).padStart(length, "0");
  return `${date.getFullYear()}${pad(2, date.getMonth() + 1)}${pad(2, date.getDate())}-${pad(2, date.getHours())}${pad(2, date.getMinutes())}${pad(2, date.getSeconds())}`;
}

function defaultBackup(home: string, now: () => Date): string {
  return join(home, `${DATA_DIR_NAME}-migration-backup-${stamp(now())}.tar.gz`);
}

/** A compressed copy of the folder `from` (its name, as it sits in its parent folder) at `backup`. */
function archive(backup: string, from: string): boolean {
  const made = spawnSync("tar", ["-czf", backup, "-C", dirname(from), basename(from)], { stdio: ["ignore", "ignore", "pipe"] });
  if (made.error || made.status !== 0) {
    console.error(`migrate-data: the copy could not be written: ${made.error?.message ?? `tar exited with ${made.status}`}`);
    return false;
  }
  try {
    return statSync(backup).isFile() && statSync(backup).size > 0;
  } catch {
    return false;
  }
}

export interface MigrateDataOptions {
  home: string;
  /** The pre-rename folder, where it is. */
  from: string;
  to?: string | undefined;
  backup?: string | undefined;
  noBackup?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** The server's own record of who uses the folder; the real one unless a test says otherwise. */
  lease?: (dir: string) => ReturnType<typeof describeDataDirLease>;
  makeArchive?: (backup: string, from: string) => boolean;
}

export type MigrateDataResult =
  | { ok: true; from: string; to: string; backup: string | null; repaired: string[] | null }
  | { ok: false; error: string };

/** Why the move must not run. Reads only; nothing is moved or written while any of these hold. */
export function migrateDataRefusal(
  { from, to, backup, env = process.env }: { from: string; to: string; backup: string | null; env: NodeJS.ProcessEnv },
  lease: (dir: string) => ReturnType<typeof describeDataDirLease> = describeDataDirLease,
): string | null {
  if (!existsSync(from)) return `${from} is not there; nothing to move`;
  if (to === from) return "the old and the new folder are the same";
  if (existsSync(to)) return `${to} already exists; nothing was moved. Two data folders cannot be merged by a move`;
  if (env.OMB_DATA_DIR && resolve(env.OMB_DATA_DIR) === resolve(from)) {
    return "OMB_DATA_DIR names the old folder: after the move it would point at a folder that is gone. Unset it, then run this again";
  }
  const holder = lease(from);
  if (holder.state === "alive") return `${from} is in use by a running process (pid ${holder.pid}): quit the app and stop the server, then run this again`;
  if (holder.state !== "none" && holder.state !== "dead") return `it cannot be told whether ${from} is in use (${holder.state}), so nothing was moved`;
  if (backup !== null) {
    const target = resolve(backup);
    if (target.startsWith(resolve(from) + sep)) return `the copy would be written inside the folder being moved: ${backup}`;
    if (existsSync(target)) return `a file named ${backup} already exists; nothing was overwritten`;
  }
  return null;
}

/** Moves `from` to `to` after writing a copy, then rewrites the paths inside the data that named the old folder. */
export function migrateDataDir(options: MigrateDataOptions): MigrateDataResult {
  const { home, from } = options;
  const to = options.to ?? join(home, DATA_DIR_NAME);
  const backup = options.noBackup ? null : options.backup ?? defaultBackup(home, options.now ?? (() => new Date()));
  const env = options.env ?? process.env;
  const makeArchive = options.makeArchive ?? archive;
  const refusal = migrateDataRefusal({ from, to, backup, env }, options.lease);
  if (refusal !== null) return { ok: false, error: refusal };
  if (backup !== null) {
    if (!makeArchive(backup, from)) {
      // Nothing named this path before (see migrateDataRefusal), so what is there now is a copy cut short.
      rmSync(backup, { force: true });
      return { ok: false, error: `the copy of ${from} could not be written, so nothing was moved` };
    }
  }
  try {
    renameSync(from, to);
  } catch (error) {
    return { ok: false, error: `${from} could not be moved to ${to}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const repaired = repairRenamedDataDirPaths(to);
  noteDataDirRenamed(from);
  return { ok: true, from, to, backup, repaired };
}

export function runMigrateDataCli(
  argv: string[],
  io: { log(line: string): void; error(line: string): void } = console,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): number {
  const args = parseMigrateDataArgs(argv);
  if ("error" in args) {
    io.error(`migrate-data: ${args.error}\n\n${MIGRATE_DATA_USAGE}`);
    return 2;
  }
  if (args.help) {
    io.log(MIGRATE_DATA_USAGE);
    return 0;
  }
  const { dir, legacy } = defaultDataDir(home);
  if (legacy === null) {
    // The current folder is the default place, so an earlier-named folder beside it is not read: the app opens on what
    // the current folder holds. Saying "nothing to move" here read as "there was never any other data".
    const inUse = env.OMB_DATA_DIR || dir;
    const unused = unusedEarlierDataDirs(home, inUse);
    if (unused.length === 0) {
      io.log(`migrate-data: nothing to move. The data folder is ${dir}, already under the current name.`);
      return 0;
    }
    const target = args.to ?? join(home, DATA_DIR_NAME);
    io.error(
      `migrate-data: nothing was moved. The data folder in use is ${inUse}${env.OMB_DATA_DIR ? " (OMB_DATA_DIR)" : ""}, and ` +
        `${unused.length === 1 ? "a folder from an earlier name is" : "folders from earlier names are"} still there and not used:\n` +
        unused.map((path) => `  ${path}`).join("\n") +
        `\nNothing in ${unused.length === 1 ? "it is" : "them is"} read, and two data folders cannot be merged by a move. ` +
        `To bring the old one across: make sure ${target} holds nothing you want to keep, move it aside or delete it, then run this again.`,
    );
    return 1;
  }
  const result = migrateDataDir({ home, from: legacy, to: args.to, backup: args.backup, noBackup: args.noBackup, env });
  if (!result.ok) {
    io.error(`migrate-data: ${result.error}`);
    return 1;
  }
  io.log(`Moved the data folder.\n  from:   ${result.from}\n  to:     ${result.to}\n  copy:   ${result.backup ?? "none asked for (--no-backup)"}`);
  // The repair inside the data knows the ~/.openmausbot folder (moved-paths-repair.ts); a path naming the oldest
  // name is left as it is, and the person is told so rather than told that nothing needed rewriting.
  if (basename(result.from) === ".opengrokbot") {
    io.log(`Paths inside the data that name ${result.from} were left as they are: the repair knows the ~/.openmausbot folder only.`);
    return 0;
  }
  const repaired = result.repaired?.length ?? 0;
  io.log(repaired ? `Paths inside the data that named the old folder were rewritten in ${repaired} file(s); their earlier copies are in ${join(result.to, ".backups", "path-repair-tappo-rename")}.`
    : "No path inside the data named the old folder.");
  return 0;
}
