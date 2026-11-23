// The server's rule for where the data folder is (server/data-dir.ts resolveDataDir), in plain ESM for the Electron
// main process; desktop-data-dir parity is held by server/data-dir.test.ts.
export const DATA_DIR_NAME: ".tappoteambot";
export const LEGACY_DATA_DIR_NAMES: readonly string[];
export interface ResolvedDataDir {
  dir: string;
  /** `dir` itself when it is a folder under an earlier name, used where it is; else null. */
  legacy: string | null;
}
export function resolveDataDir(options: { home: string; env: Record<string, string | undefined>; exists?: (path: string) => boolean }): ResolvedDataDir;
