// The default place ("This computer") is whatever desktopDataDir() answers: the data folder under its current name, or
// one still under an earlier name, used where it is. A start never moves it; `openmausbot migrate-data` does. These hold
// the place's identity to that folder on both sides of the move.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveDataDir } from "./desktop-data-dir.mjs";

const require = createRequire(import.meta.url);
const places = require("./environments.cjs");

test("an earlier-named folder is the default place where it is, cannot become a named environment, and is not one after the move", () => {
  const home = mkdtempSync(join(tmpdir(), "omb-default-place-"));
  try {
    const legacy = join(home, ".openmausbot");
    mkdirSync(legacy);
    const before = resolveDataDir({ home, env: {} });
    assert.equal(before.dir, legacy);
    const state = { environments: [], activeId: "local" };
    assert.deepEqual(places.bootEnvironmentDir(state, before.dir), { dataDir: legacy, fellBack: false, missingDir: null });
    assert.equal(places.startupEnvironmentDir(state, before.dir), legacy);
    // The default folder itself, and anything inside it, is "This computer": it is never saved as a named environment.
    assert.deepEqual(places.withLocalEnvironment(state, { name: "Old name", dataDir: legacy }, () => "id-1", before.dir), { ok: false, error: "nested" });
    assert.deepEqual(places.withLocalEnvironment(state, { name: "Inside", dataDir: join(legacy, "nested") }, () => "id-2", before.dir), { ok: false, error: "nested" });
    assert.deepEqual(state.environments, []);

    // Another local folder is a named environment as usual, and the move below leaves it exactly as it was.
    const added = places.withLocalEnvironment(state, { name: "Lab", dataDir: join(home, ".openmausbot-lab") }, () => "id-3", before.dir);
    assert.equal(added.ok, true);

    const current = join(home, ".tappoteambot");
    renameSync(legacy, current);
    const after = resolveDataDir({ home, env: {} });
    assert.deepEqual(after, { dir: current, legacy: null });
    assert.deepEqual(places.bootEnvironmentDir(added.state, after.dir), { dataDir: current, fellBack: false, missingDir: null });
    assert.equal(places.startupEnvironmentDir(added.state, after.dir), current);
    assert.deepEqual(added.state.environments.map((entry) => [entry.id, entry.dataDir]), [["id-3", join(home, ".openmausbot-lab")]]);
    assert.equal(added.state.environments.some((entry) => entry.dataDir === legacy || entry.dataDir === current), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
