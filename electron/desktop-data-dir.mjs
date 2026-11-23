// The server's rule for where the data folder is (server/data-dir.ts, resolveDataDir), in plain ESM: the Electron
// main process cannot import the server's TypeScript, which ships as a bundle of its own, and desktop-data-dir.test.mjs
// holds the two to the same answer. Nothing is moved here, at start or ever: a folder under an earlier name is used
// where it is, and moves only when a person runs `openmausbot migrate-data`.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR_NAME = ".tappoteambot";
export const LEGACY_DATA_DIR_NAMES = [".openmausbot", ".opengrokbot"];

export function resolveDataDir({ home, env, exists = existsSync }) {
  if (env.OMB_DATA_DIR) {
    const legacy = LEGACY_DATA_DIR_NAMES.find((name) => env.OMB_DATA_DIR === join(home, name));
    return { dir: env.OMB_DATA_DIR, legacy: legacy === undefined ? null : env.OMB_DATA_DIR };
  }
  const current = join(home, DATA_DIR_NAME);
  if (exists(current)) return { dir: current, legacy: null };
  for (const name of LEGACY_DATA_DIR_NAMES) {
    const legacy = join(home, name);
    if (exists(legacy)) return { dir: legacy, legacy };
  }
  return { dir: current, legacy: null };
}
