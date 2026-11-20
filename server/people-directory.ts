// The people directory of a self-hosted server (GET /api/people): the sign-in
// list, plus every address that holds a session (someone let in by an
// `@domain` entry counts once they have signed in). A name is the one the
// person chose here (person-names.json), else the address's local part. The
// roster feeds @-mentions, presence and room headers; it is never a permission
// gate — what a person may see is visibility's to decide. Computed live on
// every read, so a Settings change to the sign-in list counts at once; there
// are no change events to subscribe to (the lists only change when an admin
// edits them, and presence states are momentary by design).
import { nameFromEmail } from "../shared/bot-owner.ts";
import type { SignInAllowList } from "./account-signin.ts";

/** A session as the directory reads it: its address, if it has one, decides. */
export interface DirectorySession {
  email?: string | null;
  scopes?: readonly string[];
}

export interface PersonDirectoryDeps {
  allowList(): SignInAllowList;
  sessions(): readonly DirectorySession[];
  /** The name the person chose on this server, else null. */
  chosenName(email: string): string | null;
  /** Whether this person is here now (presence); absent: nobody is marked here. */
  here?(email: string): boolean;
}

export interface DirectoryPerson {
  email: string;
  role: "admin" | "member";
  name: string;
}

export function createPeopleDirectory(deps: PersonDirectoryDeps) {
  /** Every address the server knows, each with its role: the sign-in list's
   * named addresses (an `@domain` entry joins when someone there signs in),
   * then every address holding a session. Sorted, each address once, an
   * admin never demoted by a member listing. */
  const list = (): DirectoryPerson[] => {
    const roles = new Map<string, "admin" | "member">();
    const give = (address: string, role: "admin" | "member") => {
      if (roles.get(address) === "admin") return;
      roles.set(address, role);
    };
    for (const entry of deps.allowList().members) {
      if (entry.startsWith("@")) continue;
      const address = entry.trim().toLowerCase();
      if (address.includes("@")) give(address, "member");
    }
    for (const entry of deps.allowList().admins) {
      if (entry.startsWith("@")) continue;
      const address = entry.trim().toLowerCase();
      if (address.includes("@")) give(address, "admin");
    }
    for (const session of deps.sessions()) {
      const address = session.email?.trim().toLowerCase();
      if (!address || !address.includes("@")) continue;
      give(address, session.scopes?.includes("admin") ? "admin" : "member");
    }
    return [...roles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([address, role]) =>
      ({ email: address, role, name: deps.chosenName(address) ?? nameFromEmail(address) }));
  };
  return {
    list,
    /** What GET /api/people answers with, from one caller's view. */
    entries(viewerEmail: string | undefined): Array<{ email: string; role: "admin" | "member"; name: string; here?: boolean; you?: true }> {
      const you = viewerEmail?.trim().toLowerCase();
      return list().map((one) => ({
        ...one,
        ...(deps.here ? { here: deps.here(one.email) } : {}),
        ...(you && one.email === you ? { you: true as const } : {}),
      }));
    },
    /** What the presence host needs of the roster: who exists, with their role. */
    roster: {
      list(): Array<{ email: string; role: "owner" | "admin" | "member" }> {
        return list().map((one) => ({ email: one.email, role: one.role }));
      },
      /** Nothing to subscribe to: the roster is computed live, and only an
       * admin's Settings change alters it (see the file comment), so the
       * listener is taken and never called. */
      onChange(_listener: (email: string, change: "joined" | "role" | "left") => void): () => void {
        return () => {};
      },
    },
  };
}

export type PeopleDirectory = ReturnType<typeof createPeopleDirectory>;
