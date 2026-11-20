// The faces of the people who have read a line of the viewer's own, under the line. Nothing while the server
// sends no read marks (the seam in src/state/room-reads.ts) and nothing on anyone else's lines.
import { useRoomReadMarks } from "@/state/room-reads";
import { activeLocale, t } from "@/lib/i18n";
import type { Group, Message } from "@/state/store";
import { PersonFace } from "./TeamOwner";

const FACES = 5;

export function RoomReadMarks({ group, message }: { group: Group; message: Message }) {
  const people = useRoomReadMarks(group, message.id);
  if (people.length === 0) return null;
  const names = new Intl.ListFormat(activeLocale(), { type: "conjunction" }).format(people.map((person) => person.name));
  const label = t("room.readBy", { names });
  return (
    <span role="img" aria-label={label} title={label} data-read-marks={people.length}
      className="mt-0.5 flex items-center -space-x-1 pe-1">
      {people.slice(0, FACES).map((person) => (
        <span key={person.email} className="relative inline-flex rounded-full ring-2 ring-app">
          <PersonFace person={person} size={16} />
        </span>
      ))}
      {people.length > FACES && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full border border-hairline bg-raised px-0.5 text-[11px] font-medium tabular-nums text-ink-secondary">
          +{people.length - FACES}
        </span>
      )}
    </span>
  );
}
