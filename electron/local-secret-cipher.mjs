// macOS ad-hoc builds change code identity on every build, so the Keychain key
// behind safeStorage never matches the old ACL and every upgrade asks for
// access again. Electron 43's safeStorage.setUsePlainTextEncryption is a no-op
// off Linux, so the local stores here switch to a random key in a 0600 file
// (protected by file permissions and FileVault) via AES-256-GCM. Blobs with
// the OMBS1 header never touch safeStorage, so once a store is migrated the
// Keychain (and its prompts) are never used again. A blob without the header
// still decrypts through the legacy adapter once and is rewritten in place,
// with a .premigration backup kept beside the original; if that legacy
// decryption fails, the file stays legacy and the caller sees the same
// unreadable-store path it had before this module existed.
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes as nodeRandomBytes } from "node:crypto";

const MAGIC = "OMBS1";
const KEY_BYTES = 32, IV_BYTES = 12, TAG_BYTES = 16;

export const KEY_FILE_NAME = "local-secret.key";

export function isLocalCipherBlob(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > MAGIC.length && buffer.subarray(0, MAGIC.length).toString("ascii") === MAGIC;
}

export function sealWithLocalKey(key, plaintext, { randomBytes = nodeRandomBytes } = {}) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const sealed = Buffer.concat([Buffer.from(MAGIC, "ascii"), iv, cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return sealed;
}

/** null for a wrong key, a tampered blob, or anything that is not this format's payload. */
export function openWithLocalKey(key, buffer) {
  if (!isLocalCipherBlob(buffer)) return null;
  const body = buffer.subarray(MAGIC.length);
  if (body.length <= IV_BYTES + TAG_BYTES) return null;
  const iv = body.subarray(0, IV_BYTES);
  const tag = body.subarray(body.length - TAG_BYTES);
  const ciphertext = body.subarray(IV_BYTES, body.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The key file is one random key shared by every local store. A symlink is refused: the stores open
 * their files with O_NOFOLLOW, and the key must never be weaker than that. */
export function readOrCreateLocalKey(keyFile, { readFile = (f) => fs.readFileSync(f), lstatSync = fs.lstatSync, mkdirSync = fs.mkdirSync, writeFileSync = fs.writeFileSync, randomBytes = nodeRandomBytes } = {}) {
  let existing = null;
  try {
    existing = lstatSync(keyFile);
  } catch {
    existing = null;
  }
  if (existing) {
    if (existing.isSymbolicLink()) throw new Error("local secret key is a symlink");
    try {
      const key = readFile(keyFile);
      if (key.length !== KEY_BYTES) throw new Error("local secret key has the wrong size");
      return key;
    } catch (error) {
      if (error?.message?.startsWith("local secret key")) throw error;
      throw new Error("local secret key could not be read");
    }
  }
  try {
    mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
    writeFileSync(keyFile, randomBytes(KEY_BYTES), { mode: 0o600, flag: "wx" });
    return readFile(keyFile);
  } catch {
    throw new Error("local secret key could not be created");
  }
}

const decryptedText = (decrypted) => (typeof decrypted === "string" ? decrypted : decrypted?.result);

/** Wraps one store's encryption adapter. On macOS the local key replaces safeStorage; on the other
 * platforms the legacy adapter passes through untouched (Windows DPAPI and the Linux backends have
 * no ad-hoc-signing ACL problem). `file` is only needed to migrate that store's legacy blob. */
export function createLocalSecretEncryption({ file, keyFile, legacy, log = () => {}, platform = process.platform, io = fs }) {
  if (platform !== "darwin") {
    return { mode: "os", available: legacy.available, encrypt: legacy.encrypt, decrypt: legacy.decrypt };
  }

  let key = null, announced = false;
  const ensureKey = () => {
    key ??= readOrCreateLocalKey(keyFile, { readFile: (f) => io.readFileSync(f), lstatSync: io.lstatSync, mkdirSync: io.mkdirSync, writeFileSync: io.writeFileSync });
    return key;
  };
  const announce = (message) => {
    if (announced) return;
    announced = true;
    log(message);
  };
  const useFallback = (why) => {
    announce(`local secret key unusable (${why}); this store falls back to the operating-system credential store`);
    return legacy;
  };

  // The rewritten file is only committed when it still holds the exact bytes this decryption read;
  // a concurrent write has already replaced the blob, and the next read migrates that one instead.
  const migrate = async (input, plaintext) => {
    try {
      const current = io.readFileSync(file);
      if (!current.equals(input)) return;
      const backup = `${file}.premigration`;
      io.copyFileSync(file, backup);
      const sealed = sealWithLocalKey(ensureKey(), plaintext);
      const temporary = `${file}.migrating-${process.pid}.tmp`;
      io.writeFileSync(temporary, sealed, { mode: 0o600 });
      io.renameSync(temporary, file);
      log(`migrated ${path.basename(file)} to the local secret key; the Keychain is no longer used for it`);
    } catch (error) {
      log(`kept ${path.basename(file)} on the operating-system credential store: ${error?.message ?? error}`);
    }
  };

  return {
    mode: "local",
    async available() {
      try {
        ensureKey();
        announce("credential encryption: local secret key (the Keychain is not used)");
        return true;
      } catch (error) {
        announce(`credential encryption fallback: ${error?.message ?? error}`);
        return legacy.available();
      }
    },
    async encrypt(value) {
      try {
        return sealWithLocalKey(ensureKey(), value);
      } catch (error) {
        const fallback = useFallback(error?.message ?? error);
        return fallback.encrypt(value);
      }
    },
    async decrypt(buffer) {
      if (isLocalCipherBlob(buffer)) {
        // Never hand our own blobs to the legacy adapter: on macOS even a failed
        // decryption would reach the Keychain and could prompt.
        const text = openWithLocalKey(ensureKey(), buffer);
        if (text === null) throw new Error("the local secret key no longer opens this record");
        return { result: text, shouldReEncrypt: false };
      }
      let decrypted;
      try {
        decrypted = await legacy.decrypt(buffer);
      } catch (error) {
        log(`${path.basename(file)} could not be decrypted with the operating-system credential store (${error?.message ?? error}); it stays there this launch`);
        throw error;
      }
      const text = decryptedText(decrypted);
      if (typeof text !== "string") return decrypted;
      await migrate(buffer, text);
      return { result: text, shouldReEncrypt: false };
    },
  };
}
