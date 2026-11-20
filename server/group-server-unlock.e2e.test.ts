// The A1 unlock pack on a shared self-hosted server (claudedocs/omb-group-chat-design.md): the people directory, the
// room's people roster and explicit audience, run ownership, presence (rooms only), per-person read marks — each from a
// member's session, the way a colleague on OMB_SIGNIN_MEMBER_EMAILS sees them.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const ADA = "ada@example.test";
const BOB = "bob@example.test";

let child: ChildProcess;
let home: string;
let log = "";
let holdFile = "";
const tokens: Record<string, string> = {};

const headers = (as?: string, json = true) => ({
  ...(json ? { "content-type": "application/json" } : {}),
  ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
});
const api = async (method: string, path: string, body?: unknown, as?: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: headers(as, body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

let port = 0;
async function start() {
  port = await freePortBlock([0, 1]);
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1),
      FAKE_ACP_HOLD_FILE: holdFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
    } catch {
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function waitFor<T>(read: () => Promise<T | null | undefined> | T | null | undefined, ms = 30_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** An open event stream, frames collected (hello dropped). */
function openStream(as: string) {
  const controller = new AbortController();
  const frames: any[] = [];
  let ready = false;
  void (async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: headers(as, false), signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const frame = JSON.parse(line.slice(6));
            if (frame.kind === "hello") ready = true;
            else if (frame.kind !== "ping") frames.push(frame);
          }
        }
      }
    } catch {
    }
  })();
  return { frames, waitReady: () => waitFor(() => (ready ? true : null), 10_000), close: () => controller.abort() };
}

const ids = { pub: "", pubThread: "", roomA: "", roomAThread: "", roomNarrow: "" };


const groupOf = async (groupId: string, as: string): Promise<any | undefined> => {
  const { body } = await api("GET", "/api/bots?messages=0", undefined, as);
  return (body.groups ?? []).find((group: any) => group.id === groupId);
};
const working = async (groupId: string) => Boolean((await groupOf(groupId, BOSS))?.working);

posixOnly("the A1 unlock pack on a shared self-hosted server", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-group-unlock-"));
    holdFile = join(home, "hold");
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB] },
      instances: { grok: { driver: "grokAgent", config: { cli: FAKE_CLI, fullAuto: false } } },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA, BOB]) tokens[email] = registry.issue({ label: `${email.split("@")[0]}'s laptop`, email, scopes: [...role(email)] }).token;
    registry.close();
    await start();

    const pub = await api("POST", "/api/bots", { name: "Front Desk Otter" }, BOSS);
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    expect((await api("PATCH", `/api/bots/${pub.body.bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" } }, BOSS)).status).toBe(200);
    ids.pub = pub.body.bot.id;
    ids.pubThread = pub.body.bot.threadId;
    const roomA = await api("POST", "/api/groups", { memberIds: [ids.pub], name: "Front desk",
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } } }, BOSS);
    expect(roomA.status, JSON.stringify(roomA.body)).toBe(201);
    ids.roomA = roomA.body.group.id;
    ids.roomAThread = roomA.body.group.threadId;
    const roomNarrow = await api("POST", "/api/groups", { memberIds: [ids.pub], name: "Small corner" }, BOSS);
    expect(roomNarrow.status).toBe(201);
    ids.roomNarrow = roomNarrow.body.group.id;
  }, 90_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  it("answers the people directory to a signed-in session alone, their own entry marked", async () => {
    const ada = (await api("GET", "/api/people", undefined, ADA)).body;
    expect(ada.people.map((one: any) => [one.email, one.role, one.name])).toEqual([
      [ADA, "member", "Ada"],
      [BOB, "member", "Bob"],
      [BOSS, "admin", "Boss"],
    ]);
    expect(ada.people.find((one: any) => one.email === ADA).you).toBe(true);
    const bob = (await api("GET", "/api/people", undefined, BOB)).body;
    expect(bob.people.find((one: any) => one.email === BOB).you).toBe(true);
    expect(bob.people.find((one: any) => one.email === ADA).you).toBeUndefined();
    // A caller that never signed in is told there is no directory.
    expect((await fetch(`http://127.0.0.1:${port}/api/people`)).status).toBe(404);
  });

  it("keeps the roster and the audience an admin's to set, and both clearable", async () => {
    expect((await api("PATCH", `/api/groups/${ids.roomA}`, { people: [BOB] }, ADA)).status).toBe(403);
    expect((await api("PATCH", `/api/groups/${ids.roomNarrow}`, { audience: "everyone" }, ADA)).status).toBe(403);
    expect((await api("PATCH", `/api/groups/${ids.roomA}`, { people: ["not an address"] }, BOSS)).status).toBe(400);
    expect((await api("PATCH", `/api/groups/${ids.roomA}`, { audience: { people: ["nope"] } }, BOSS)).status).toBe(400);
    const rostered = await api("PATCH", `/api/groups/${ids.roomA}`, { people: ["BOB@Example.test", " ada@example.test ", "ada@example.test"] }, BOSS);
    expect(rostered.status).toBe(200);
    expect(rostered.body.group.people).toEqual(["bob@example.test", "ada@example.test"]);
    const narrowed = await api("PATCH", `/api/groups/${ids.roomNarrow}`, { audience: { people: [BOB] } }, BOSS);
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.group.audience).toEqual({ people: [BOB] });
    // "everyone" clears the explicit audience.
    expect((await api("PATCH", `/api/groups/${ids.roomNarrow}`, { audience: "everyone" }, BOSS)).status).toBe(200);
    expect((await api("PATCH", `/api/groups/${ids.roomNarrow}`, { audience: { people: [BOB] } }, BOSS)).body.group.audience).toEqual({ people: [BOB] });
  });

  it("narrows a room by its explicit audience, and a member's copy carries the roster but never an audience", async () => {
    const ada = (await api("GET", "/api/bots?messages=0", undefined, ADA)).body;
    expect(ada.groups.map((group: any) => group.id)).toEqual([ids.roomA]);
    expect(JSON.stringify(ada)).not.toContain("Small corner");
    const bob = (await api("GET", "/api/bots?messages=0", undefined, BOB)).body;
    expect(bob.groups.map((group: any) => group.id).sort()).toEqual([ids.roomA, ids.roomNarrow].sort());
    const narrow = bob.groups.find((group: any) => group.id === ids.roomNarrow);
    expect("audience" in narrow).toBe(false);
    expect("audienceFloor" in narrow).toBe(false);
    const rostered = bob.groups.find((group: any) => group.id === ids.roomA);
    expect(rostered.people).toEqual(["bob@example.test", "ada@example.test"]);
    const boss = (await groupOf(ids.roomNarrow, BOSS));
    expect(boss.audience).toEqual({ people: [BOB] });
    // The boss sets Ada back inside the audience, and she sees the room again.
    expect((await api("PATCH", `/api/groups/${ids.roomNarrow}`, { audience: { people: [ADA, BOB] } }, BOSS)).status).toBe(200);
    expect((await api("GET", "/api/bots?messages=0", undefined, ADA)).body.groups.map((group: any) => group.id)).toContain(ids.roomNarrow);
    expect((await api("PATCH", `/api/groups/${ids.roomNarrow}`, { audience: { people: [BOB] } }, BOSS)).status).toBe(200);
  });

  it("tells a room who is reading it, and never tells anyone about a bot thread", async () => {
    const adaStream = openStream(ADA);
    await adaStream.waitReady();
    expect((await api("POST", "/api/presence/here", { tab: "t1", threadId: ids.roomAThread }, ADA)).status).toBe(200);
    // A room's list goes to the people on it, the receiver included.
    const frame = await waitFor(() => adaStream.frames.find((f: any) => f.kind === "thread.presence" && f.threadId === ids.roomAThread) ?? null);
    expect(frame?.people).toEqual([ADA]);
    // Ada's window on the bot's own chat is recorded as showing nothing at all.
    expect((await api("POST", "/api/presence/here", { tab: "t2", threadId: ids.pubThread }, ADA)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 2_000));
    expect(adaStream.frames.some((f: any) => f.kind === "thread.presence" && f.threadId === ids.pubThread), log.slice(-2_000)).toBe(false);
    expect(JSON.stringify(adaStream.frames)).not.toContain(ids.pubThread);
    // The directory's presence mark says Ada is here (her stream is open), without naming any conversation.
    const people = (await api("GET", "/api/people", undefined, BOB)).body;
    expect(people.people.find((one: any) => one.email === ADA).here).toBe(true);
    adaStream.close();
  });

  it("gives a room run its asker: another member's stop is refused and their line queues; the asker stops", async () => {
    writeFileSync(holdFile, "");
    expect((await api("POST", `/api/groups/${ids.roomA}/messages`, { text: "ada asks for the payroll sheet ADA-TURN" }, ADA)).status).toBe(202);
    expect(await waitFor(async () => ((await working(ids.roomA)) ? true : null))).toBe(true);

    const bobs = await api("POST", `/api/groups/${ids.roomA}/interrupt`, { stopId: "bobs-stop-000000001" }, BOB);
    expect(bobs.status).toBe(403);
    expect(bobs.body).toMatchObject({ code: "stop_not_yours" });
    expect(await working(ids.roomA)).toBe(true);

    const bobsLine = await api("POST", `/api/groups/${ids.roomA}/messages`, { text: "bob asks something BOB-QUEUED" }, BOB);
    expect(bobsLine.status).toBe(202);
    expect(bobsLine.body.queued, JSON.stringify(bobsLine.body)).toBe(true);

    const adas = await api("POST", `/api/groups/${ids.roomA}/interrupt`, { stopId: "adas-stop-000000001" }, ADA);
    expect(adas.status).toBe(200);

    // Bob's line runs as its own turn once the room is free, and answers him.
    rmSync(holdFile);
    const bobReply = await waitFor(async () => {
      const { body } = await api("GET", `/api/threads/${ids.roomAThread}/messages`, undefined, BOSS);
      const messages = (body.messages ?? []) as Array<{ role: string; text?: string; sender?: { name?: string } }>;
      const asked = messages.findIndex((m) => m.role === "user" && m.text?.includes("BOB-QUEUED"));
      return asked >= 0 && messages.slice(asked + 1).some((m) => m.role === "bot" && m.text) ? messages : null;
    }, 60_000);
    expect(bobReply, log.slice(-3_000)).not.toBeNull();
    expect(bobReply!.find((m) => m.role === "user" && m.text?.includes("BOB-QUEUED"))?.sender?.name).toBe("Bob");
  }, 120_000);

  it("marks each person's read line their own", async () => {
    expect((await api("POST", `/api/groups/${ids.roomA}/read`, {}, ADA)).status).toBe(200);
    const adas = await groupOf(ids.roomA, ADA);
    const bobs = await groupOf(ids.roomA, BOB);
    // Ada read to the room's newest line; Bob's copy carries no read line of anyone else's.
    expect(adas.lastReadMessageId).toBeTruthy();
    expect(bobs.lastReadMessageId).toBeUndefined();
    expect(adas.unread).toBe(false);
    // The roster's read marks reach the wire: Ada has read the room's lines, her email never on her own copy.
    expect(adas.peopleReads).toBeUndefined();
    const adaLines = Object.entries(bobs.peopleReads ?? {}).filter(([, who]: [string, any]) => who.includes(ADA));
    expect(adaLines.length, JSON.stringify(bobs.peopleReads)).toBeGreaterThan(0);
    for (const [, who] of adaLines) expect(who).not.toContain(BOB);
    expect(bobs.peopleReads![adas.lastReadMessageId]).toContain(ADA);
  });
});
