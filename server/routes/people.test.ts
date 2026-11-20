import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope } from "../request-auth.ts";
import { createPeopleRoutes } from "./people.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const ADA = "ada@example.test";
const people: Array<{ email: string; role: "admin" | "member"; name: string }> = [
  { email: "ada@example.test", role: "admin", name: "Ada" },
  { email: "grace@example.test", role: "member", name: "Grace" },
];

function start(directory: Parameters<typeof createPeopleRoutes>[0]["directory"]): Promise<string> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = url.searchParams.get("as") === "ada"
      ? ({ kind: "session", scopes: ["client"], session: { id: "s1", email: ADA } } as never)
      : url.searchParams.get("as") === "none"
        ? ({ kind: "loopback", scopes: ["admin"] } as never)
        : ({ kind: "session", scopes: ["admin"], session: { id: "s2", email: undefined } } as never);
    const handled = await dispatchRoutes([createPeopleRoutes({ directory })], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
    if (!handled) json(res, 404, {});
  });
  servers.push(server);
  return new Promise((ready) => server.listen(0, "127.0.0.1", () => ready(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

describe("the people route", () => {
  it("answers the directory to a signed-in session, their own entry marked", async () => {
    const base = await start({ entries: (viewer) => people.map((one) => ({ ...one, ...(viewer && one.email === viewer ? { you: true as const } : {}) })) });
    const theirs = await (await fetch(`${base}/api/people?as=ada`)).json();
    expect(theirs).toEqual({ people: [{ ...people[0], you: true }, people[1]] });
    // A session without an address still gets the roster, with nobody marked.
    expect(await (await fetch(`${base}/api/people`)).json()).toEqual({ people });
    expect(requiredScope("GET", "/api/people")).toBe("client");
  });

  it("answers 404 to a caller that never signed in, and where no directory is kept", async () => {
    expect((await fetch(`${await start({ entries: () => people })}/api/people?as=none`)).status).toBe(404);
    expect((await fetch(`${await start(null)}/api/people?as=ada`)).status).toBe(404);
  });
});
