// A test that isolates by stubbing HOME and importing the server afresh must get a data folder under that HOME.
// setup.ts once pinned OMB_DATA_DIR for the whole file instead, which let bots and settings leak from test to test
// (server/package-import.test.ts imported a team into the previous test's store).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

it("the data folder follows the HOME a test stubs: setup.ts pins no OMB_DATA_DIR", async () => {
  expect(process.env.OMB_DATA_DIR).toBeUndefined();
  const first = mkdtempSync(join(tmpdir(), "omb-follow-home-"));
  vi.stubEnv("HOME", first);
  vi.stubEnv("USERPROFILE", first);
  vi.resetModules();
  const one = await import("../config.ts");
  expect(one.DATA_DIR.startsWith(first)).toBe(true);
  const second = mkdtempSync(join(tmpdir(), "omb-follow-home-"));
  vi.stubEnv("HOME", second);
  vi.stubEnv("USERPROFILE", second);
  vi.resetModules();
  const two = await import("../config.ts");
  expect(two.DATA_DIR.startsWith(second)).toBe(true);
  expect(two.DATA_DIR.startsWith(first)).toBe(false);
});
