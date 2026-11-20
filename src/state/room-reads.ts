// Per-person read marks for a room: who has read which line. The UI is the seam — the data is not here yet, and
// until the server sends it nothing renders anywhere.
//
// TODO(server-unlock): the read marks themselves arrive with the server unlock (agentchat-server-unlock branch;
// see agentchat/README.md): WireGroup grows `peopleReads?: Record<string, string[]>` — a message id mapped to the
// emails of the people who have read it (the mirror field is already declared on the client's Group). Until then
// `group.peopleReads` is always undefined and `useRoomReadMarks` returns an empty list, so `RoomReadMarks` renders
// nothing. Do not add the field to shared/wire.ts here.
import { useMemo } from "react";

import { nameFromEmail } from "../../shared/bot-owner";
import { useTeamPeople, type TeamPerson } from "./team-people";
import type { Group } from "./store";

/** The people who have read a message: the directory's entry for each email when it has one, else the name the
 * address itself gives. Empty while the server sends no read marks. */
export function useRoomReadMarks(group: Pick<Group, "peopleReads">, messageId: string): TeamPerson[] {
  const team = useTeamPeople();
  return useMemo(() => {
    const emails = group.peopleReads?.[messageId] ?? [];
    return emails.map((email) => team?.people.find((person) => person.email.toLowerCase() === email.toLowerCase())
      ?? { email, name: nameFromEmail(email), role: "member" });
  }, [group.peopleReads, messageId, team]);
}
