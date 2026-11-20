// Who a room line will reach, while it is being written: the members an explicit @-tag names, a warning when two
// members share the tagged name, and the [local] tag saying the work runs on this computer (the agentChat
// dispatcher reads the tag; this is only its presentation). No line at all while the room's default responder
// answers — the composer placeholder already says that, and a resting screen stays quiet.
import { Laptop } from "lucide-react";

import { isMentionBoundary, isMentionNameContinuation } from "../../shared/mention-boundary";
import { roomRouteForComposer } from "@/lib/group-routing";
import { activeLocale, t } from "@/lib/i18n";
import { mentionPicksFor } from "@/lib/mention-picks";
import { roomAddressees } from "@/lib/room-addressees";
import { useTeammates } from "@/state/team-people";
import type { Bot, Group } from "@/state/store";
import { BotAvatar } from "./Avatar";

/** Whether the draft hands the work to the member's own machine: the literal `[local]` tag, anywhere in the line. */
export function draftRunsLocal(text: string): boolean {
  return /\[local\]/i.test(text);
}

/** Whether the draft tags @everyone, read the way the room reads it (a boundary before it, none after). */
function tagsEveryone(text: string): boolean {
  let at = -1;
  while ((at = text.indexOf("@", at + 1)) !== -1) {
    if (isMentionBoundary(text, at) && text.slice(at + 1, at + 9).toLowerCase() === "everyone"
      && !isMentionNameContinuation(text.slice(at + 9))) return true;
  }
  return false;
}

export function RoomRoutingHint({ group, members, text, draftId }: {
  group: Group | undefined;
  members: Bot[] | undefined;
  text: string;
  draftId: string;
}) {
  const teammates = useTeammates();
  if (!group || !members || group.dm || !text.trim() || members.length === 0) return null;
  const route = roomRouteForComposer(text, members, group, mentionPicksFor(draftId).ids(text));
  // The members the draft @-tags by name; a person's tag names no member (the server reads the tie the same way).
  const named = roomAddressees({ text }, members, [], teammates.peers);
  const local = draftRunsLocal(text);
  if (!route.ambiguous && named.length === 0 && !tagsEveryone(text) && !local) return null;
  const names = new Intl.ListFormat(activeLocale(), { type: "conjunction" })
    .format(route.responders.map((member) => member.name));
  return (
    <div role="note" data-routing-hint={route.ambiguous ? "ambiguous" : local ? "local" : "responders"}
      className="relative z-[1] flex items-center gap-1.5 px-2 pb-1 text-[12px] leading-4 text-ink-secondary">
      {route.ambiguous ? (
        <span className="truncate">{t("composer.routing.ambiguous")}</span>
      ) : route.responders.length > 0 ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex items-center -space-x-1" aria-hidden="true">
            {route.responders.slice(0, 3).map((member) => (
              <BotAvatar key={member.id} bot={member} state="happy" size={16} animated={false} />
            ))}
          </span>
          <span className="truncate">{t("composer.routing.responders", { names })}</span>
        </span>
      ) : null}
      {local && (
        <span className="flex shrink-0 items-center gap-1 text-ink-tertiary">
          <Laptop size={12} aria-hidden="true" />
          <span>{t("composer.routing.local")}</span>
        </span>
      )}
    </div>
  );
}
