import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { CodexDriver } from "./codex.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-codex-app-server.ts");

describe("CodexDriver directory allowlist (fake app-server)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  const create = async (environment: Record<string, string> = {}, cli = FAKE_CLI) => {
    instance = await CodexDriver.create({
      instanceId: "codex-dir-access-test",
      displayName: "Codex Dir Access Test",
      environment: { HOME: scratch, CODEX_HOME: join(scratch, ".codex"), ...environment },
      enabled: true,
      config: { cli, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-codex-dir-access-"));
  });

  afterEach(() => {
    removeTempDir(scratch);
    delete process.env.FAKE_CODEX_DUMP;
    delete process.env.FAKE_CODEX_RESOLVED_SANDBOX;
    delete process.env.FAKE_CODEX_MODE;
  });

  const callsFrom = (dump: string): Array<{ method: string; params: Record<string, unknown> }> =>
    (JSON.parse(readFileSync(dump, "utf8")).calls as Array<{ method: string; params: Record<string, unknown> }>);

  it("sends the allowlist as the workspace-write sandbox's writableRoots on thread/start and turn/start", async () => {
    const roots = [join(scratch, "workspaces", "bot-a"), join(scratch, "task-workspaces", "bot-a"), join(scratch, "room")];
    await create({ FAKE_CODEX_RESOLVED_SANDBOX: JSON.stringify({ type: "workspaceWrite", writableRoots: roots }) });
    const dump = join(scratch, "roots.json");
    process.env.FAKE_CODEX_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-roots", text: "Fixture", approvalMode: "ask", writableDirs: roots });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.at(-1)).toMatchObject({ ok: true });
    const calls = callsFrom(dump);
    expect(calls.find((call) => call.method === "thread/start")?.params).toMatchObject({ sandbox: "workspace-write" });
    expect(calls.find((call) => call.method === "turn/start")?.params.sandboxPolicy).toEqual({ type: "workspaceWrite", writableRoots: roots });
  });

  it("caps Full access at the workspace-write sandbox when a turn is restricted", async () => {
    const roots = [join(scratch, "workspaces", "bot-a")];
    await create({ FAKE_CODEX_RESOLVED_SANDBOX: JSON.stringify({ type: "workspaceWrite", writableRoots: roots }) });
    const dump = join(scratch, "full-capped.json");
    process.env.FAKE_CODEX_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-full-capped", text: "Fixture", approvalMode: "full", writableDirs: roots });
    await recorder.until((event) => event.type === "turn.completed");
    const calls = callsFrom(dump);
    expect(calls.find((call) => call.method === "thread/start")?.params).toMatchObject({
      approvalPolicy: "never",
      sandbox: "workspace-write",
    });
    expect(calls.find((call) => call.method === "turn/start")?.params.sandboxPolicy).toEqual({
      type: "workspaceWrite", writableRoots: roots,
    });
  });

  it("refuses to start when codex reports back without a requested root", async () => {
    await create({ FAKE_CODEX_RESOLVED_SANDBOX: JSON.stringify({ type: "workspaceWrite", writableRoots: [join(scratch, "somewhere-else")] }) });
    await instance.adapter.sendTurn({
      threadId: "t-root-missing", text: "Fixture", approvalMode: "ask",
      writableDirs: [join(scratch, "workspaces", "bot-a")],
    });
    await recorder.until((event) => event.type === "turn.completed");
    const refused = recorder.events.find((event) => event.type === "runtime.error") as { message: string } | undefined;
    expect(refused?.message).toContain("writable directories");
  });

  it("accepts containment echoes: the implicit-only answer codex-cli 0.169.0 really sends, a folded parent covering a nested request, and a link-resolved root; refuses a root beyond the request", async () => {
    const parent = join(scratch, "task-workspaces", "bot-a");
    const nested = join(parent, "thread-1");
    const requested = [join(scratch, "workspaces", "bot-a"), parent, nested];

    // The shape probed on real codex-cli 0.169.0 (native log fe285694): the echo carries only the implicit
    // set, /private-normalized — none of the requested roots appear, yet the turn must start.
    await create({ FAKE_CODEX_RESOLVED_SANDBOX: JSON.stringify({ type: "workspaceWrite", writableRoots: ["/private/tmp", `/private${tmpdir()}`] }) });
    await instance.adapter.sendTurn({ threadId: "t-implicit-echo", text: "Fixture", approvalMode: "ask", writableDirs: requested });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.at(-1)).toMatchObject({ ok: true });

    // The nested request folded into its covering parent, which is itself requested.
    await create({ FAKE_CODEX_RESOLVED_SANDBOX: JSON.stringify({ type: "workspaceWrite", writableRoots: [join(scratch, "workspaces", "bot-a"), parent] }) });
    await instance.adapter.sendTurn({ threadId: "t-folded", text: "Fixture", approvalMode: "ask", writableDirs: requested });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.at(-1)).toMatchObject({ ok: true });

    // A requested root reported through a link still matches.
    mkdirSync(join(scratch, "linked"), { recursive: true });
    const linked = join(scratch, "linked");
    await create({ FAKE_CODEX_RESOLVED_SANDBOX: JSON.stringify({ type: "workspaceWrite", writableRoots: [realpathSync(linked)] }) });
    await instance.adapter.sendTurn({ threadId: "t-root-link", text: "Fixture", approvalMode: "ask", writableDirs: [linked] });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.at(-1)).toMatchObject({ ok: true });

    await create({ FAKE_CODEX_RESOLVED_SANDBOX: JSON.stringify({ type: "workspaceWrite", writableRoots: [] }) });
    await instance.adapter.sendTurn({ threadId: "t-root-quiet", text: "Fixture", approvalMode: "ask", writableDirs: [join(scratch, "workspaces", "bot-a")] });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.at(-1)).toMatchObject({ ok: true });

    // A reported root neither implicit nor explained by the request: codex granted beyond the allowlist.
    await create({ FAKE_CODEX_RESOLVED_SANDBOX: JSON.stringify({ type: "workspaceWrite", writableRoots: ["/private/tmp", join(scratch, "somewhere-else")] }) });
    await instance.adapter.sendTurn({ threadId: "t-beyond", text: "Fixture", approvalMode: "ask", writableDirs: requested });
    await recorder.until((event) => event.type === "turn.completed");
    const refused = recorder.events.find((event) => event.type === "runtime.error") as { message: string } | undefined;
    expect(refused?.message).toContain("beyond this turn's allowlist");
  });

  it("leaves an unrestricted Full turn at danger-full-access", async () => {
    await create();
    const dump = join(scratch, "full-open.json");
    process.env.FAKE_CODEX_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-full-open", text: "Fixture", approvalMode: "full" });
    await recorder.until((event) => event.type === "turn.completed");
    const calls = callsFrom(dump);
    expect(calls.find((call) => call.method === "thread/start")?.params.sandbox).toBe("danger-full-access");
    expect(calls.find((call) => call.method === "turn/start")?.params.sandboxPolicy).toEqual({ type: "dangerFullAccess" });
  });

  // codex-cli 0.169.0 runs a CLI preset's argv sandbox over the thread/turn sandboxPolicy, so a restricted
  // turn relaunches the whole app-server workspace-write with the roots in config (probed on the real CLI:
  // a $HOME write is then refused, an allowlisted root and the workspace write).
  it("relaunches a danger-full-access preset workspace-write with the roots in config when restricted, and leaves the preset alone otherwise", async () => {
    const roots = [join(scratch, "workspaces", "bot-a"), join(scratch, "task-workspaces", "bot-a")];
    const preset = `${FAKE_CLI} --sandbox danger-full-access --ask-for-approval never`;
    const dump = join(scratch, "argv-capped.json");
    process.env.FAKE_CODEX_DUMP = dump;
    await create({}, preset);
    await instance.adapter.sendTurn({ threadId: "t-argv-capped", text: "Fixture", approvalMode: "full", writableDirs: roots });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.at(-1)).toMatchObject({ ok: true });
    const { argv } = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[] };
    expect(argv).not.toContain("danger-full-access");
    // -c overrides ride after `app-server` (the TUI-level --sandbox flag is a no-op there) and beat
    // the machine's config.toml sandbox_mode.
    const appServerAt = argv.indexOf("app-server");
    expect(appServerAt).toBeGreaterThan(-1);
    const modeAt = argv.indexOf('sandbox_mode="workspace-write"', appServerAt);
    expect(modeAt).toBeGreaterThan(appServerAt);
    expect(argv[modeAt - 1]).toBe("-c");
    const rootsArg = argv.find((arg) => arg.includes("sandbox_workspace_write.writable_roots="));
    expect(JSON.parse(rootsArg!.slice(rootsArg!.indexOf("sandbox_workspace_write.writable_roots=") + "sandbox_workspace_write.writable_roots=".length))).toEqual(roots);

    const openDump = join(scratch, "argv-open.json");
    process.env.FAKE_CODEX_DUMP = openDump;
    const openTurn = await instance.adapter.sendTurn({ threadId: "t-argv-open", text: "Fixture", approvalMode: "full" });
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === openTurn.turnId, 30_000);
    expect(recorder.events.at(-1)).toMatchObject({ ok: true });
    const open = JSON.parse(readFileSync(openDump, "utf8")) as { argv: string[] };
    expect(open.argv).toContain("danger-full-access");
    expect(open.argv.some((arg) => arg.includes("sandbox_workspace_write.writable_roots=") || arg.includes('sandbox_mode="workspace-write"'))).toBe(false);
  }, 45_000);
});
