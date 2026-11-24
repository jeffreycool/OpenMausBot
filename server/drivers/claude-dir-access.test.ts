import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { ClaudeDriver } from "./claude.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-claude-cli.ts");

describe("ClaudeDriver directory allowlist (fake CLI)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  const create = async (config: { permissionMode?: "acceptEdits" | "bypassPermissions" } = {}, environment: Record<string, string> = {}) => {
    instance = await ClaudeDriver.create({
      instanceId: "claude-dir-access-test",
      displayName: "Claude Dir Access Test",
      environment,
      enabled: true,
      config: { cli: FAKE_CLI, permissionMode: config.permissionMode ?? "acceptEdits" },
    });
    recorder = recordEvents(instance.adapter);
  };

  const botFolders = (name: string, settings: unknown) => {
    const bot = join(scratch, `${name}-bot`), thread = join(scratch, `${name}-thread`);
    mkdirSync(join(bot, ".claude"), { recursive: true });
    mkdirSync(thread);
    const file = join(bot, ".claude", "settings.json");
    writeFileSync(file, JSON.stringify(settings));
    return { bot, thread, file };
  };

  beforeEach(() => {
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-claude-dir-access-"));
  });

  afterEach(() => {
    removeTempDir(scratch);
    delete process.env.FAKE_CLAUDE_DUMP;
    delete process.env.FAKE_CLAUDE_MODE;
  });

  it("caps Full at acceptEdits and passes the allowlist as --add-dir directories", async () => {
    await create({ permissionMode: "bypassPermissions" });
    const dump = join(scratch, "full-capped.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const roots = [join(scratch, "workspaces", "bot-a"), join(scratch, "task-workspaces", "bot-a")];
    await instance.adapter.sendTurn({ threadId: "t-full-capped", text: "go", approvalMode: "full", writableDirs: roots });
    await recorder.until((e) => e.type === "turn.completed");
    const { argv, settings } = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; settings: Record<string, unknown> };
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(argv.filter((arg) => arg === "--add-dir")).toHaveLength(roots.length);
    for (const root of roots) expect(argv[argv.indexOf(root) - 1]).toBe("--add-dir");
    expect((settings.permissions as Record<string, unknown>).additionalDirectories).toEqual(roots);
  });

  it("carries the roots in the settings file and keeps a Full turn unrestricted without them", async () => {
    await create({ permissionMode: "bypassPermissions" });
    const dump = join(scratch, "full-open.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-full-open", text: "go", approvalMode: "full" });
    await recorder.until((e) => e.type === "turn.completed");
    const { argv } = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[] };
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(argv).not.toContain("--add-dir");
  });

  it("drops the bot settings' file-write allows and outside additionalDirectories, keeping the rest", async () => {
    await create();
    const dump = join(scratch, "bot-settings-confined.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const roots = [join(scratch, "workspaces", "bot-a")];
    const { thread, file } = botFolders("confined", {
      permissions: {
        allow: ["Edit", "Write(/etc/**)", "WebFetch(domain:docs.example)", "Grep"],
        additionalDirectories: [join(scratch, "outside"), roots[0]],
        deny: ["Read(./.env)"],
      },
    });
    await instance.adapter.sendTurn({ threadId: "t-bot-settings-confined", text: "hi", cwd: thread, botSettingsFile: file, writableDirs: roots });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; settings: { permissions: Record<string, unknown> } };
    expect(seen.settings.permissions.allow).toEqual(["WebFetch(domain:docs.example)", "Grep"]);
    expect(seen.settings.permissions.additionalDirectories).toEqual(roots);
    expect(seen.settings.permissions.deny).toEqual(["Read(./.env)"]);
    expect(seen.argv.filter((arg) => arg === "--add-dir")).toHaveLength(1);
  });

  it("leaves a guest turn's permissions alone even when the bot has an allowlist", async () => {
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.284" });
    const dump = join(scratch, "guest-roots.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const roots = [join(scratch, "workspaces", "bot-a")];
    await instance.adapter.sendTurn({ threadId: "t-guest-roots", text: "hi", approvalMode: "ask", guestConfined: true, writableDirs: roots });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; settings: { permissions?: Record<string, unknown> } };
    expect(seen.argv).not.toContain("--add-dir");
    expect(seen.settings.permissions?.deny).toEqual(["Bash", "PowerShell", "WebFetch", "Read(//proc/**)"]);
    expect(seen.settings.permissions?.additionalDirectories).toBeUndefined();
  });

  it("strips Bash/* allows, resolves relative additionalDirectories against cwd, and disables --setting-sources project when confined", async () => {
    await create();
    const dump = join(scratch, "confined-shell-and-project.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const roots = [join(scratch, "workspaces", "bot-a")];
    mkdirSync(roots[0]!, { recursive: true });
    const { thread, file } = botFolders("shell-confined", {
      permissions: {
        allow: ["Bash", "Bash(rm *)", "*", "PowerShell", "Grep"],
        ask: ["Bash", "WebFetch"],
        additionalDirectories: ["../workspaces/bot-a", "../outside"],
      },
    });
    // Plant a project .claude/settings.json inside thread cwd with Bash allow that must also be filtered, not auto-loaded by CLI.
    mkdirSync(join(thread, ".claude"), { recursive: true });
    writeFileSync(join(thread, ".claude", "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash", "WebFetch(domain:safe.example)"] },
    }));
    await instance.adapter.sendTurn({ threadId: "t-confined-shell", text: "hi", cwd: thread, botSettingsFile: file, writableDirs: roots });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; settings: { permissions: Record<string, unknown> } };
    const ssIdx = seen.argv.indexOf("--setting-sources");
    expect(ssIdx).toBeGreaterThan(-1);
    expect(seen.argv[ssIdx + 1]).toBe("");
    expect(seen.settings.permissions.allow).toEqual(["Grep", "WebFetch(domain:safe.example)"]);
    expect(seen.settings.permissions.ask).toEqual(["WebFetch"]);
    expect(seen.settings.permissions.additionalDirectories).toEqual(["../workspaces/bot-a", ...roots]);
  });
});
