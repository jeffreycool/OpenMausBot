// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { DataFolderSettings } from "./DataFolderSettings";

const fixture = vi.hoisted(() => ({ api: vi.fn(), copy: vi.fn(), outcome: "copied" as string }));
vi.mock("@/state/store", () => ({ api: fixture.api }));
// The clipboard itself is not this row's to test: the copy hook is replaced by one that reports what it is told.
vi.mock("@/lib/copy-text", async () => {
  const { useState } = await import("react");
  return {
    useCopyFeedback: (text: string) => {
      const [state, setState] = useState("idle");
      return { state, copy: () => { fixture.copy(text); setState(fixture.outcome); } };
    },
  };
});

let host: HTMLDivElement;
let root: Root;
const CURRENT = "/Users/me/.tappoteambot", OLD = "/Users/me/.openmausbot";
const COMMAND = `ELECTRON_RUN_AS_NODE=1 '/Applications/TappoTeamBot.app/Contents/MacOS/TappoTeamBot' '/Applications/TappoTeamBot.app/Contents/Resources/server/openmausbot.js' migrate-data`;
const show = (config: unknown) => {
  fixture.api.mockResolvedValue(config);
  flushSync(() => root.render(createElement(DataFolderSettings)));
};

beforeEach(() => {
  vi.clearAllMocks();
  setLocale("en");
  fixture.outcome = "copied";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  root.unmount();
  host.remove();
});

describe("DataFolderSettings", () => {
  it("is not there when the server does not name the folder (a person who is not the admin)", () => {
    show({ instances: {} });
    expect(host.innerHTML).toBe("");
    expect(fixture.api).toHaveBeenCalledWith("/api/config");
  });

  it("names the folder, and says nothing more, while it is under the current name", async () => {
    await vi.waitFor(() => {
      show({ dataDir: CURRENT, legacyDataDir: null, migrateCommand: "openmausbot migrate-data" });
      expect(host.querySelector("[data-data-dir]")?.textContent).toBe(CURRENT);
    });
    expect(host.querySelector("[data-data-dir-legacy]")).toBeNull();
    expect(host.querySelector("[data-migrate-command]")).toBeNull();
    expect(host.querySelector("[data-data-dir-unused]")).toBeNull();
    expect(host.querySelector("button")).toBeNull();
  });

  it("when an earlier-named folder is still there beside the current one: says it is not used, and offers no command", async () => {
    const OLDEST = "/Users/me/.opengrokbot";
    await vi.waitFor(() => {
      show({ dataDir: CURRENT, legacyDataDir: null, migrateCommand: "openmausbot migrate-data", unusedDataDirs: [OLD, OLDEST] });
      expect(host.querySelector("[data-data-dir-unused]")?.textContent).toBe(
        `An old data folder is still on this computer, and is not used: ${OLD}, ${OLDEST}. The app uses the folder above.`);
    });
    expect(host.querySelector("[data-data-dir]")?.textContent).toBe(CURRENT);
    expect(host.querySelector("[data-data-dir-legacy]")).toBeNull();
    expect(host.querySelector("[data-migrate-command]")).toBeNull();
    expect(host.querySelector("button")).toBeNull();
  });

  it("while the data is still in the old folder: says so, shows the whole command, and copies it on request", async () => {
    await vi.waitFor(() => {
      show({ dataDir: OLD, legacyDataDir: OLD, migrateCommand: COMMAND });
      expect(host.querySelector("[data-data-dir]")?.textContent).toBe(OLD);
    });
    expect(host.querySelector("[data-data-dir-legacy]")?.textContent).toBe(
      "Your data is still in the old folder, and works as usual. To move it to the new folder, quit the app first, then run this command:");
    expect(host.querySelector("[data-migrate-command]")?.textContent).toBe(COMMAND);
    const button = host.querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toBe("Copy command");
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe("Copied"));
    expect(fixture.copy).toHaveBeenCalledWith(COMMAND);
  });

  it("says when the copy could not be made", async () => {
    fixture.outcome = "failed";
    await vi.waitFor(() => {
      show({ dataDir: OLD, legacyDataDir: OLD, migrateCommand: COMMAND });
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Could not copy"));
  });
});
