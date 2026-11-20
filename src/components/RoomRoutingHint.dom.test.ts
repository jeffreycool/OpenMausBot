// @vitest-environment happy-dom
// The room composer's routing line: it names who an @-tag reaches, refuses a shared name until a pick is made,
// carries the [local] tag as "runs on this computer", and stays out of the way otherwise.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot, Group } from "@/state/store";

vi.mock("./Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));

const { RoomRoutingHint, draftRunsLocal } = await import("./RoomRoutingHint");

const bot = (id: string, name: string): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "m" },
});
const scout = bot("s1", "Scout");
const rex = bot("r1", "Rex");
const twin = bot("s2", "Scout");
const group = (patch: Partial<Group> = {}): Group => ({
  id: "desk", threadId: "desk-thread", name: "Desk HQ", memberIds: [scout.id, rex.id],
  defaultResponder: { kind: "member", botId: scout.id }, bulletin: "", unread: false, createdAt: 1,
  setupCompletedAt: 1, messages: [], ...patch,
});

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const render = async (props: Parameters<typeof RoomRoutingHint>[0]) => {
  flushSync(() => root.render(createElement(RoomRoutingHint, props)));
  await settle();
};
const hint = () => document.querySelector<HTMLElement>("[data-routing-hint]");

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("RoomRoutingHint", () => {
  it("names who an explicit @-tag reaches", async () => {
    await render({ group: group(), members: [scout, rex], text: "@Scout check the logs", draftId: "d1" });
    expect(hint()?.getAttribute("data-routing-hint")).toBe("responders");
    expect(hint()?.textContent).toContain("Scout will answer");
  });

  it("says nothing while the default responder answers, then names everyone @everyone reaches", async () => {
    const room = group();
    await render({ group: room, members: [scout, rex], text: "no tags here", draftId: "d2" });
    expect(hint()).toBeNull();
    await render({ group: room, members: [scout, rex], text: "plain line", draftId: "d3" });
    expect(hint()).toBeNull();
    await render({ group: room, members: [scout, rex], text: "@everyone standup in five", draftId: "d4" });
    expect(hint()?.getAttribute("data-routing-hint")).toBe("responders");
    expect(hint()?.textContent).toContain("Scout and Rex will answer");
  });

  it("refuses a shared name until the @ list picks one", async () => {
    await render({ group: group({ memberIds: [scout.id, twin.id] }), members: [scout, twin], text: "@Scout go", draftId: "d5" });
    expect(hint()?.getAttribute("data-routing-hint")).toBe("ambiguous");
    expect(hint()?.textContent).toContain("share a name");
  });

  it("carries the [local] tag as a run-here note, alone or with an @-tag", async () => {
    await render({ group: group(), members: [scout, rex], text: "fix it [local]", draftId: "d6" });
    expect(hint()?.getAttribute("data-routing-hint")).toBe("local");
    expect(hint()?.textContent).toContain("Runs on this computer");
    await render({ group: group(), members: [scout, rex], text: "@Rex fix it [local]", draftId: "d7" });
    expect(hint()?.textContent).toContain("Rex will answer");
    expect(hint()?.textContent).toContain("Runs on this computer");
  });

  it("treats a person's tag as no route at all", async () => {
    const { setTeamPeople } = await import("@/state/team-people");
    setTeamPeople({
      people: [{ email: "ada@acme.test", name: "Ada", role: "member", you: true as const }],
      me: { email: "ada@acme.test", name: "Ada", role: "member", you: true as const },
      admin: false, needsYou: [], presence: false,
    });
    await render({ group: group(), members: [scout, rex], text: "@Ada can you look?", draftId: "d8" });
    expect(hint()).toBeNull();
    setTeamPeople(null);
  });

  it("stays out of direct bot channels and empty drafts", async () => {
    await render({ group: group({ dm: true }), members: [scout, rex], text: "@Scout [local] go", draftId: "d9" });
    expect(hint()).toBeNull();
    await render({ group: group(), members: [scout, rex], text: "   ", draftId: "d10" });
    expect(hint()).toBeNull();
    await render({ group: undefined, members: [scout], text: "@Scout [local]", draftId: "d11" });
    expect(hint()).toBeNull();
  });

  it("reads the [local] tag case-insensitively", () => {
    expect(draftRunsLocal("do it [LOCAL] now")).toBe(true);
    expect(draftRunsLocal("do it now")).toBe(false);
  });
});
