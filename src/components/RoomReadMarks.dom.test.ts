// @vitest-environment happy-dom
// The read-mark faces under a line of the viewer's own: the directory names them, an address the directory lost
// keeps its own name, and without read marks from the server nothing renders at all.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { setTeamPeople, type TeamPeople } from "@/state/team-people";
import type { Group, Message } from "@/state/store";

vi.mock("./Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));

const { RoomReadMarks } = await import("./RoomReadMarks");

const directory: TeamPeople = {
  people: [
    { email: "ada@acme.test", name: "Ada", role: "member", you: true },
    { email: "ben@acme.test", name: "Ben", role: "member" },
  ],
  me: { email: "ada@acme.test", name: "Ada", role: "member", you: true },
  admin: false, needsYou: [], presence: false,
};
const group = (peopleReads?: Record<string, string[]>): Group => ({
  id: "desk", threadId: "desk-thread", name: "Desk HQ", memberIds: [],
  defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1,
  setupCompletedAt: 1, messages: [], peopleReads,
});
const message = (id: string): Message => ({
  id, at: 1, kind: "text", role: "user", text: "hello", threadId: "desk-thread",
} as unknown as Message);

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const render = async (marks: Group, msg: Message) => {
  flushSync(() => root.render(createElement(RoomReadMarks, { group: marks, message: msg })));
  await settle();
};

beforeEach(() => {
  setLocale("en");
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

describe("RoomReadMarks", () => {
  it("shows the faces of who read a line, named for the screen reader", async () => {
    await render(group({ m1: ["ben@acme.test"] }), message("m1"));
    const marks = document.querySelector("[data-read-marks]");
    expect(marks?.getAttribute("data-read-marks")).toBe("1");
    expect(marks?.getAttribute("aria-label")).toBe("Read by Ben");
  });

  it("keeps a lost address's own name and caps the row at five faces", async () => {
    const readers = ["ben@acme.test", "ghost@acme.test", "lee@acme.test", "kim@acme.test", "zoe@acme.test", "ivy@acme.test"];
    await render(group({ m2: readers }), message("m2"));
    const marks = document.querySelector("[data-read-marks]");
    expect(marks?.getAttribute("aria-label")).toContain("Ghost");
    expect(marks?.getAttribute("aria-label")).toContain("Ivy");
    expect(marks?.querySelectorAll("[data-person], span").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-read-marks]")?.textContent).toContain("+1");
  });

  it("renders nothing without read marks for the line", async () => {
    await render(group({ m1: ["ben@acme.test"] }), message("m2"));
    expect(document.querySelector("[data-read-marks]")).toBeNull();
    await render(group(), message("m1"));
    expect(document.querySelector("[data-read-marks]")).toBeNull();
  });

  it("keeps naming the readers from their addresses when no directory is loaded", async () => {
    setTeamPeople(null);
    await render(group({ m3: ["ben@acme.test"] }), message("m3"));
    expect(document.querySelector("[data-read-marks]")?.getAttribute("aria-label")).toBe("Read by Ben");
  });
});
