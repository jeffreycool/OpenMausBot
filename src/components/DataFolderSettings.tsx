import { useEffect, useState } from "react";

import { useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { SettingRow } from "./SettingsPrimitives";

interface DataFolder { dataDir?: string; legacyDataDir?: string | null; migrateCommand?: string; unusedDataDirs?: string[] }

/** Settings → Data: where the data is. While that is still a folder under an earlier name (~/.openmausbot, used where it
 * is), the row says so and gives the one command that moves it: a line to read, never a prompt. When an earlier-named
 * folder is still there beside the current one, the row says that it is not used: the command cannot merge two folders,
 * so none is offered. The server names the folder only to an admin, so for everyone else there is no row. */
export function DataFolderSettings() {
  const [folder, setFolder] = useState<DataFolder | null>(null);
  const { state, copy } = useCopyFeedback(folder?.migrateCommand ?? "");
  useEffect(() => {
    let live = true;
    api("/api/config").then((body) => { if (live) setFolder(body as DataFolder); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!folder?.dataDir) return null;
  const legacy = Boolean(folder.legacyDataDir && folder.migrateCommand);
  const unused = legacy ? [] : (folder.unusedDataDirs ?? []);
  return (
    <SettingRow
      title={t("settings.data.folder")}
      subtitle={<>
        <span data-data-dir className="block break-all">{folder.dataDir}</span>
        {legacy && <span data-data-dir-legacy className="block">{t("settings.data.folderLegacy")}</span>}
        {legacy && <code data-migrate-command className="block break-all">{folder.migrateCommand}</code>}
        {legacy && state === "failed" && <span className="block text-danger">{t("common.copyFailed")}</span>}
        {unused.length > 0 && <span data-data-dir-unused className="block break-all">{t("settings.data.folderUnused", { path: unused.join(", ") })}</span>}
      </>}
    >
      {legacy && <button type="button" onClick={copy} className="ui-button">
        {state === "copied" ? t("settings.data.commandCopied") : t("settings.data.copyCommand")}
      </button>}
    </SettingRow>
  );
}
