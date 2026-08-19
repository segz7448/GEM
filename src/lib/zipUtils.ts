import * as FileSystem from 'expo-file-system';
import JSZip from 'jszip';

export interface ProjectFile {
  path: string;
  isBinary: boolean;
  text?: string;
  base64?: string;
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
  for (const entry of entries) {
    if (entry.name.includes('__MACOSX') || entry.name.includes('/.git/')) continue;
    const relPath = entry.name.startsWith(stripPrefix) ? entry.name.slice(stripPrefix.length) : entry.name;
    if (!relPath) continue;
    const binary = isBinaryPath(relPath);
    if (binary) {
      files.push({ path: relPath, isBinary: true, base64: await entry.async('base64') });
    } else {
      files.push({ path: relPath, isBinary: false, text: await entry.async('text') });
    }
  }
  return files;
}

/** Extracts the first .apk found inside a base64-encoded artifact zip. */
export async function extractApkFromArtifactZip(zipBase64: string): Promise<{ name: string; base64: string }> {
  const zip = await JSZip.loadAsync(zipBase64, { base64: true });
  const apkEntry = Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().endsWith('.apk'));
  if (!apkEntry) throw new Error('No .apk found inside the downloaded build artifact.');
  const base64 = await apkEntry.async('base64');
  const name = apkEntry.name.split('/').pop()!;
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
 */
export async function zipPickedDirectory(rootDirUri: string, folderName: string): Promise<string> {
  const SAF = FileSystem.StorageAccessFramework;
  const zip = new JSZip();

  const rootDocId = decodeURIComponent(rootDirUri.split('/document/')[1] ?? '');

  async function walk(dirUri: string) {
    const children = await SAF.readDirectoryAsync(dirUri);
    for (const childUri of children) {
      const childDocId = decodeURIComponent(childUri.split('/document/')[1] ?? '');
      const relPath = childDocId.startsWith(`${rootDocId}/`) ? childDocId.slice(rootDocId.length + 1) : childDocId;
      if (!relPath || relPath.includes('__MACOSX') || relPath.includes('/.git/') || relPath.startsWith('.git/')) continue;

      // SAF has no cheap "is this a directory" flag — the reliable way is to try
      // listing it as a directory; a file rejects, a directory succeeds.
      let isDir = true;
      let grandChildren: string[] = [];
      try {
        grandChildren = await SAF.readDirectoryAsync(childUri);
      } catch {
        isDir = false;
      }

      if (isDir) {
        await walk(childUri);
        void grandChildren; // already consumed via the recursive walk
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
      }
    }
  }

  await walk(rootDirUri);
  return writeZipToTemp(zip, `${folderName}.zip`);
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
  const dir = `${FileSystem.documentDirectory}apks/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const uri = `${dir}${buildId}-${fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return { uri, sizeBytes: info.exists && 'size' in info ? info.size : 0 };
}
