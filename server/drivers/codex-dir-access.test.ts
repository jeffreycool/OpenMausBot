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

  const create = async (environment: Record<string, string> = {}) => {
    instance = await CodexDriver.create({
      instanceId: "codex-dir-access-test",
      displayName: "Codex Dir Access Test",
      environment: { HOME: scratch, CODEX_HOME: join(scratch, ".codex"), ...environment },
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
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

  it("accepts a report without any roots (an older codex derives its own list) and one whose root is the requested path through a link", async () => {
    mkdirSync(join(scratch, "linked"), { recursive: true });
    const requested = join(scratch, "linked");
    await create({ FAKE_CODEX_RESOLVED_SANDBOX: JSON.stringify({ type: "workspaceWrite", writableRoots: [realpathSync(requested)] }) });
    await instance.adapter.sendTurn({ threadId: "t-root-link", text: "Fixture", approvalMode: "ask", writableDirs: [requested] });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.at(-1)).toMatchObject({ ok: true });
    await create({ FAKE_CODEX_RESOLVED_SANDBOX: JSON.stringify({ type: "workspaceWrite", writableRoots: [] }) });
    await instance.adapter.sendTurn({ threadId: "t-root-quiet", text: "Fixture", approvalMode: "ask", writableDirs: [join(scratch, "workspaces", "bot-a")] });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.at(-1)).toMatchObject({ ok: true });
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
});
