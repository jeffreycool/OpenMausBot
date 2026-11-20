import { useMemo, useState } from "react";
import { track } from "@/lib/analytics";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { imeComposing } from "@/lib/send-key";
import { useTeamPeople } from "@/state/team-people";
import { BotPickerList } from "./BotPickerList";
import { PersonFace } from "./TeamOwner";
import { cn } from "@/lib/cn";

/** Sidebar → New channel: name it, optionally file it under a context, pick its bots — and, when the server has a
 * people directory, start it with people in the room too (an optional field on something the person sets up;
 * TODO seam: the roster rides the create call, see agentchat/README.md "server-unlock"). */
export function NewRoomPanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const team = useTeamPeople();
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<Set<string>>(new Set());
  const bots = state.bots.filter((b) => !b.hidden);
  const addable = useMemo(() => team?.people ?? [], [team?.people]);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePerson = (email: string) =>
    setPeople((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  const create = () => {
    if (!picked.size) return;
    dispatch({
      type: "createGroup",
      memberIds: [...picked],
      name: name.trim() || undefined,
      section: section.trim() || undefined,
      ...(people.size ? { people: [...people] } : {}),
    });
    track("room_created", { members: picked.size, context: Boolean(section.trim()), people: people.size });
    onClose();
  };
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[340px] rounded-2xl border border-hairline/50 bg-card p-4 shadow-2xl">
        <div className="mb-3 text-[15px] font-semibold text-ink">{t("sidebar.newChannel.title")}</div>
        <input
          autoFocus
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (imeComposing(e.nativeEvent)) { e.stopPropagation(); return; }
            if (e.key === "Enter") create();
            if (e.key === "Escape") onClose();
          }}
          aria-label={t("sidebar.newChannel.nameLabel")}
          placeholder={t("sidebar.newChannel.name")}
          className="mb-3 w-full rounded-lg bg-raised/70 px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <input
          value={section}
          maxLength={60}
          onChange={(e) => setSection(e.target.value)}
          onKeyDown={(e) => {
            if (imeComposing(e.nativeEvent)) { e.stopPropagation(); return; }
            if (e.key === "Enter") create();
            if (e.key === "Escape") onClose();
          }}
          placeholder={t("sidebar.newChannel.context")}
          aria-label={t("sidebar.newChannel.contextAria")}
          className="mb-3 w-full rounded-lg bg-raised/70 px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <BotPickerList
          bots={bots}
          picked={picked}
          onToggle={toggle}
          emptyHint={t("sidebar.newChannel.emptyHint")}
        />
        {addable.length > 0 && (
          <div className="mt-3" data-new-room-people>
            <div className="mb-1.5 text-[12px] font-medium text-ink-tertiary">{t("room.people.humans")}</div>
            <div role="group" aria-label={t("room.people.humans")} className="flex flex-wrap gap-1">
              {addable.map((person) => {
                const on = people.has(person.email);
                return (
                  <button key={person.email} type="button" role="checkbox" aria-checked={on} data-new-room-person={person.email}
                    title={person.name} onClick={() => togglePerson(person.email)}
                    className={cn("flex items-center rounded-full p-0.5", on ? "bg-ink/[0.14] text-ink" : "hover:bg-raised/60")}>
                    <PersonFace person={person} size={24} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <button
          onClick={create}
          disabled={!picked.size}
          className="mt-3 w-full rounded-lg bg-accent py-2 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {picked.size === 0
            ? t("sidebar.newChannel.create")
            : picked.size === 1
              ? t("sidebar.newChannel.createOne")
              : t("sidebar.newChannel.createMany", { count: picked.size })}
        </button>
      </div>
    </div>
  );
}
