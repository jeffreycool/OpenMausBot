// The dirAccess PATCH channel on a real server: a new bot starts confined to its own folders, an admin may widen it
// or add allowlist folders, malformed shapes are refused, and clearing returns the bot to unrestricted.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";
import { removeTempDir } from "./testing/cleanup.ts";

let fixture: VerificationServer | undefined;
let scratch: string;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
  removeTempDir(scratch);
});

it("creates bots confined to their own folders and takes dirAccess patches through validation", async () => {
  scratch = mkdtempSync(join(tmpdir(), "omb-dir-access-e2e-"));
  const allowed = join(scratch, "shared-reports");
  mkdirSync(allowed);
  fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_VERSION: "2.1.284" });
  const url = fixture.info.url;
  const api = async (method: string, path: string, body?: unknown, status?: number) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json() as any;
    if (status !== undefined) expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    else expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBeLessThan(300);
    return value;
  };

  // A new bot inherits the workspace-only default even with no saved template.
  const created = await api("POST", "/api/bots", { name: "Scout", useDefaults: true });
  expect(created.bot.dirAccess).toEqual({ mode: "workspace" });

  // An API bot with explicit settings but no dirAccess gets the same default, not the template's absence.
  const widened = await api("POST", "/api/bots", { name: "Veteran", useDefaults: false });
  expect(widened.bot.dirAccess).toEqual({ mode: "workspace" });
  const patched = await api("PATCH", `/api/bots/${widened.bot.id}`, { dirAccess: { mode: "custom", extraDirs: [allowed] } });
  expect(patched.bot.dirAccess).toEqual({ mode: "custom", extraDirs: [allowed] });

  // Malformed shapes and missing folders are refused.
  for (const bad of [{ mode: "everywhere" }, { mode: "custom", extraDirs: ["relative/path"] }, { mode: "custom", extraDirs: [join(scratch, "missing")] }, { mode: "workspace", stub: 1 }]) {
    await api("PATCH", `/api/bots/${widened.bot.id}`, { dirAccess: bad }, 400);
  }

  // Clearing the policy returns the bot to unrestricted.
  const cleared = await api("PATCH", `/api/bots/${widened.bot.id}`, { dirAccess: null });
  expect(cleared.bot.dirAccess).toBeUndefined();

  // The saved template accepts dirAccess, so defaults carry it to the next bot.
  await api("PATCH", "/api/config", { newBotDefaults: { profile: { dirAccess: { mode: "open" } } } });
  const opened = await api("POST", "/api/bots", { name: "Freer", useDefaults: true });
  expect(opened.bot.dirAccess).toEqual({ mode: "open" });
}, 120_000);
