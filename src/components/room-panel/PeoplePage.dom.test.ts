// @vitest-environment happy-dom
// The room's People page in a real DOM: the roster the server sends, what an admin may change about it, what a
// member only sees, and the read-only folder boundary a bot carries into the room.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { setTeamPeople, type TeamPeople } from "@/state/team-people";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: original.initialState, dispatch: fixture.dispatch }),
  };
});
vi.mock("../Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));

const { PeoplePage, botFolderLabel, rosterOf } = await import("./PeoplePage");

const ada = { email: "ada@acme.test", name: "Ada", role: "admin", you: true as const };
const directory: TeamPeople = {
  people: [ada, { email: "ben@acme.test", name: "Ben", role: "member" }, { email: "guy@acme.test", name: "Guy", role: "admin" }],
  me: ada,
  admin: true,
  needsYou: [],
  presence: true,
};

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "Runner", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "m" },
  ...extra,
});
const group = (patch: Partial<Group> = {}): Group => ({
  id: "desk", threadId: "desk-thread", name: "Desk HQ", memberIds: ["scout"],
  defaultResponder: { kind: "member", botId: "scout" }, bulletin: "", unread: false, createdAt: 1,
  setupCompletedAt: 1, messages: [], people: ["ben@acme.test", "gone@acme.test"], ...patch,
});

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const render = async (pageGroup: Group, members: Bot[]) => {
  flushSync(() => root.render(createElement(PeoplePage, { group: pageGroup, members })));
  await settle();
};
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string) => [...document.querySelectorAll<T & HTMLElement>(selector)];
const click = (element: Element | null | undefined) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
};
const patches = () => fixture.dispatch.mock.calls.map(([action]) => action).filter((action) => action.type === "patchGroup");

beforeEach(() => {
  setLocale("en");
  fixture.dispatch.mockReset();
  setTeamPeople(directory);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  setTeamPeople(null);
});

describe("PeoplePage", () => {
  it("names the roster's people from the directory, and addresses the roster left behind when one is gone", async () => {
    await render(group(), [bot("scout", "Scout")]);
    const ben = $('[data-room-person="ben@acme.test"]');
    expect(ben?.textContent).toContain("Ben");
    expect(ben?.textContent).toContain("ben@acme.test");
    // A roster email the directory no longer knows still shows, named from its address.
    expect($('[data-room-person="gone@acme.test"]')?.textContent).toContain("Gone");
  });

  it("marks admins and the viewer, and shows who is here now", async () => {
    const here = { ...directory, people: directory.people.map((entry, index) => index === 1 ? { ...entry, here: true } : entry) };
    setTeamPeople(here);
    await render(group({ people: ["ben@acme.test", "guy@acme.test", "ada@acme.test"] }), []);
    expect($('[data-room-person="guy@acme.test"]')?.textContent).toContain("Admin");
    expect($('[data-room-person="ben@acme.test"]')?.textContent).not.toContain("Admin");
    expect($('[data-room-person="ada@acme.test"]')?.textContent).toContain("you");
    expect($$("[data-here-dot]").length).toBe(1); // Ben is here
  });

  it("lets an admin remove a person and add people from the directory", async () => {
    await render(group(), []);
    click($('[data-room-person-remove="ben@acme.test"]'));
    expect(patches()[0]).toMatchObject({ groupId: "desk", patch: { people: ["gone@acme.test"] } });
    click($('[data-room-people-option="guy@acme.test"]'));
    click($("[data-room-people-save]"));
    expect(patches()[1]).toMatchObject({ groupId: "desk", patch: { people: ["ben@acme.test", "gone@acme.test", "guy@acme.test"] } });
  });

  it("gives a member no way to change the roster, and no people card at all when the room has none", async () => {
    setTeamPeople({ ...directory, admin: false });
    await render(group(), []);
    expect($("[data-room-people-add]")).toBeNull();
    expect($('[data-room-person-remove="ben@acme.test"]')).toBeNull();
    await render(group({ people: undefined }), []);
    expect($('[data-room-person="ben@acme.test"]')).toBeNull();
    expect(document.body.textContent).not.toContain("No people in this room yet.");
  });

  it("tells an admin an empty room is empty; with nobody signed in, the add block says so", async () => {
    await render(group({ people: undefined }), []);
    expect(document.body.textContent).toContain("No people in this room yet.");
    expect($$("[data-room-people-option]").length).toBe(3);
    setTeamPeople({ ...directory, people: [] });
    await render(group({ people: undefined }), []);
    expect(document.body.textContent).toContain("No one signed in yet.");
    expect($("[data-room-people-save]")).toBeNull();
  });

  it("reads a bot's folder boundary as a value, and an unrestricted bot's job title instead", async () => {
    await render(group(), [
      bot("scout", "Scout", { dirAccess: { mode: "workspace" } }),
      bot("open", "Opens", { dirAccess: { mode: "open" } }),
    ]);
    const scout = $('[data-room-bot="scout"]');
    expect(scout?.textContent).toContain("Directory write access");
    expect(scout?.textContent).toContain("Own folders only");
    const open = $('[data-room-bot="open"]');
    expect(open?.textContent).toContain("Runner");
    expect(open?.textContent).not.toContain("Folder access");
  });

  it("needs at least one bot, said once, when the room somehow has none", async () => {
    await render(group(), []);
    expect(document.body.textContent).toContain("A group needs at least one bot.");
  });
});

describe("PeoplePage helpers", () => {
  it("labels only the restricted folder policies", () => {
    expect(botFolderLabel(bot("a", "A", { dirAccess: { mode: "workspace" } }))).toContain("Directory write access");
    expect(botFolderLabel(bot("a", "A", { dirAccess: { mode: "custom", extraDirs: ["/srv"] } }))).toBeTruthy();
    expect(botFolderLabel(bot("a", "A", { dirAccess: { mode: "open" } }))).toBeNull();
    expect(botFolderLabel(bot("a", "A"))).toBeNull();
  });

  it("falls back to the address's own name for roster entries the directory has lost", () => {
    expect(rosterOf({ people: ["jay@acme.test"] }, []).map((entry) => entry.name)).toEqual(["Jay"]);
    expect(rosterOf({}, [])).toEqual([]);
  });
});
