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
