import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLocalSecretEncryption, isLocalCipherBlob, openWithLocalKey, readOrCreateLocalKey, sealWithLocalKey } from "./local-secret-cipher.mjs";

const room = () => fs.mkdtempSync(path.join(os.tmpdir(), "local-secret-cipher-"));
const log = () => { const lines = []; return { lines, note: (line) => lines.push(line) }; };
/** Stands in for the pre-migration store: a "cipher" no local key could ever open, like safeStorage's. */
const legacyCipher = (shape = "string") => {
  const calls = [];
  return {
    calls,
    available: async () => true,
    encrypt: async (value) => Buffer.from(`legacy:${value}`, "utf8").toString("base64"),
    decrypt: async (buffer) => {
      calls.push(Buffer.from(buffer));
      const text = Buffer.from(buffer.toString("utf8"), "base64").toString("utf8");
      assert.match(text, /^legacy:/, "the fixture only decrypts its own blobs");
      return shape === "string" ? text.slice("legacy:".length) : { result: text.slice("legacy:".length), shouldReEncrypt: false };
    },
  };
};
const adapter = ({ dir, name = "credentials.bin", legacy = legacyCipher(), platform = "darwin", io = fs, note = log().note, keyFile = path.join(dir, "local-secret.key") }) =>
  createLocalSecretEncryption({ file: path.join(dir, name), keyFile, legacy, platform, io, log: note });
const readFile = (file) => fs.readFileSync(file);
const writeLegacy = (file, value) => fs.writeFileSync(file, Buffer.from(`legacy:${value}`, "utf8").toString("base64"));

test("a sealed blob opens only with its own key", () => {
  const key = Buffer.alloc(32, 7), other = Buffer.alloc(32, 9);
  const sealed = sealWithLocalKey(key, "secret value");
  assert.equal(isLocalCipherBlob(sealed), true);
  assert.equal(openWithLocalKey(key, sealed), "secret value");
  assert.equal(openWithLocalKey(other, sealed), null);
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 1] ^= 0xff;
  assert.equal(openWithLocalKey(key, tampered), null);
  assert.equal(openWithLocalKey(key, Buffer.from("v10-not-ours")), null);
  assert.equal(isLocalCipherBlob(Buffer.alloc(0)), false);
});

test("the key file is created once at 0600 and reused, not overwritten", () => {
  const dir = room(), keyFile = path.join(dir, "local-secret.key");
  const key = readOrCreateLocalKey(keyFile);
  assert.equal(key.length, 32);
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.deepEqual(readOrCreateLocalKey(keyFile), key);
  fs.writeFileSync(keyFile, Buffer.alloc(16));
  assert.throws(() => readOrCreateLocalKey(keyFile), /wrong size/);
  fs.rmSync(keyFile);
  fs.symlinkSync(path.join(dir, "elsewhere"), keyFile);
  assert.throws(() => readOrCreateLocalKey(keyFile), /symlink/);
});

test("a legacy blob decrypts once, is rewritten in place, and keeps a .premigration backup", async () => {
  const dir = room(), file = path.join(dir, "credentials.bin");
  writeLegacy(file, '{"apiKey":"ak_live"}');
  const legacy = legacyCipher();
  const { lines, note } = log();
  const store = adapter({ dir, legacy, note });
  const decrypted = await store.decrypt(readFile(file));
  assert.equal(decrypted.result, '{"apiKey":"ak_live"}');
  assert.equal(decrypted.shouldReEncrypt, false);
  assert.equal(legacy.calls.length, 1);
  assert.equal(isLocalCipherBlob(readFile(file)), true);
  const again = await store.decrypt(readFile(file));
  assert.equal(again.result, decrypted.result, "the rewritten blob reads back the same");
  assert.equal(legacy.calls.length, 1, "a migrated store never asks the legacy cipher again");
  const backup = readFile(`${file}.premigration`);
  assert.equal(backup.toString("utf8"), Buffer.from(`legacy:{"apiKey":"ak_live"}`, "utf8").toString("base64"));
  assert.match(lines.join("\n"), /migrated credentials\.bin/);
});

test("a corrupt local blob fails without ever reaching the legacy cipher", async () => {
  const dir = room(), file = path.join(dir, "credentials.bin");
  const legacy = legacyCipher();
  const store = adapter({ dir, legacy });
  const sealed = await store.encrypt("payload");
  sealed[sealed.length - 1] ^= 0xff;
  fs.writeFileSync(file, sealed);
  await assert.rejects(store.decrypt(sealed), /no longer opens/);
  assert.equal(legacy.calls.length, 0, "safeStorage is not touched for local blobs");
});

test("a legacy blob that cannot be decrypted stays legacy and the error travels", async () => {
  const dir = room(), file = path.join(dir, "credentials.bin");
  writeLegacy(file, "value");
  const legacy = legacyCipher();
  legacy.decrypt = async () => { throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString."); };
  const { lines, note } = log();
  const store = adapter({ dir, legacy, note });
  await assert.rejects(store.decrypt(readFile(file)), /safeStorage/);
  const silence = log();
  assert.equal(readFile(file).toString("utf8"), Buffer.from("legacy:value", "utf8").toString("base64"), "the original file is untouched");
  const retry = adapter({ dir, legacy, note: silence.note });
  await assert.rejects(retry.decrypt(readFile(file)));
  assert.match(lines.join("\n"), /stays there this launch/);
});

test("a concurrent rewrite wins over the migration, which leaves the newer bytes alone", async () => {
  const dir = room(), file = path.join(dir, "credentials.bin");
  writeLegacy(file, "old");
  const legacy = legacyCipher();
  const store = adapter({ dir, legacy });
  const input = readFile(file);
  legacy.decrypt = async (buffer) => {
    writeLegacy(file, "newer");
    return Buffer.from(buffer.toString("utf8"), "base64").toString("utf8").slice("legacy:".length);
  };
  await store.decrypt(input);
  assert.equal(readFile(file).toString("utf8"), Buffer.from("legacy:newer", "utf8").toString("base64"), "the newer write was not clobbered");
  assert.equal(fs.existsSync(`${file}.premigration`), false, "no backup is taken for a skipped migration");
});

test("records persist across a restart: a fresh adapter opens what the last one sealed", async () => {
  const dir = room();
  const first = adapter({ dir });
  assert.equal(await first.available(), true);
  fs.writeFileSync(path.join(dir, "credentials.bin"), await first.encrypt(JSON.stringify({ openaiApiKey: "sk-1" })));
  const { lines, note } = log();
  const second = adapter({ dir, note });
  assert.equal(await second.available(), true);
  const decrypted = await second.decrypt(readFile(path.join(dir, "credentials.bin")));
  assert.equal(decrypted.result, JSON.stringify({ openaiApiKey: "sk-1" }));
  assert.match(lines.join("\n"), /local secret key/);
});

test("an unwritable key location falls back to the operating-system cipher", async () => {
  const dir = room();
  const legacy = legacyCipher("dict");
  const { lines, note } = log();
  const io = {
    ...fs,
    writeFileSync: (..._args) => { throw new Error("disk full"); },
  };
  const store = adapter({ dir, legacy, io, note });
  assert.equal(await store.available(), true, "legacy availability carries the answer");
  const encrypted = await store.encrypt("fallback value");
  assert.match(Buffer.from(encrypted.toString("utf8"), "base64").toString("utf8"), /^legacy:/);
  assert.match(lines.join("\n"), /falls back to the operating-system credential store|credential encryption fallback/);
});

test("off macOS the legacy adapter passes through untouched", async () => {
  const dir = room(), file = path.join(dir, "credentials.bin");
  writeLegacy(file, "value");
  const legacy = legacyCipher();
  const { note } = log();
  const store = adapter({ dir, legacy, platform: "win32", note });
  const encrypted = await store.encrypt("value");
  assert.match(Buffer.from(encrypted.toString("utf8"), "base64").toString("utf8"), /^legacy:/);
  const decrypted = await store.decrypt(encrypted);
  assert.equal(decrypted, "value", "the raw legacy shape is returned unchanged");
  assert.equal(fs.existsSync(path.join(dir, "local-secret.key")), false, "no local key is created");
});
