import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";

let resolvedHome: string | undefined;

/** The home the data folder lives under. Under vitest, with HOME still the real one, a temp folder instead, so a test
 * never reads or deletes the person's own data. */
export function dataHome(): string {
  if (resolvedHome !== undefined) return resolvedHome;
  const real = homedir();
  resolvedHome = process.env.VITEST !== undefined && real === userInfo().homedir ? mkdtempSync(join(tmpdir(), "omb-test-home-")) : real;
  return resolvedHome;
}

/** The data folder's name since the TappoTeamBot rename. */
export const DATA_DIR_NAME = ".tappoteambot";
/** Earlier names of that folder, newest first. One that is still there is used where it is. */
export const LEGACY_DATA_DIR_NAMES = [".openmausbot", ".opengrokbot"];

export interface ResolvedDataDir {
  /** The folder this process keeps its data in. */
  dir: string;
  /** `dir` itself when it is a pre-rename folder in its default place (used where it is), else null. */
  legacy: string | null;
}

/** The pre-rename name `dir` sits under in `home`, if it is one. The desktop app names the default place for its
 * server through OMB_DATA_DIR, so a folder is "still the old one" by where it is, not by how it was chosen. */
function legacyName(home: string, dir: string): string | null {
  return LEGACY_DATA_DIR_NAMES.some((name) => dir === join(home, name)) ? dir : null;
}

/**
 * The default place, whatever OMB_DATA_DIR says: the current folder when it exists, else the first pre-rename folder
 * that does, used where it is; the current folder's path when none exists. Moves nothing, ever: a folder moves only
 * when a person runs `openmausbot migrate-data` (data-dir-migration.ts).
 */
export function defaultDataDir(home: string): ResolvedDataDir {
  const current = join(home, DATA_DIR_NAME);
  if (existsSync(current)) return { dir: current, legacy: null };
  for (const name of LEGACY_DATA_DIR_NAMES) {
    const legacy = join(home, name);
    if (existsSync(legacy)) return { dir: legacy, legacy };
  }
  return { dir: current, legacy: null };
}

/** Earlier-named folders still under `home` that are not the one in use. Nothing in them is read while the data is kept
 * elsewhere, and a move cannot merge two data folders, so a person is told they are there rather than left to find an
 * empty app. Reads only. */
export function unusedEarlierDataDirs(home: string, inUse: string): string[] {
  return LEGACY_DATA_DIR_NAMES.map((name) => join(home, name)).filter((path) => path !== inUse && existsSync(path));
}

const quoted = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/** The command that moves this install's pre-rename folder, written out for a terminal. Inside the desktop app
 * (OMB_DESKTOP_PARENT) the server is the app's own executable run as Node, and the command ships beside it. */
export function migrateDataCommand(
  env: Record<string, string | undefined> = process.env,
  execPath: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.OMB_DESKTOP_PARENT !== "1" || !env.OMB_RESOURCES_PATH) return "openmausbot migrate-data";
  const script = join(env.OMB_RESOURCES_PATH, "server", "openmausbot.js");
  return platform === "win32"
    ? `$env:ELECTRON_RUN_AS_NODE=1; & "${execPath}" "${script}" migrate-data`
    : `ELECTRON_RUN_AS_NODE=1 ${quoted(execPath)} ${quoted(script)} migrate-data`;
}

/** Where this process keeps its data. OMB_DATA_DIR when it is set (an empty one counts as unset), else the default
 * place. Never creates or moves anything: that is ensureDirs() in config.ts and the migrate-data command's work. */
export function resolveDataDir({ home, env }: { home: string; env: Record<string, string | undefined> }): ResolvedDataDir {
  return env.OMB_DATA_DIR ? { dir: env.OMB_DATA_DIR, legacy: legacyName(home, env.OMB_DATA_DIR) } : defaultDataDir(home);
}
