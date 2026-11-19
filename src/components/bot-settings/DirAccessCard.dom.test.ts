// @vitest-environment happy-dom
// The directory write card in a real DOM: mode switching, allowlist edits and the engine enforcement line all
// PATCH directly, so a refused change never sticks in local state.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  sent: [] as Array<{ path: string; body: unknown }>,
  driverKind: "codex" as string | undefined,
  homeDir: "/Users/tester" as string | undefined,
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: { ...original.initialState, instances: [{ instanceId: "inst-1", driverKind: fixture.driverKind }] } }),
    api: async (path: string, init?: { method?: string; body?: string }) => {
      fixture.sent.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
      return {};
    },
  };
});
vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { host: { homeDir: fixture.homeDir } } }),
}));

const { DirAccessCard } = await import("./DirAccessCard");

let host: HTMLDivElement;
let root: Root;
const bot = (dirAccess?: unknown) => ({
  id: "b1", name: "Scout", modelSelection: { instanceId: "inst-1", model: "m" }, dirAccess,
} as unknown as Bot);
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const mount = async (cardBot: Bot) => { flushSync(() => root.render(createElement(DirAccessCard, { bot: cardBot }))); await settle(); };
const modeButton = (mode: string) => host.querySelector<HTMLButtonElement>(`[aria-pressed][data-testid="dir-access-card"] button[aria-pressed="false"], [aria-pressed]`) &&
  [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((button) => button.textContent === mode);
const click = async (button: HTMLButtonElement) => { flushSync(() => button.click()); await settle(); };

beforeEach(() => {
  setLocale("en");
  fixture.sent = [];
  fixture.driverKind = "codex";
  fixture.homeDir = "/Users/tester";
  window.ogb = {} as typeof window.ogb;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete (window as { ogb?: unknown }).ogb;
});

describe("DirAccessCard", () => {
  it("shows an absent policy as Unrestricted, then PATCHes the chosen mode", async () => {
    await mount(bot(undefined));
    const unrestricted = [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((button) => button.getAttribute("aria-pressed") === "true");
    expect(unrestricted?.textContent).toBe("Unrestricted");
    await click(modeButton("Own folders only")!);
    expect(fixture.sent).toEqual([{ path: "/api/bots/b1", body: { dirAccess: { mode: "workspace" } } }]);
  });

  it("lists the allowlist of a custom bot and removes an entry", async () => {
    await mount(bot({ mode: "custom", extraDirs: ["/srv/shared-reports"] }));
    expect(host.textContent).toContain("shared-reports");
    const remove = host.querySelector<HTMLButtonElement>("li button");
    await click(remove!);
    expect(fixture.sent).toEqual([{ path: "/api/bots/b1", body: { dirAccess: { mode: "custom", extraDirs: [] } } }]);
  });

  it("adds a typed absolute path to the allowlist", async () => {
    await mount(bot({ mode: "custom", extraDirs: [] }));
    await click([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add path…")!);
    const input = host.querySelector<HTMLInputElement>("form input");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    flushSync(() => { setValue.call(input!, "/srv/reports"); input!.dispatchEvent(new Event("input", { bubbles: true })); });
    await settle();
    const submit = host.querySelector<HTMLButtonElement>("form button[type=\"submit\"]")!;
    expect(submit.disabled).toBe(false);
    await click(submit);
    expect(fixture.sent).toEqual([{ path: "/api/bots/b1", body: { dirAccess: { mode: "custom", extraDirs: ["/srv/reports"] } } }]);
  });

  it("names the engine's enforcement, per driver kind", async () => {
    await mount(bot({ mode: "workspace" }));
    expect(host.textContent).toContain("operating system");
    fixture.driverKind = "claudeAgent";
    await mount(bot({ mode: "workspace" }));
    expect(host.textContent).toContain("ask you first");
    fixture.driverKind = "gemini";
    await mount(bot({ mode: "workspace" }));
    expect(host.textContent).toContain("does not enforce");
    fixture.driverKind = "openai-compat";
    await mount(bot({ mode: "workspace" }));
    expect(host.textContent).toContain("no shell or file tools");
  });
});
