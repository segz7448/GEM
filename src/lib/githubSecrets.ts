import Constants from 'expo-constants';
import * as sealedbox from 'tweetnacl-sealedbox-js';

const extra = Constants.expoConfig?.extra ?? {};
const TOKEN: string = extra.GITHUB_TOKEN ?? '';
const OWNER: string = extra.GITHUB_OWNER ?? '';
const REPO: string = extra.GITHUB_REPO ?? '';
const API_ROOT = 'https://api.github.com';

/**
 * Writes real repo secrets (FCM_DEVICE_TOKEN, signing keystore material, etc.) directly
 * from the device — no manual copy-paste into GitHub's web UI required.
 *
 * GitHub never accepts a secret value in plaintext, even over HTTPS: it requires the
 * value to be sealed-box-encrypted client-side against the repo's current public key
 * first (https://docs.github.com/en/rest/actions/secrets). That's a libsodium primitive
 * (crypto_box_seal) — tweetnacl-sealedbox-js implements it on top of tweetnacl, which is
 * pure JS and Hermes-safe, so no native crypto module is needed.
 *
 * Secret *values* are never readable back through this API (or GitHub's own UI) once
 * set — only names and update timestamps. That's intentional on GitHub's side.
 */

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} on ${path}: ${body}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface RepoSecretSummary {
  name: string;
  updatedAt: string;
}

interface PublicKeyResponse {
  key_id: string;
  key: string; // base64
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 !== undefined ? b1 >> 4 : 0)];
    result += b1 !== undefined ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 !== undefined ? b2 >> 6 : 0)] : '=';
    result += b2 !== undefined ? BASE64_CHARS[b2 & 0x3f] : '=';
  }
  return result;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  let bits = '';
  for (const ch of clean) {
    const idx = BASE64_CHARS.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(6, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

/** Manual UTF-8 encoder — mirrors zipUtils.ts's/githubClient.ts's approach of never relying on `TextEncoder` being present in Hermes. */
function utf8ToBytes(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let codePoint = str.codePointAt(i)!;
    if (codePoint > 0xffff) i++; // consumed a surrogate pair
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

/** Lists secret names + last-updated timestamps for the configured repo. Values are never returned by GitHub. */
export async function listRepoSecrets(): Promise<RepoSecretSummary[]> {
  const data = await gh<{ secrets: { name: string; updated_at: string }[] }>(`/repos/${OWNER}/${REPO}/actions/secrets`);
  return data.secrets.map((s) => ({ name: s.name, updatedAt: s.updated_at }));
}

/** Encrypts `value` against the repo's current public key and upserts it as `name`. */
export async function setRepoSecret(name: string, value: string): Promise<void> {
  const pk = await gh<PublicKeyResponse>(`/repos/${OWNER}/${REPO}/actions/secrets/public-key`);
  const publicKeyBytes = base64ToBytes(pk.key);
  const messageBytes = utf8ToBytes(value);
  const encryptedBytes = sealedbox.seal(messageBytes, publicKeyBytes);
  const encryptedValueBase64 = bytesToBase64(encryptedBytes);

  await gh(`/repos/${OWNER}/${REPO}/actions/secrets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ encrypted_value: encryptedValueBase64, key_id: pk.key_id }),
  });
}

export async function deleteRepoSecret(name: string): Promise<void> {
  await gh(`/repos/${OWNER}/${REPO}/actions/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

/** Base64-encodes an arbitrary local file for use as a secret value (e.g. an Android keystore). */
export async function encodeFileAsBase64Secret(localUri: string): Promise<string> {
  const FileSystem = await import('expo-file-system');
  return FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
}

/** The secret names GEM's own workflow templates look for — surfaced in the Secrets screen as one-tap targets. */
export const KNOWN_SECRETS = [
  { name: 'FCM_DEVICE_TOKEN', description: 'This device\u2019s FCM token, for build-status push notifications.' },
  { name: 'FIREBASE_SERVICE_ACCOUNT_JSON', description: 'Firebase service account key JSON, used to authenticate FCM sends.' },
  { name: 'ANDROID_KEYSTORE_BASE64', description: 'Base64-encoded release signing keystore (.jks).' },
  { name: 'ANDROID_KEYSTORE_PASSWORD', description: 'Password for the keystore file.' },
  { name: 'ANDROID_KEY_ALIAS', description: 'Alias of the signing key inside the keystore.' },
  { name: 'ANDROID_KEY_PASSWORD', description: 'Password for that specific key alias.' },
] as const;
