// The people directory of a self-hosted server: the signed-in people a room's roster, the sidebar faces and the
// @ list are built from. It reuses the TeamPeople store, so everything a team's people already light up (the
// sidebar row, presence, @ mentions) lights up here the same way, off a team.
//
// TODO(server-unlock): GET /api/people and its PersonEntry shape
// ({ email, name, role: "admin" | "member", here?, you? }) land on the agentchat-server-unlock branch (see
// agentchat/README.md). Until then a server without it answers 404 and this loader returns null: every UI that
// reads the people renders nothing, exactly as before the directory existed. Do not add the endpoint to this fork's
// server here.
import { readSessionState } from "@/lib/session";
import { api } from "./api";
import type { TeamPeople } from "./team-people";

/** What GET /api/people returns once the server unlock lands; anything else is treated as no directory. */
type DirectoryAnswer = { people?: Array<{ email: string; name: string; role: string; here?: boolean; you?: true }> };

const emailOfSession = async (): Promise<string | null> => {
  const session = await readSessionState();
  const email = session.kind === "session" ? session.email : undefined;
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
};

/** The directory as a people snapshot, or null when there is none: not signed in with an email, the server has no
 * directory (404), or the read failed. Same shape a team's people load, so the publisher needs no branch. */
export async function loadDirectoryPeople(): Promise<TeamPeople | null> {
  const email = await emailOfSession();
  if (!email) return null;
  try {
    const answer = await api<DirectoryAnswer>("/api/people", { background: true });
    const people = Array.isArray(answer?.people) ? answer.people : [];
    const session = await readSessionState();
    return {
      people,
      me: people.find((person) => person.you) ?? null,
      admin: session.kind === "session" ? session.scopes.includes("admin") : session.kind === "loopback",
      needsYou: [],
      presence: people.some((person) => typeof person.here === "boolean"),
    };
  } catch {
    return null;
  }
}
