// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_ONBOARDING } from "@/lib/onboarding";
import { TEAMS_NOTICE } from "@/lib/notices";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), session: {} as Record<string, unknown>, cards: [] as unknown[] }));
vi.mock("@/state/store", () => ({
  useStore: () => ({ state: f.state, dispatch: f.dispatch }),
  api: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/auth/session") return f.session;
    if (path === "/api/announcements") return { cards: f.cards, updatedAt: "2026-11-11T00:00:00Z" };
    if (path === "/api/config" && init?.method === "PUT") return { ...(f.state.config as object), onboarding: JSON.parse(String(init.body)).onboarding };
    if (path === "/api/me/welcome") return { welcome: {} };
    return f.state.config;
  }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
const { useAnnouncements } = await import("./use-announcements");
const { forgetAnnouncementCards } = await import("@/lib/announcements");
const { api } = await import("@/state/store");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null = null;
let found: ReturnType<typeof useAnnouncements>;
function Probe() { found = useAnnouncements(() => Date.parse("2026-11-18T10:00:00Z")); return null; }
const mount = async () => {
  root = createRoot(host);
  await act(async () => { root!.render(createElement(Probe)); });
  for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
};
const config = (hintsSeen: string[], extra: Record<string, unknown> = {}) => ({ onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01", version: 1, hintsSeen }, ...extra });

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), clear: () => storage.clear() });
  forgetAnnouncementCards(); vi.clearAllMocks(); f.cards = [];
  f.session = { hosted: true, scopes: ["admin"] };
  f.state = { connected: true, bots: [{ tasks: [{ threadId: "t", createdAt: 1, usage: { turns: 2 } }] }], groups: [], routines: [], routinesLoadState: "ready", config: config([]) };
  f.dispatch.mockImplementation((action: { type: string; config?: unknown }) => { if (action.type === "configStatus") f.state = { ...f.state, config: action.config }; });
  host = document.createElement("div"); document.body.append(host);
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; host?.remove(); vi.unstubAllGlobals(); });

// agentchat fork: the fork shows no announcement and no new mark (shared/announcements.ts UPSTREAM_ANNOUNCEMENTS_ENABLED = false): neither the file's
// cards nor the built-in popups' rows, for anyone, and the page never asks for the cards. Upstream's cases for the rows come back with the constant.
const remoteCard = { id: "remote-card", kind: "product", title: "Title", body: "Body.", primary: { label: "Open", action: { open_url: "https://example.com/" } }, ends: "2026-12-31T00:00:00Z" };
const asked = (path: string) => vi.mocked(api).mock.calls.some(([asked]) => asked === path);

it("the fork: someone who used the app before gets no row and no dot, and the page asks for no cards", async () => {
  f.cards = [remoteCard];
  await mount();
  expect(found.items).toEqual([]);
  expect(found.unread).toBe(false);
  expect(asked("/api/announcements")).toBe(false);
  expect(found.unread, "so the page, which clears a mark only when there is one, writes nothing").toBe(false);
});

it("no dot once the Teams popup was seen, nor before the session is known", async () => {
  f.state = { ...f.state, config: config([TEAMS_NOTICE]) };
  await mount();
  expect(found.unread).toBe(false);
  await act(async () => root?.unmount());
  f.session = new Promise(() => {}) as never;
  f.state = { ...f.state, config: config([]) };
  await mount();
  expect(found.unread, "waits for who is looking").toBe(false);
});

it("the fork: a Team Cloud's member neither: no row, no dot and no ask", async () => {
  f.session = { hosted: true, scopes: ["client"], team: { role: "member" } };
  f.state = { ...f.state, config: config([], { team: { id: "t", name: "Acme" }, cloudHome: true }) };
  f.cards = [remoteCard];
  await mount();
  expect(found.items).toEqual([]);
  expect(found.unread).toBe(false);
  expect(asked("/api/announcements")).toBe(false);
});
