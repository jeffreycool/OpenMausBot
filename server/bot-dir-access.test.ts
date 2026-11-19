import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { dirAccessWidens, resolveWritableDirs, validateBotDirAccessInput, type BotDirAccess } from "./bot-dir-access.ts";
import { workspaceLocationsPrompt } from "./workspace.ts";
import { removeTempDir } from "./testing/cleanup.ts";

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "omb-dir-access-"));
});

afterEach(() => {
  removeTempDir(scratch);
});

describe("validateBotDirAccessInput", () => {
  it("clears on null and passes an empty policy through", () => {
    expect(validateBotDirAccessInput(null)).toEqual({ ok: true, dirAccess: undefined });
    expect(validateBotDirAccessInput({ mode: "workspace" })).toEqual({ ok: true, dirAccess: { mode: "workspace" } });
    expect(validateBotDirAccessInput({ mode: "open" })).toEqual({ ok: true, dirAccess: { mode: "open" } });
  });

  it("rejects shapes the schema refuses: unknown keys, wrong modes, oversized lists", () => {
    for (const bad of [
      "workspace", { mode: "everywhere" }, { mode: "workspace", stub: true }, { extraDirs: [] },
      { mode: "custom", extraDirs: "..." }, { mode: "custom", extraDirs: Array.from({ length: 21 }, () => "/tmp") },
      { mode: "custom", extraDirs: ["x".repeat(4097)] },
    ] as const) {
      expect(validateBotDirAccessInput(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("expands ~, requires absolute existing folders, and real-paths duplicates away", () => {
    const inside = join(scratch, "shared");
    mkdirSync(inside);
    const checked = validateBotDirAccessInput({ mode: "custom", extraDirs: [inside, inside, "~"] });
    expect(checked.ok).toBe(true);
    if (checked.ok && checked.dirAccess?.extraDirs) {
      expect(checked.dirAccess.extraDirs).toEqual([inside, homedir()]);
    }
    expect(validateBotDirAccessInput({ mode: "custom", extraDirs: ["relative/path"] })).toMatchObject({ ok: false });
    expect(validateBotDirAccessInput({ mode: "custom", extraDirs: [join(scratch, "missing")] })).toMatchObject({ ok: false });
    expect(validateBotDirAccessInput({ mode: "custom", extraDirs: ["~/nonexistent-folder-for-tests"] })).toMatchObject({ ok: false });
    const file = join(scratch, "plain.txt");
    writeFileSync(file, "not a folder");
    expect(validateBotDirAccessInput({ mode: "custom", extraDirs: [file] })).toMatchObject({ ok: false });
  });
});

describe("resolveWritableDirs", () => {
  it("answers null for an absent or open policy, whatever the turn", () => {
    expect(resolveWritableDirs({ id: "b1" }, undefined, DATA_DIR)).toBeNull();
    expect(resolveWritableDirs({ id: "b1", dirAccess: { mode: "open" } }, join(scratch, "room"), DATA_DIR)).toBeNull();
  });

  it("confines a workspace bot to its two folder roots plus the conversation's folder", () => {
    const turn = join(scratch, "task-workspaces", "b2", "t1");
    expect(resolveWritableDirs({ id: "b2", dirAccess: { mode: "workspace" } }, turn, DATA_DIR)).toEqual([
      join(DATA_DIR, "workspaces", "b2"),
      join(DATA_DIR, "task-workspaces", "b2"),
      turn,
    ]);
    expect(resolveWritableDirs({ id: "b2", dirAccess: { mode: "workspace" } }, undefined, DATA_DIR)).toEqual([
      join(DATA_DIR, "workspaces", "b2"),
      join(DATA_DIR, "task-workspaces", "b2"),
    ]);
  });

  it("adds the allowlist for a custom bot, real-pathed and deduplicated", () => {
    mkdirSync(join(scratch, "real"));
    const real = realpathSync(join(scratch, "real"));
    const link = join(scratch, "link");
    symlinkSync(real, link, "dir");
    const dirs = resolveWritableDirs(
      { id: "b3", dirAccess: { mode: "custom", extraDirs: [link, join(DATA_DIR, "workspaces", "b3")] } },
      join(DATA_DIR, "task-workspaces", "b3", "t1"),
      DATA_DIR,
    );
    expect(dirs).toEqual([
      join(DATA_DIR, "workspaces", "b3"),
      join(DATA_DIR, "task-workspaces", "b3"),
      join(DATA_DIR, "task-workspaces", "b3", "t1"),
      real,
    ]);
  });
});

describe("dirAccessWidens", () => {
  const access = (mode: BotDirAccess["mode"], extraDirs?: string[]): BotDirAccess => ({ mode, extraDirs });

  it("treats an absent policy as unrestricted, so any first restriction is a tightening", () => {
    expect(dirAccessWidens(undefined, access("workspace"))).toBe(false);
    expect(dirAccessWidens(undefined, access("custom", ["/tmp"]))).toBe(false);
    expect(dirAccessWidens(access("open"), access("workspace"))).toBe(false);
    // clearing the policy (undefined after) is the widest state
    expect(dirAccessWidens(access("workspace"), undefined)).toBe(true);
  });

  it("flags rank growth and allowlist growth, not narrowing", () => {
    expect(dirAccessWidens(access("workspace"), access("custom", ["/tmp"]))).toBe(true);
    expect(dirAccessWidens(access("custom", ["/tmp"]), access("open"))).toBe(true);
    expect(dirAccessWidens(access("custom", ["/tmp"]), access("custom", ["/tmp", "/srv"]))).toBe(true);
    expect(dirAccessWidens(access("custom", ["/tmp", "/srv"]), access("custom", ["/srv"]))).toBe(false);
    expect(dirAccessWidens(access("custom", ["/srv"]), access("workspace"))).toBe(false);
    expect(dirAccessWidens(access("open"), access("open"))).toBe(false);
  });
});

describe("workspaceLocationsPrompt", () => {
  it("states the write boundary only when a turn is restricted, naming the allowed folders", () => {
    const unrestricted = workspaceLocationsPrompt("b4", "/somewhere/thread");
    expect(unrestricted).not.toContain("Write boundary");
    const dirs = [join(DATA_DIR, "workspaces", "b4"), join(DATA_DIR, "task-workspaces", "b4")];
    const restricted = workspaceLocationsPrompt("b4", "/somewhere/thread", undefined, { writableDirs: dirs });
    expect(restricted).toContain("Write boundary");
    expect(restricted).toContain(JSON.stringify(dirs));
    expect(restricted).toContain("must be refused");
  });
});
