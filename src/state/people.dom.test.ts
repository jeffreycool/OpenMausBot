// @vitest-environment happy-dom
// The people loader off a team: a self-hosted server's directory (GET /api/people) becomes the people snapshot;
// a server without one (404), or nobody signed in, leaves the people off exactly as before; a team still reads its
// own endpoint. TODO seam: the endpoint lands with the server unlock (see agentchat/README.md).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  session: { kind: "loopback", trust: "owner" } as Record<string, unknown>,
  calls: [] as string[],
  directoryDown: false,
}));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/session")>(),
  readSessionState: async () => fixture.session,
}));
vi.mock("./api", () => ({
  api: async (path: string) => {
    fixture.calls.push(path);
    if (path === "/api/people") {
      if (fixture.directoryDown) throw Object.assign(new Error("no route"), { status: 404 });
      return { people: [
        { email: "ben@acme.test", name: "Ben", role: "member", here: true },
        { email: "ada@acme.test", name: "Ada", role: "admin", you: true },
      ] };
    }
    if (path === "/api/team/people") return { people: [{ email: "team@acme.test", name: "Team", role: "member" }] };
    if (path === "/api/needs-you") return { items: [] };
    throw new Error(`not found: ${path}`);
  },
}));

const { setTeamPeople, useTeamPeople, useTeamPeopleStatus, useTeamPeopleLoader, currentTeamPeople } = await import("./team-people");

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
function Probe({ config }: { config: unknown }) {
  useTeamPeopleLoader(config, 0);
  const team = useTeamPeople();
  const status = useTeamPeopleStatus();
  return createElement("div", {
    "data-status": status,
    "data-people": team ? team.people.map((person) => person.email).join(",") : "none",
    "data-admin": team ? String(team.admin) : "",
  });
}
const render = async (config: unknown) => {
  flushSync(() => root.render(createElement(Probe, { config })));
  await settle();
};
const shown = () => host.querySelector<HTMLElement>("[data-people]");

beforeEach(() => {
  fixture.session = { kind: "loopback", trust: "owner" };
  fixture.calls = [];
  fixture.directoryDown = false;
  setTeamPeople(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  setTeamPeople(null);
});

describe("the people loader off a team", () => {
  it("loads the directory of a signed-in session and publishes it as the people", async () => {
    fixture.session = { kind: "session", id: "s1", email: "ada@acme.test", scopes: ["client"], expiresAt: 9 };
    await render(null);
    expect(shown()?.getAttribute("data-people")).toBe("ben@acme.test,ada@acme.test");
    expect(shown()?.getAttribute("data-status")).toBe("ready");
    expect(shown()?.getAttribute("data-admin")).toBe("false");
    expect(currentTeamPeople()?.presence).toBe(true);
  });

  it("stays off when nobody is signed in", async () => {
    await render(null);
    expect(fixture.calls).toEqual([]);
    expect(shown()?.getAttribute("data-people")).toBe("none");
  });

  it("stays off when the server has no directory", async () => {
    fixture.session = { kind: "session", id: "s1", email: "ada@acme.test", scopes: ["client"], expiresAt: 9 };
    fixture.directoryDown = true;
    await render(null);
    expect(shown()?.getAttribute("data-people")).toBe("none");
    expect(shown()?.getAttribute("data-status")).toBe("ready");
  });

  it("a team still reads the team's people, not the directory", async () => {
    await render({ team: { id: "t1", name: "Acme" } });
    expect(fixture.calls).toContain("/api/team/people");
    expect(fixture.calls).not.toContain("/api/people");
    expect(shown()?.getAttribute("data-people")).toBe("team@acme.test");
  });
});
