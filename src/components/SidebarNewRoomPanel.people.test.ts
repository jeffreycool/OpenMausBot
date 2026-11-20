// @vitest-environment happy-dom
// New channel's optional people step: with a people directory the panel offers faces to start the room with, and
// the create call carries them; without one the step is simply not there.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { setTeamPeople, type TeamPeople } from "@/state/team-people";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: { ...original.initialState, bots: [bot] }, dispatch: fixture.dispatch }),
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));

const { NewRoomPanel } = await import("./SidebarNewRoomPanel");

const bot: Bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "claude", model: "fake" },
};
const directory: TeamPeople = {
  people: [
    { email: "ada@acme.test", name: "Ada", role: "member", you: true as const },
    { email: "ben@acme.test", name: "Ben", role: "member" },
  ],
  me: { email: "ada@acme.test", name: "Ada", role: "member", you: true as const },
  admin: false, needsYou: [], presence: false,
};

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const open = async () => {
  flushSync(() => root.render(createElement(NewRoomPanel, { onClose: vi.fn() })));
  await settle();
};
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);
const click = (element: Element | null | undefined) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
};
const createButton = () => [...document.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Create group chat"));
const creates = () => fixture.dispatch.mock.calls.map(([action]) => action).filter((action) => action.type === "createGroup");

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

describe("New channel's people step", () => {
  it("offers the directory's other people as faces and starts the room with the picked ones", async () => {
    await open();
    expect($("[data-new-room-people]")).not.toBeNull();
    click($('[role="checkbox"][aria-label="Scout"]'));
    click($('[data-new-room-person="ben@acme.test"]'));
    click(createButton());
    expect(creates()[0]).toMatchObject({ type: "createGroup", memberIds: ["scout"], people: ["ben@acme.test"] });
  });

  it("leaves people out when none were picked, and hides the step without a directory", async () => {
    await open();
    click($('[role="checkbox"][aria-label="Scout"]'));
    click(createButton());
    expect(creates()[0]?.people).toBeUndefined();
    setTeamPeople(null);
    await open();
    expect($("[data-new-room-people]")).toBeNull();
  });

  it("offers the viewer's own face too: starting a room can mean putting yourself in it", async () => {
    await open();
    expect($('[data-new-room-person="ada@acme.test"]')).not.toBeNull();
    expect($('[data-new-room-person="ben@acme.test"]')).not.toBeNull();
  });
});
