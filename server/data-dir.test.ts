// Where the data folder is: one rule for the server and the desktop app, and nothing moves at start.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveDataDir as desktopResolveDataDir } from "../electron/desktop-data-dir.mjs";
import { dataDirRenamedFrom } from "./config.ts";
import { DATA_DIR_NAME, defaultDataDir, migrateDataCommand, resolveDataDir } from "./data-dir.ts";
import { migrateDataDir, parseMigrateDataArgs, runMigrateDataCli } from "./data-dir-migration.ts";
import { acquireDataDirLease } from "../electron/data-dir-lease.mjs";

const homes: string[] = [];
/** A home with the given folders in it. */
function aHome(...names: string[]): string {
  const home = mkdtempSync(join(tmpdir(), "omb-data-dir-home-"));
  homes.push(home);
  for (const name of names) mkdirSync(join(home, name));
  return home;
}
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("resolveDataDir", () => {
  it("uses the current folder when it is there, whatever else is", () => {
    const home = aHome(DATA_DIR_NAME, ".openmausbot", ".opengrokbot");
    expect(resolveDataDir({ home, env: {} })).toEqual({ dir: join(home, DATA_DIR_NAME), legacy: null });
  });

  it("uses a pre-rename folder where it is, newest name first, and creates nothing", () => {
    const home = aHome(".openmausbot", ".opengrokbot");
    expect(resolveDataDir({ home, env: {} })).toEqual({ dir: join(home, ".openmausbot"), legacy: join(home, ".openmausbot") });
    expect(readdirSync(home).sort()).toEqual([".opengrokbot", ".openmausbot"]);
  });

  it("uses the oldest pre-rename folder when it is the only one", () => {
    const home = aHome(".opengrokbot");
    expect(resolveDataDir({ home, env: {} })).toEqual({ dir: join(home, ".opengrokbot"), legacy: join(home, ".opengrokbot") });
  });

  it("names the current folder when none exists", () => {
    const home = aHome();
    expect(resolveDataDir({ home, env: {} })).toEqual({ dir: join(home, DATA_DIR_NAME), legacy: null });
    expect(defaultDataDir(home)).toEqual({ dir: join(home, DATA_DIR_NAME), legacy: null });
    expect(readdirSync(home)).toEqual([]);
  });

  it("OMB_DATA_DIR wins; it is the legacy folder only when it names one in the default place", () => {
    const home = aHome(".openmausbot");
    const elsewhere = join(home, "elsewhere");
    expect(resolveDataDir({ home, env: { OMB_DATA_DIR: elsewhere } })).toEqual({ dir: elsewhere, legacy: null });
    // The desktop app names the default place for its server this way, with the old folder as often as the new one.
    expect(resolveDataDir({ home, env: { OMB_DATA_DIR: join(home, ".openmausbot") } })).toEqual({ dir: join(home, ".openmausbot"), legacy: join(home, ".openmausbot") });
  });

  it("treats an empty OMB_DATA_DIR as unset", () => {
    const home = aHome(".openmausbot");
    expect(resolveDataDir({ home, env: { OMB_DATA_DIR: "" } })).toEqual({ dir: join(home, ".openmausbot"), legacy: join(home, ".openmausbot") });
  });
});

describe("the command Settings hands out", () => {
  it("is the plain command outside the desktop app", () => {
    expect(migrateDataCommand({}, "/usr/bin/node", "darwin")).toBe("openmausbot migrate-data");
  });
  it("inside the desktop app names the app's own executable run as Node and the bundled command", () => {
    const home = aHome();
    const exe = join(home, "it's TappoTeamBot.app", "Contents", "MacOS", "TappoTeamBot"), resources = join(exe, "..", "..", "..", "Resources");
    const bundled = join(resources, "server", "openmausbot.js"), shell = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;
    // A single quote inside a single-quoted word ends it, adds an escaped quote, and starts a new one: '\''.
    expect(migrateDataCommand({ OMB_DESKTOP_PARENT: "1", OMB_RESOURCES_PATH: resources }, exe, "darwin"))
      .toBe(`ELECTRON_RUN_AS_NODE=1 ${shell(exe)} ${shell(bundled)} migrate-data`);
    expect(migrateDataCommand({ OMB_DESKTOP_PARENT: "1", OMB_RESOURCES_PATH: resources }, exe, "win32"))
      .toBe(`$env:ELECTRON_RUN_AS_NODE=1; & "${exe}" "${bundled}" migrate-data`);
  });
});

describe("one rule for the server and the desktop app", () => {
  const places = [[], [DATA_DIR_NAME], [".openmausbot"], [".opengrokbot"], [".openmausbot", ".opengrokbot"], [DATA_DIR_NAME, ".openmausbot", ".opengrokbot"]];
  const picks = (home: string): Record<string, string>[] => [{}, { OMB_DATA_DIR: "" }, { OMB_DATA_DIR: join(home, "elsewhere") }, { OMB_DATA_DIR: join(home, ".openmausbot") }];
  it.each(places)("agree on a home holding %j", (...names) => {
    const home = aHome(...names);
    for (const env of picks(home)) expect(desktopResolveDataDir({ home, env })).toEqual(resolveDataDir({ home, env }));
  });

  it.each([
    ["server/config.ts", /from "\.\/data-dir\.ts"/],
    ["server/cli.ts", /from "\.\/data-dir\.ts"/],
    ["server/server-launcher.ts", /from "\.\/data-dir\.ts"/],
    ["server/config-cli.ts", /from "\.\/data-dir\.ts"/],
    ["electron/main.mjs", /from "\.\/desktop-data-dir\.mjs"/],
  ])("%s resolves the data folder through the one rule and spells no default of its own", (file, imports) => {
    const text = readFileSync(join(import.meta.dirname, "..", file), "utf8");
    expect(text).toMatch(imports);
    expect(text).not.toContain(`"${DATA_DIR_NAME}"`);
  });
});

describe("start-up never moves the data folder", () => {
  const config = readFileSync(join(import.meta.dirname, "config.ts"), "utf8");
  it("ensureDirs() only creates folders", () => {
    const body = config.slice(config.indexOf("export function ensureDirs()"), config.indexOf("\n}\n", config.indexOf("export function ensureDirs()")));
    expect(body).toMatch(/mkdirSync/);
    expect(body).not.toMatch(/rename/i);
  });
  it("dataDirRenamedFrom is set by the migrate-data command alone", () => {
    const setters = [...config.matchAll(/^\s*(dataDirRenamedFrom = [^;\n]*;)/gm)].map(([ , setter]) => setter);
    expect(setters).toEqual(["dataDirRenamedFrom = from;"]);
    expect(config).toMatch(/export function noteDataDirRenamed\(from: string\): void \{\n  dataDirRenamedFrom = from;/);
  });
});

/** A pre-rename folder with a bot whose notes name a file inside it: the move must rewrite that path. */
function homeWithLegacyData(name = ".openmausbot"): { home: string; from: string; to: string } {
  const home = aHome();
  const from = join(home, name);
  mkdirSync(from);
  writeFileSync(join(from, "bots.json"), JSON.stringify([{ id: "bot", soul: `Keep your notes in ${from}/bots/bot/SOUL.md.` }]));
  writeFileSync(join(from, "config.json"), "{}");
  return { home, from, to: join(home, DATA_DIR_NAME) };
}

describe("openmausbot migrate-data", () => {
  function run(argv: string[], home: string, env: NodeJS.ProcessEnv = {}): { code: number; said: string } {
    const said: string[] = [];
    const code = runMigrateDataCli(argv, { log: (line) => said.push(line), error: (line) => said.push(line) }, env, home);
    return { code, said: said.join("\n") };
  }

  it("writes a copy, moves the folder, and rewrites the paths inside the data", () => {
    const { home, from, to } = homeWithLegacyData();
    const { code, said } = run([], home);
    expect(code).toBe(0);
    expect(existsSync(from)).toBe(false);
    expect(JSON.parse(readFileSync(join(to, "bots.json"), "utf8"))[0].soul).toContain(`${to}/bots/bot/SOUL.md`);
    const copy = readdirSync(home).find((name) => name.startsWith(`${DATA_DIR_NAME}-migration-backup-`));
    expect(copy, "the copy is written beside the folder, not inside it").toBeDefined();
    expect(statSync(join(home, copy!)).size).toBeGreaterThan(0);
    expect(defaultDataDir(home)).toEqual({ dir: to, legacy: null });
    expect(dataDirRenamedFrom).toBe(from);
    expect(said).toContain(from);
    expect(said).toContain(to);
    expect(said).toContain(join(home, copy!));
  });

  it("refuses while a running process holds the folder (the app or the server), and moves nothing", () => {
    const { home, from } = homeWithLegacyData();
    const lease = acquireDataDirLease(from);
    try {
      expect(migrateDataDir({ home, from, env: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/in use by a running process/) });
      expect(existsSync(join(from, "bots.json"))).toBe(true);
      expect(existsSync(join(home, DATA_DIR_NAME))).toBe(false);
    } finally {
      lease.release();
    }
  });

  it("refuses when the target folder already exists", () => {
    const { home, from, to } = homeWithLegacyData();
    mkdirSync(to);
    expect(migrateDataDir({ home, from, env: {}, makeArchive: () => false })).toMatchObject({ ok: false, error: expect.stringMatching(/already exists/) });
    expect(existsSync(join(from, "bots.json"))).toBe(true);
    expect(readdirSync(to)).toEqual([]);
  });

  it("stops when the copy cannot be written", () => {
    const { home, from } = homeWithLegacyData();
    expect(migrateDataDir({ home, from, env: {}, makeArchive: () => false })).toMatchObject({ ok: false, error: expect.stringMatching(/could not be written/) });
    expect(existsSync(join(from, "bots.json"))).toBe(true);
  });

  it("refuses when OMB_DATA_DIR names the old folder, which the move would leave it pointing at", () => {
    const { home, from } = homeWithLegacyData();
    expect(run([], home, { OMB_DATA_DIR: from }).code).toBe(1);
    expect(existsSync(join(from, "bots.json"))).toBe(true);
  });

  it("moves to --to and skips the copy with --no-backup", () => {
    const { home } = homeWithLegacyData();
    const to = join(home, "moved");
    expect(run(["--to", to, "--no-backup"], home).code).toBe(0);
    expect(existsSync(join(to, "bots.json"))).toBe(true);
    expect(readdirSync(home).some((name) => name.includes("backup"))).toBe(false);
  });

  it("says there is nothing to move, and exits 0, when no pre-rename folder is there", () => {
    const home = aHome(DATA_DIR_NAME);
    const { code, said } = run([], home);
    expect(code).toBe(0);
    expect(said).toMatch(/nothing to move/);
  });

  it("when the current folder and earlier ones are both there: names the one in use, says the others are not read and cannot be merged, and how to bring them across; exits 1 and moves nothing", () => {
    const home = aHome(DATA_DIR_NAME, ".openmausbot", ".opengrokbot");
    writeFileSync(join(home, ".openmausbot", "bots.json"), "[]");
    const { code, said } = run([], home);
    expect(code).toBe(1);
    expect(said).toContain(`The data folder in use is ${join(home, DATA_DIR_NAME)}`);
    expect(said).toContain(join(home, ".openmausbot"));
    expect(said).toContain(join(home, ".opengrokbot"));
    expect(said).toMatch(/still there and not used/);
    expect(said).toMatch(/cannot be merged by a move/);
    expect(said).toContain(`make sure ${join(home, DATA_DIR_NAME)} holds nothing you want to keep, move it aside or delete it, then run this again`);
    expect(said).not.toMatch(/nothing to move/);
    expect(readFileSync(join(home, ".openmausbot", "bots.json"), "utf8")).toBe("[]");
  });

  it("names the folder OMB_DATA_DIR points at as the one in use", () => {
    const home = aHome(DATA_DIR_NAME, ".openmausbot");
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere);
    const { code, said } = run([], home, { OMB_DATA_DIR: elsewhere });
    expect(code).toBe(1);
    expect(said).toContain(`The data folder in use is ${elsewhere} (OMB_DATA_DIR)`);
    expect(said).toContain(join(home, ".openmausbot"));
  });

  it("parse: an unknown argument, a missing path, and --backup with --no-backup are errors", () => {
    expect(parseMigrateDataArgs(["--yes"])).toMatchObject({ error: expect.stringMatching(/unknown argument/) });
    expect(parseMigrateDataArgs(["--to"])).toMatchObject({ error: expect.stringMatching(/needs a path/) });
    expect(parseMigrateDataArgs(["--backup", "a.tar.gz", "--no-backup"])).toMatchObject({ error: expect.stringMatching(/not both/) });
    expect(parseMigrateDataArgs(["--to", "x", "--backup", "y"])).toEqual({ to: expect.stringMatching(/x$/), backup: expect.stringMatching(/y$/), noBackup: false, help: false });
  });

  it("from the oldest name: moves the folder, and says that paths naming it were left as they are", () => {
    const { home, from, to } = homeWithLegacyData(".opengrokbot");
    const { code, said } = run([], home);
    expect(code).toBe(0);
    expect(existsSync(from)).toBe(false);
    expect(JSON.parse(readFileSync(join(to, "bots.json"), "utf8"))[0].soul).toContain(`${from}/bots/bot/SOUL.md`);
    expect(said).toMatch(/were left as they are/);
    expect(said).not.toMatch(/No path inside the data/);
  });

  it("--help prints how to run it", () => {
    const { code, said } = run(["--help"], aHome());
    expect(code).toBe(0);
    expect(said).toMatch(/openmausbot migrate-data/);
  });

  it("refuses symlinked source or dangling symlink at target", async () => {
    const { symlinkSync } = await import("node:fs");
    const home = aHome();
    const real = join(home, "real-data");
    mkdirSync(real);
    symlinkSync(real, join(home, ".openmausbot"));
    expect(migrateDataDir({ home, from: join(home, ".openmausbot"), env: {} })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/symbolic link/),
    });

    const home2 = aHome();
    mkdirSync(join(home2, ".openmausbot"));
    symlinkSync(join(home2, "missing-target"), join(home2, DATA_DIR_NAME));
    expect(migrateDataDir({ home: home2, from: join(home2, ".openmausbot"), env: {} })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already exists/),
    });
  });
});
