import * as FileSystem from 'expo-file-system';
import JSZip from 'jszip';
import { getDefaultRules, isIgnored, filterIgnoredEntries } from './gitignoreMatcher';

export interface ProjectFile {
  path: string;
  isBinary: boolean;
  text?: string;
  base64?: string;
}

// Reading a zip fully into memory as base64 (JS string) roughly triples its
// footprint (original bytes + base64 string + JSZip's internal unpacked
// buffers). Above this size, low-RAM Android phones are prone to the JS
// engine getting OOM-killed with no error surfaced to the user — it just
// looks like "extraction stuck." These thresholds and the guard logic below
// are ported from GitManager, which hit and fixed this exact failure mode.
export const SAFE_ZIP_BYTES = 150 * 1024 * 1024; // 150MB
export const HARD_LIMIT_ZIP_BYTES = 400 * 1024 * 1024; // 400MB

/** Checks a picked zip's size before anything is read into memory, so oversized files fail fast with a clear message instead of silently hanging. */
export async function checkZipSize(localUri: string): Promise<{ sizeBytes: number; overHardLimit: boolean; overSafeLimit: boolean }> {
  const info = await FileSystem.getInfoAsync(localUri, { size: true });
  const sizeBytes = info.exists && 'size' in info ? info.size : 0;
  return { sizeBytes, overHardLimit: sizeBytes > HARD_LIMIT_ZIP_BYTES, overSafeLimit: sizeBytes > SAFE_ZIP_BYTES };
}

// Yields to the JS event loop so React can flush a re-render (e.g. an
// updated progress percentage) between synchronous-ish extraction chunks.
// Without this, progress updates get batched and never painted until the
// whole operation finishes — large projects look frozen even though
// they're working. Also ported from GitManager.
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const BINARY_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.jar', '.zip', '.ttf', '.otf', '.so', '.keystore', '.jks'];

function isBinaryPath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return BINARY_EXT.includes(ext);
}

/** Reads an uploaded zip (from expo-document-picker's local URI) into an in-memory file list. Zip-Slip guarded. */
export async function extractUploadZip(localUri: string): Promise<ProjectFile[]> {
  const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const zip = await JSZip.loadAsync(base64, { base64: true });

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const entry of entries) {
    if (entry.name.includes('..') || entry.name.startsWith('/')) {
      throw new Error(`Rejected zip entry escaping workspace (Zip Slip attempt): ${entry.name}`);
    }
  }

  // Flatten a single top-level wrapper folder, same as the previous
  // server-side behavior, so the project root lines up with expected paths.
  const topLevelDirs = new Set(entries.map((e) => e.name.split('/')[0]));
  const singleRoot = topLevelDirs.size === 1 && entries.every((e) => e.name.includes('/')) ? [...topLevelDirs][0] : null;
  const stripPrefix = singleRoot ? `${singleRoot}/` : '';

  const files: ProjectFile[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.name.includes('__MACOSX') || entry.name.includes('/.git/')) continue;
    const relPath = entry.name.startsWith(stripPrefix) ? entry.name.slice(stripPrefix.length) : entry.name;
    if (!relPath) continue;
    const binary = isBinaryPath(relPath);
    if (binary) {
      files.push({ path: relPath, isBinary: true, base64: await entry.async('base64') });
    } else {
      files.push({ path: relPath, isBinary: false, text: await entry.async('text') });
    }
    if (i % 25 === 0) await yieldToUI();
  }
  return files;
}

/** Extracts the first .apk found inside a base64-encoded artifact zip. */
export async function extractApkFromArtifactZip(zipBase64: string): Promise<{ name: string; base64: string }> {
  return extractFileFromArtifactZip(zipBase64, '.apk');
}

/** Same shape as extractApkFromArtifactZip, for the separate AAB artifact produced by release builds. */
export async function extractAabFromArtifactZip(zipBase64: string): Promise<{ name: string; base64: string }> {
  return extractFileFromArtifactZip(zipBase64, '.aab');
}

async function extractFileFromArtifactZip(zipBase64: string, extension: '.apk' | '.aab'): Promise<{ name: string; base64: string }> {
  const zip = await JSZip.loadAsync(zipBase64, { base64: true });
  const entry = Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().endsWith(extension));
  if (!entry) throw new Error(`No ${extension} found inside the downloaded build artifact.`);
  const base64 = await entry.async('base64');
  const name = entry.name.split('/').pop()!;
  return { name, base64 };
}

/** Concatenates the .txt step logs inside a base64-encoded run-logs zip into one text blob. */
export async function extractTextFromLogZip(zipBase64: string): Promise<string> {
  const zip = await JSZip.loadAsync(zipBase64, { base64: true });
  const parts: string[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.endsWith('.txt')) continue;
    parts.push(`===== ${entry.name} =====\n${await entry.async('text')}`);
  }
  return parts.join('\n\n');
}

/** Finds the shallowest .gitignore among extracted files (usually the project root) and returns its content, or null if none exists. */
export function findGitignoreContent(files: ProjectFile[]): string | null {
  const candidates = files
    .filter((f) => !f.isBinary && f.path.toLowerCase().endsWith('.gitignore'))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  return candidates[0]?.text ?? null;
}

export { filterIgnoredEntries } from './gitignoreMatcher';

const TEMP_ZIP_DIR = `${FileSystem.documentDirectory}temp-picked-zips/`;

async function writeZipToTemp(zip: JSZip, fileName: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(TEMP_ZIP_DIR, { intermediates: true }).catch(() => undefined);
  const base64 = await zip.generateAsync({ type: 'base64' });
  const uri = `${TEMP_ZIP_DIR}${Date.now()}-${fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

/**
 * Builds a zip from a flat list of individually-picked files (expo-document-picker
 * `multiple: true`). No folder structure is implied by this picker, so every file
 * lands at the zip root — matches what "Choose Files" means in the upload UI.
 */
export async function zipPickedFiles(files: { uri: string; name: string }[], zipName: string): Promise<string> {
  const zip = new JSZip();
  for (const file of files) {
    const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
    zip.file(file.name, base64, { base64: true });
  }
  return writeZipToTemp(zip, zipName.endsWith('.zip') ? zipName : `${zipName}.zip`);
}

/**
 * Recursively walks an Android Storage Access Framework directory tree (from
 * `StorageAccessFramework.requestDirectoryPermissionsAsync`) and zips it, preserving
 * the folder's internal structure — matches what "Choose Folder" means in the upload UI.
 * Android-only; SAF has no equivalent directory-tree API on iOS.
 *
 * Returns `possiblyIncomplete: true` if the walker had to stop descending into a
 * subfolder because of a confirmed, long-standing Expo bug (expo/expo#20102) where
 * reading a nested subfolder's contents via SAF can incorrectly return its PARENT's
 * contents instead. When that happens, re-including those "children" would just
 * duplicate already-processed files under the wrong path, so the walker stops there
 * instead of looping on bad data — but it does mean some nested files may be missing.
 * The caller should tell the user to zip the folder instead for a fully reliable
 * upload when this comes back true.
 */
export async function zipPickedDirectory(rootDirUri: string, folderName: string): Promise<{ zipUri: string; possiblyIncomplete: boolean }> {
  const SAF = FileSystem.StorageAccessFramework;
  const zip = new JSZip();
  const defaultIgnoreRules = getDefaultRules();

  // Purely a safety net against a pathological infinite loop (a platform
  // quirk that keeps returning children forever) — real folder structures
  // are essentially never this deep.
  const MAX_RECURSION_DEPTH = 25;

  const rootDocId = decodeURIComponent(rootDirUri.split('/document/')[1] ?? '');
  const state = { possiblyIncomplete: false };

  async function walk(dirUri: string, depth: number, parentListing: string[] | null) {
    if (depth > MAX_RECURSION_DEPTH) return;
    const children = await SAF.readDirectoryAsync(dirUri);

    // Defends against expo/expo#20102: if this subfolder's listing is
    // identical to its parent's, SAF handed back the wrong directory's
    // contents rather than this one's actual children. Including them
    // again would duplicate already-processed files under the wrong
    // relative path, so stop here and flag the result instead of
    // guessing at what the real contents should have been.
    if (parentListing && depth > 0 && arraysEqual(children, parentListing)) {
      state.possiblyIncomplete = true;
      return;
    }

    for (const childUri of children) {
      const childDocId = decodeURIComponent(childUri.split('/document/')[1] ?? '');
      const relPath = childDocId.startsWith(`${rootDocId}/`) ? childDocId.slice(rootDocId.length + 1) : childDocId;
      if (!relPath || relPath.includes('__MACOSX')) continue;

      // Excluding node_modules/.git/etc. HERE — before recursing in, not
      // after listing them — is what keeps this fast. .git/objects/** on a
      // real repo can hold thousands of loose objects; each one is a
      // separate SAF IPC round-trip, which is what previously made folder
      // picks hang for 15+ minutes even on small projects. Same ignore
      // list drives both this walk-time skip and the review screen's
      // "N files ignored" summary, so they never disagree with each other.
      if (isIgnored(relPath, defaultIgnoreRules)) continue;

      // SAF has no cheap "is this a directory" flag — the reliable way is to try
      // listing it as a directory; a file rejects, a directory succeeds.
      let isDir = true;
      let childListing: string[] = [];
      try {
        childListing = await SAF.readDirectoryAsync(childUri);
      } catch {
        isDir = false;
      }

      if (isDir) {
        await walk(childUri, depth + 1, children);
      } else {
        const binary = isBinaryPath(relPath);
        const content = await FileSystem.readAsStringAsync(childUri, { encoding: FileSystem.EncodingType.Base64 });
        if (binary) {
          zip.file(relPath, content, { base64: true });
        } else {
          // Decode back to text so non-binary files store as UTF-8 in the zip, matching extractUploadZip's expectations.
          const bytes = Uint8Array.from(atobPolyfill(content), (c) => c.charCodeAt(0));
          zip.file(relPath, bytesToUtf8(bytes));
        }
        void childListing; // unreachable for files (readDirectoryAsync threw) — present only to satisfy the try/catch's type
      }
    }
  }

  await walk(rootDirUri, 0, null);
  const zipUri = await writeZipToTemp(zip, `${folderName}.zip`);
  return { zipUri, possiblyIncomplete: state.possiblyIncomplete };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}


const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Minimal base64 decoder (mirrors githubClient.ts's encoder) — avoids relying on `atob` being present in Hermes. */
function atobPolyfill(b64: string): string {
  const clean = b64.replace(/=+$/, '');
  let bits = '';
  for (const ch of clean) {
    const idx = B64_CHARS.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(6, '0');
  }
  let out = '';
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    out += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
  }
  return out;
}

function bytesToUtf8(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      result += String.fromCharCode(b0);
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      result += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      result += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      const cp = ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      result += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return result;
}

/** Saves an extracted app icon into app-private storage and returns its local file URI. */
export async function saveIconLocally(buildId: string, base64: string, mimeType: string): Promise<string> {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
  const dir = `${FileSystem.documentDirectory}icons/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const uri = `${dir}${buildId}.${ext}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

/** Saves a base64 APK payload into app-private storage and returns its local file URI. */
export async function saveApkLocally(buildId: string, fileName: string, base64: string): Promise<{ uri: string; sizeBytes: number }> {
  return saveArtifactLocally('apks', buildId, fileName, base64);
}

/** Same shape as saveApkLocally, for the AAB produced alongside a release APK. */
export async function saveAabLocally(buildId: string, fileName: string, base64: string): Promise<{ uri: string; sizeBytes: number }> {
  return saveArtifactLocally('aabs', buildId, fileName, base64);
}

async function saveArtifactLocally(subdir: string, buildId: string, fileName: string, base64: string): Promise<{ uri: string; sizeBytes: number }> {
  const dir = `${FileSystem.documentDirectory}${subdir}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const uri = `${dir}${buildId}-${fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return { uri, sizeBytes: info.exists && 'size' in info ? info.size : 0 };
}
