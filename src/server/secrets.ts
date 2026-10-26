// Encryption at rest for calendar credentials (CalDAV passwords, Google tokens, secret feed URLs).
// The key is derived (HKDF-SHA-256) from APP_SECRET, or from a random secret generated once and kept
// in DATA_DIR/app-secret with mode 0600. Values are sealed with AES-256-GCM; the row id is bound in
// as additional data so a ciphertext can't be moved to another row.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { appSecret } from "./config.ts";
import { dbFile } from "./backup.ts";
import { dataDir, type Db } from "./db.ts";

const keys = new Map<string, Buffer>();
export const resetSecretCache = () => keys.clear();

const derive = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "ribbon.app-secret.v1", "ribbon:credentials", 32));

function secretFile(db: Db): string {
  const file = dbFile(db);
  return join(file ? dirname(file) : dataDir(), "app-secret");
}

/** The 32-byte key. Throws a plain Error if APP_SECRET is too short. */
export function appKey(db: Db): Buffer {
  const env = appSecret();
  if (env) {
    if (env.length < 16) throw new Error("APP_SECRET must be at least 16 characters (try: openssl rand -base64 32).");
    return derive(`env:${env}`);
  }
  const path = secretFile(db);
  const cached = keys.get(path);
  if (cached) return cached;
  let secret: string;
  if (existsSync(path)) {
    secret = readFileSync(path, "utf8").trim();
    try {
      chmodSync(path, 0o600);
    } catch {
      /* not ours to change */
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    secret = randomBytes(32).toString("base64url");
    try {
      const fd = openSync(path, "wx", 0o600); // exclusive: two starts can't write different secrets
      writeSync(fd, `${secret}\n`);
      closeSync(fd);
    } catch {
      secret = readFileSync(path, "utf8").trim(); // lost the race: use the winner's
    }
  }
  if (secret.length < 16) throw new Error(`${path} is empty or too short. Delete it to have a new one made (saved calendar logins will need to be entered again).`);
  const key = derive(`file:${secret}`);
  keys.set(path, key);
  return key;
}

/** "v1.<iv>.<tag>.<ciphertext>" (base64url). `bind` ties it to one row. */
export function seal(db: Db, plaintext: string, bind: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", appKey(db), iv);
  cipher.setAAD(Buffer.from(bind));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** The plaintext, or null when the value is damaged, belongs to another row, or the key changed. */
export function open(db: Db, sealed: string | null | undefined, bind: string): string | null {
  if (!sealed) return null;
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) return null;
  const key = appKey(db); // a missing or unusable key is an error to report, not "damaged data"
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(bind));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
