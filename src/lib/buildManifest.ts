import * as Crypto from 'expo-crypto';
import type { ProjectFile } from './zipUtils';
import type { ManifestEntry } from './db';

/** Hashes every file in an extracted upload — text files by content, binaries by their base64 payload (sufficient for change detection, doesn't need to be a "true" byte hash). */
export async function buildManifest(files: ProjectFile[]): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  for (const file of files) {
    const payload = file.isBinary ? file.base64 ?? '' : file.text ?? '';
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload);
    entries.push({ path: file.path, hash, size: payload.length });
  }
  return entries;
}

export interface ManifestDiff {
  added: string[];
  removed: string[];
  modified: string[];
  unchangedCount: number;
}

/** Compares a new manifest against the previous completed build's manifest for the same app. */
export function diffManifests(previous: ManifestEntry[] | null, next: ManifestEntry[]): ManifestDiff {
  if (!previous) {
    return { added: next.map((f) => f.path), removed: [], modified: [], unchangedCount: 0 };
  }

  const prevByPath = new Map(previous.map((f) => [f.path, f]));
  const nextByPath = new Map(next.map((f) => [f.path, f]));

  const added: string[] = [];
  const modified: string[] = [];
  let unchangedCount = 0;

  for (const [path, entry] of nextByPath) {
    const prevEntry = prevByPath.get(path);
    if (!prevEntry) added.push(path);
    else if (prevEntry.hash !== entry.hash) modified.push(path);
    else unchangedCount++;
  }

  const removed = [...prevByPath.keys()].filter((path) => !nextByPath.has(path));

  return { added, removed, modified, unchangedCount };
}
