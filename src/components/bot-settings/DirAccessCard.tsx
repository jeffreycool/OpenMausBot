import { useState } from "react";
import { FolderOpen, Plus, ShieldCheck, X } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { shortPath } from "@/lib/short-path";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { inputCls } from "./field";
import { useBotEditor } from "./BotEditorContext";
import type { BotDirAccess } from "../../../shared/wire";

const MODES = ["workspace", "custom", "open"] as const;
type DirAccessMode = (typeof MODES)[number];

/** How this bot's engine enforces the write boundary: the OS sandbox (codex), the permission system (claude),
 * nothing to write with at all (chat drivers), or its instructions only (engines not wired up yet). */
function enforcementKey(driverKind: string | undefined): LocaleKey {
  if (driverKind === "codex") return "botAccess.dirAccess.enforcement.codex";
  if (driverKind === "claudeAgent") return "botAccess.dirAccess.enforcement.claude";
  if (driverKind !== undefined && ["grok", "openai-compat", "minimax", "mistral", "cerebras", "groq", "greenference", "modelgo", "meta"].includes(driverKind)) {
    return "botAccess.dirAccess.enforcement.noFileTools";
  }
  return "botAccess.dirAccess.enforcement.advisory";
}

/**
 * PATCHed directly, not via updateBot: the server validates paths and may refuse a widening while the bot is
 * busy, and a refused boundary must not stick in local state.
 */
export function DirAccessCard({ bot }: { bot: Bot }) {
  const { request } = useBotEditor();
  const { state } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const home = capabilities.host.homeDir;
  const driverKind = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.driverKind;
  // Absent policy = unrestricted: an existing bot shows Unrestricted until this bot's settings change it.
  const policy: BotDirAccess = bot.dirAccess ?? { mode: "open" };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftPath, setDraftPath] = useState("");

  const save = async (dirAccess: BotDirAccess | null) => {
    setSaving(true);
    setError(null);
    try {
      await request(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ dirAccess }) });
      setAdding(false);
      setDraftPath("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const setMode = (mode: DirAccessMode) => {
    if (mode === policy.mode || saving) return;
    void save(mode === "custom" ? { mode, extraDirs: policy.extraDirs ?? [] } : { mode });
  };
  const addDir = (dir: string) => {
    if (!dir.trim() || policy.mode !== "custom") return;
    void save({ mode: "custom", extraDirs: [...new Set([...(policy.extraDirs ?? []), dir.trim()])] });
  };
  const removeDir = (dir: string) => {
    if (policy.mode !== "custom") return;
    void save({ mode: "custom", extraDirs: (policy.extraDirs ?? []).filter((candidate) => candidate !== dir) });
  };
  const pick = async () => {
    const chosen = await window.ogb?.pickFolder?.(policy.extraDirs?.at(-1));
    if (chosen) addDir(chosen);
  };
  const canPick = Boolean(window.ogb?.pickFolder);

  const fixedRows = [
    home ? `${home}/.openmausbot/workspaces/${bot.id}` : t("botAccess.dirAccess.folder.private"),
    home ? `${home}/.openmausbot/task-workspaces/${bot.id}` : t("botAccess.dirAccess.folder.threads"),
  ];

  return (
    <div className="rounded-xl bg-card p-4" data-testid="dir-access-card">
      <div className="text-[15px] font-medium text-ink">{t("botAccess.dirAccess.title")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("botAccess.dirAccess.description")}</div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("botAccess.dirAccess.title")}>
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={saving}
            aria-pressed={policy.mode === mode}
            onClick={() => setMode(mode)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[13px] disabled:opacity-50",
              policy.mode === mode ? "bg-accent text-white" : "bg-control text-ink hover:bg-raised-hover",
            )}
          >
            {t(`botAccess.dirAccess.mode.${mode}`)}
          </button>
        ))}
      </div>
      <div className="mt-1.5 text-[12px] text-ink-secondary">{t(`botAccess.dirAccess.mode.${policy.mode}.hint`)}</div>
      <ul className="mt-3 space-y-1.5">
        {fixedRows.map((dir) => (
          <li key={dir} className="flex items-center gap-2 font-mono text-[12px] text-ink-secondary">
            <span className="size-1.5 shrink-0 rounded-full bg-ink-secondary/50" />
            <span className="truncate" title={dir}>{home ? shortPath(dir, home) : dir}</span>
            <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-secondary/70">{t("botAccess.dirAccess.fixed")}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 text-[12px] text-ink-secondary">
          <span className="size-1.5 shrink-0 rounded-full bg-ink-secondary/50" />
          <span className="truncate">{t("botAccess.dirAccess.folder.current")}</span>
          <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-secondary/70">{t("botAccess.dirAccess.fixed")}</span>
        </li>
        {policy.mode === "custom" && (policy.extraDirs ?? []).map((dir) => (
          <li key={dir} className="flex items-center gap-2 font-mono text-[12px] text-ink">
            <span className="size-1.5 shrink-0 rounded-full bg-ink-secondary/50" />
            <span className="truncate" title={dir}>{shortPath(dir, home)}</span>
            <button
              type="button"
              disabled={saving}
              aria-label={t("botAccess.dirAccess.remove", { path: dir })}
              onClick={() => removeDir(dir)}
              className="ml-auto shrink-0 rounded p-1 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-50"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
      {policy.mode === "custom" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canPick && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void pick()}
              className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
            >
              <FolderOpen size={14} /> {t("botAccess.dirAccess.addFolder")}
            </button>
          )}
          {adding ? (
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addDir(draftPath);
              }}
            >
              <input
                className={cn(inputCls, "font-mono text-[13px]")}
                aria-label={t("botAccess.dirAccess.addPath")}
                placeholder={t("botAccess.dirAccess.pathPlaceholder")}
                value={draftPath}
                autoFocus
                onChange={(e) => setDraftPath(e.target.value)}
              />
              <button type="submit" disabled={saving || !draftPath.trim()} className="shrink-0 rounded-lg bg-control px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">
                {t("botAccess.dirAccess.add")}
              </button>
              <button type="button" onClick={() => { setAdding(false); setDraftPath(""); }} className="shrink-0 rounded-lg px-2 py-1.5 text-[13px] text-ink-secondary hover:text-ink">
                {t("common.cancel")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
            >
              <Plus size={14} /> {t("botAccess.dirAccess.addPath")}
            </button>
          )}
        </div>
      )}
      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      <div className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-secondary">
        <ShieldCheck size={13} className="shrink-0" />
        <span>{t(enforcementKey(driverKind))}</span>
      </div>
    </div>
  );
}
