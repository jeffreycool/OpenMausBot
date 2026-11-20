// GET /api/people: the people directory of a self-hosted server (the sign-in
// list plus every address holding a session), each entry the caller's view of
// (`you` marks their own; `here` only while presence runs). Only a signed-in
// session may ask: a directory is no use to a script, and its names are not
// for callers that never signed in. A server that keeps no directory answers
// 404, which the client reads as "run without one".
import type { PeopleDirectoryResponse } from "../../shared/wire.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PeopleRouteDeps {
  /** The directory; null keeps the route answering 404. */
  directory: {
    entries(viewerEmail: string | undefined): PeopleDirectoryResponse["people"];
  } | null;
}

export const PEOPLE_PATH = "/api/people";

export function createPeopleRoutes(deps: PeopleRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    if (path !== PEOPLE_PATH || method !== "GET") return PASS;
    if (!deps.directory) return json(res, 404, { error: "no people directory" });
    if (auth.kind !== "session") return json(res, 404, { error: "no people directory" });
    return json(res, 200, { people: deps.directory.entries(auth.session.email ?? undefined) } satisfies PeopleDirectoryResponse);
  };
}
