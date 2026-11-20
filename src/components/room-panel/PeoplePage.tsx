// The room's People page: the humans in the roster and the bots that answer in it. An admin adds or removes people
// from the server's signed-in directory and everyone sees who is here; a bot's folder write boundary shows as a
// read-only value because the setting itself lives in that bot's panel. Without a directory (an older server, or
// nobody signed in) the roster still shows, named from the addresses it holds.
import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { nameFromEmail } from "../../../shared/bot-owner";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore, type Bot, type Group } from "@/state/store";
import { useTeamPeople, type TeamPerson } from "@/state/team-people";
import { BotAvatar } from "../Avatar";
import { buttonCls, Card, NoteRow, rowCls, RowText } from "../bot-panel/rows";
import { HereDot } from "../TeamPresence";
import { PersonFace } from "../TeamOwner";

/** A bot's folder write boundary, as a value only: "Folder access · Own folders only". Null for an unrestricted
 * bot, whose setting needs no line here. */
export function botFolderLabel(bot: Pick<Bot, "dirAccess">): string | null {
  const mode = bot.dirAccess?.mode;
  if (!mode || mode === "open") return null;
  return `${t("botAccess.dirAccess.title")} · ${t(`botAccess.dirAccess.mode.${mode}`)}`;
}

/** The roster's people: each email as a directory entry when the directory knows it, else the name the address
 * itself gives (a roster can outlive its directory being reachable). */
export function rosterOf(group: Pick<Group, "people">, people: readonly TeamPerson[]): TeamPerson[] {
  return (group.people ?? []).map((email) => people.find((person) => person.email.toLowerCase() === email.toLowerCase())
    ?? { email, name: nameFromEmail(email), role: "member" });
}

export function PeoplePage({ group, members }: { group: Group; members: Bot[] }) {
  const { dispatch } = useStore();
  const team = useTeamPeople();
  const admin = team?.admin === true;
  const directory = team?.people ?? [];
  const roster = useMemo(() => rosterOf(group, directory), [group.people, directory]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const presence = team?.presence === true;

  const addable = useMemo(() => directory.filter((person) => !(group.people ?? []).includes(person.email)), [directory, group.people]);
  const savePeople = (next: string[]) => dispatch({ type: "patchGroup", groupId: group.id, patch: { people: next } });
  const remove = (email: string) => savePeople((group.people ?? []).filter((known) => known !== email));
  const addPicked = () => {
    if (!picked.size) return;
    savePeople([...(group.people ?? []), ...picked]);
    setPicked(new Set());
  };
  const toggle = (email: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });

  return (
    <>
      {(admin || roster.length > 0) && (
      <Card label={t("room.people.humans")}>
        {roster.length === 0 && <NoteRow>{t("room.people.empty")}</NoteRow>}
        {roster.map((person) => (
          <div key={person.email} className={rowCls} data-room-person={person.email}>
            <span className="relative inline-flex shrink-0">
              <PersonFace person={person} size={28} />
              {presence && person.here === true && <HereDot size={28} edge="panel" />}
            </span>
            <RowText
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate" title={person.name}>{person.name}</span>
                  {person.role === "admin" && (
                    <span className="ui-chip shrink-0 text-[11px]">{t("room.people.role.admin")}</span>
                  )}
                </span>
              }
              hint={<span className="truncate font-mono text-[12px]" title={person.email}>{person.email}</span>}
            />
            {person.you && <span className="shrink-0 text-[12px] text-ink-tertiary">{t("room.people.you")}</span>}
            {admin && (
              <button type="button" data-room-person-remove={person.email} aria-label={t("room.people.remove", { name: person.name })}
                onClick={() => remove(person.email)}
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-tertiary hover:bg-ink/[0.05] hover:text-ink">
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {admin && (
          <div className="flex flex-col gap-2 px-3.5 pb-3.5 pt-1" data-room-people-add>
            {addable.length > 0 && (
              <div role="group" aria-label={t("room.people.add")} className="flex flex-col">
                {addable.map((person) => {
                  const on = picked.has(person.email);
                  return (
                    <button key={person.email} type="button" role="checkbox" aria-checked={on} data-room-people-option={person.email}
                      onClick={() => toggle(person.email)}
                      className={cn("flex min-h-[38px] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left", on ? "bg-ink/[0.06]" : "hover:bg-ink/[0.04]")}>
                      <PersonFace person={person} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{person.name}</span>
                        <span className="block truncate font-mono text-[11px] text-ink-tertiary">{person.email}</span>
                      </span>
                      <span className="flex w-4 shrink-0 text-ink">{on && <Check size={16} aria-hidden="true" />}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {addable.length === 0 ? (
              <span className="text-[12px] leading-4 text-ink-tertiary">{t("room.people.noneToAdd")}</span>
            ) : (
              <button type="button" data-room-people-save disabled={!picked.size} onClick={addPicked} className={cn(buttonCls, "self-end")}>
                <Plus size={14} aria-hidden="true" />
                {picked.size === 0 ? t("room.people.add") : picked.size === 1 ? t("room.people.addOne") : t("room.people.addMany", { count: picked.size })}
              </button>
            )}
          </div>
        )}
      </Card>
      )}
      <Card label={t("room.panel.members")}>
        {members.length === 0 && <NoteRow>{t("room.members.needOne")}</NoteRow>}
        {members.map((member) => {
          const folders = botFolderLabel(member);
          return (
            <div key={member.id} className={rowCls} data-room-bot={member.id}>
              <BotAvatar bot={member} state="happy" size={28} animated={false} />
              <RowText
                title={<span className="truncate" title={member.name}>{member.name}</span>}
                hint={
                  folders ? (
                    <span className="truncate" title={`${t("botAccess.dirAccess.description")} ${folders}`}>{folders}</span>
                  ) : (
                    <span className="truncate" title={member.title}>{member.title}</span>
                  )
                }
              />
            </div>
          );
        })}
      </Card>
    </>
  );
}
