import { describe, expect, it } from "vitest";

import { createPeopleDirectory } from "./people-directory.ts";

const LIST = { admins: ["ada@example.test"], members: ["grace@example.test", "@example.test"] };

const directory = (over: Partial<Parameters<typeof createPeopleDirectory>[0]> = {}) =>
  createPeopleDirectory({ allowList: () => LIST, sessions: () => [], chosenName: () => null, ...over });

describe("the people directory", () => {
  it("lists the sign-in list's named addresses with their roles, each once, sorted", () => {
    expect(directory().list()).toEqual([
      { email: "ada@example.test", role: "admin", name: "Ada" },
      { email: "grace@example.test", role: "member", name: "Grace" },
    ]);
  });

  it("adds every address holding a session, as its scopes say, and never demotes an admin", () => {
    const withSessions = directory({ sessions: () => [
      { email: "Linus@Example.test", scopes: ["client"] },
      { email: "ada@example.test", scopes: ["admin", "client"] },
      { email: "root@example.test", scopes: ["admin", "client"] },
      { email: "" },
    ] });
    expect(withSessions.list().map((one) => [one.email, one.role])).toEqual([
      ["ada@example.test", "admin"],
      ["grace@example.test", "member"],
      ["linus@example.test", "member"],
      ["root@example.test", "admin"],
    ]);
  });

  it("prefers the name the person chose here, and falls back to the address's local part", () => {
    const named = directory({ chosenName: (email) => (email === "grace@example.test" ? "Grace Hopper" : null) });
    expect(named.list().find((one) => one.email === "grace@example.test")?.name).toBe("Grace Hopper");
    expect(named.list().find((one) => one.email === "ada@example.test")?.name).toBe("Ada");
  });

  it("answers a caller's view: their own entry marked, presence only when it runs", () => {
    const plain = directory();
    expect(plain.entries("ada@example.test")).toEqual([
      { email: "ada@example.test", role: "admin", name: "Ada", you: true },
      { email: "grace@example.test", role: "member", name: "Grace" },
    ]);
    const here = directory({ here: (email) => email === "grace@example.test" });
    // While presence runs every entry carries the mark, false included.
    expect(here.entries(undefined)).toEqual([
      { email: "ada@example.test", role: "admin", name: "Ada", here: false },
      { email: "grace@example.test", role: "member", name: "Grace", here: true },
    ]);
  });

  it("offers the presence roster: who exists, with their role, and nothing to subscribe to", () => {
    const roster = directory({ sessions: () => [{ email: "root@example.test", scopes: ["admin", "client"] }] }).roster;
    expect(roster.list()).toEqual([
      { email: "ada@example.test", role: "admin" },
      { email: "grace@example.test", role: "member" },
      { email: "root@example.test", role: "admin" },
    ]);
    expect(roster.onChange(() => {})).toBeTypeOf("function");
  });
});
