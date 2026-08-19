import type { ProjectFile } from './zipUtils';

export type ProjectType =
  | 'android-native-kotlin'
  | 'android-native-java'
  | 'flutter'
  | 'react-native'
  | 'expo-managed'
  | 'capacitor'
  | 'cordova'
  | 'unknown';

export interface ScanIssue {
  severity: 'error' | 'warning';
  message: string;
  file?: string;
}

export interface ScanResult {
  type: ProjectType;
  hasGradlew: boolean;
  hasGradleWrapperJar: boolean;
  hasAndroidManifest: boolean;
  issues: ScanIssue[];
}

export function scanProject(files: ProjectFile[]): ScanResult {
  const paths = files.map((f) => f.path);
  const has = (predicate: (p: string) => boolean) => paths.some(predicate);

  const hasGradle = has((p) => /(^|\/)build\.gradle(\.kts)?$/.test(p));
  const hasManifest = has((p) => /(^|\/)AndroidManifest\.xml$/.test(p));
  const hasGradlew = has((p) => /(^|\/)gradlew$/.test(p));
  const hasGradleWrapperJar = has((p) => /gradle-wrapper\.jar$/.test(p));
  const hasKotlin = has((p) => p.endsWith('.kt'));
  const hasPubspec = has((p) => /(^|\/)pubspec\.yaml$/.test(p));
  const hasPackageJson = has((p) => /(^|\/)package\.json$/.test(p));
  const hasCapacitorConfig = has((p) => /capacitor\.config\.(json|ts)$/.test(p));
  const hasCordovaConfig = has((p) => /(^|\/)config\.xml$/.test(p)) && has((p) => /(^|\/)platforms\//.test(p) || /(^|\/)www\//.test(p));
  const hasCommittedAndroidProject = has((p) => /(^|\/)android\/app\/build\.gradle(\.kts)?$/.test(p));
  const hasAppJson = has((p) => /^app\.json$/.test(p) || /^app\.config\.(js|ts)$/.test(p));
  const hasExpoDependency = files.some((f) => f.path === 'package.json' && f.text && /"expo"\s*:/.test(f.text));

  let type: ProjectType = 'unknown';
  if (hasPubspec) type = 'flutter';
  else if (hasCapacitorConfig) type = 'capacitor';
  else if (hasCordovaConfig) type = 'cordova';
  else if (hasPackageJson && hasCommittedAndroidProject) type = 'react-native';
  else if (hasPackageJson && hasAppJson && hasExpoDependency) type = 'expo-managed';
  else if (hasGradle && hasManifest) type = hasKotlin ? 'android-native-kotlin' : 'android-native-java';

  const issues: ScanIssue[] = [];

  if (type === 'unknown') {
    issues.push({ severity: 'error', message: 'Could not determine project type from the uploaded files.' });
  }
  if ((type === 'android-native-kotlin' || type === 'android-native-java' || type === 'react-native') && !hasManifest) {
    issues.push({ severity: 'error', message: 'AndroidManifest.xml was not found.' });
  }
  if (hasGradle && !hasGradlew) {
    issues.push({ severity: 'warning', message: 'gradlew wrapper is missing — will be generated automatically during the build.' });
  }
  if (hasGradle && hasGradlew && !hasGradleWrapperJar) {
    issues.push({
      severity: 'error',
      message: 'gradlew is present but gradle-wrapper.jar is missing.',
      file: 'gradle/wrapper/gradle-wrapper.jar',
    });
  }

  for (const file of files) {
    if (file.isBinary || !file.text) continue;
    if (file.path.endsWith('.json')) {
      try {
        JSON.parse(file.text);
      } catch {
        issues.push({ severity: 'error', message: 'Invalid JSON.', file: file.path });
      }
    }
    if (file.path.endsWith('.xml') && !isWellFormedXml(file.text)) {
      issues.push({ severity: 'error', message: 'Invalid or malformed XML.', file: file.path });
    }
  }

  return { type, hasGradlew, hasGradleWrapperJar, hasAndroidManifest: hasManifest, issues };
}

export function extractAppMeta(files: ProjectFile[]): { packageName: string | null; versionName: string | null; versionCode: number | null } {
  const result = { packageName: null as string | null, versionName: null as string | null, versionCode: null as number | null };

  const manifests = files.filter((f) => f.path.endsWith('AndroidManifest.xml') && f.text).sort((a, b) => a.path.length - b.path.length);
  const manifest = manifests[0];
  if (manifest?.text) {
    result.packageName = manifest.text.match(/package="([^"]+)"/)?.[1] ?? null;
    result.versionName = manifest.text.match(/android:versionName="([^"]+)"/)?.[1] ?? null;
    const vc = manifest.text.match(/android:versionCode="([^"]+)"/)?.[1];
    result.versionCode = vc ? parseInt(vc, 10) : null;
  }

  if (!result.packageName || !result.versionName) {
    const gradle = files.find((f) => /build\.gradle(\.kts)?$/.test(f.path) && f.path.includes('app') && f.text);
    if (gradle?.text) {
      result.packageName = result.packageName ?? gradle.text.match(/applicationId[\s=]+["']([^"']+)["']/)?.[1] ?? null;
      result.versionName = result.versionName ?? gradle.text.match(/versionName[\s=]+["']([^"']+)["']/)?.[1] ?? null;
      const vc = gradle.text.match(/versionCode[\s=]+(\d+)/)?.[1];
      result.versionCode = result.versionCode ?? (vc ? parseInt(vc, 10) : null);
    }
  }

  // Managed Expo projects have no AndroidManifest.xml/build.gradle at
  // all pre-prebuild — app.json is the only source of this metadata.
  if (!result.packageName || !result.versionName) {
    const appJson = files.find((f) => f.path === 'app.json' && f.text);
    if (appJson?.text) {
      try {
        const parsed = JSON.parse(appJson.text);
        result.packageName = result.packageName ?? parsed?.expo?.android?.package ?? null;
        result.versionName = result.versionName ?? parsed?.expo?.version ?? null;
        const vc = parsed?.expo?.android?.versionCode;
        result.versionCode = result.versionCode ?? (typeof vc === 'number' ? vc : null);
      } catch {
        // Malformed app.json — leave whatever was already found from other sources.
      }
    }
  }
  return result;
}

function isWellFormedXml(content: string): boolean {
  const stack: string[] = [];
  const tagRegex = /<\/?([a-zA-Z_][\w.\-:]*)[^>]*?(\/?)>/g;
  let match: RegExpExecArray | null;
  let sawRoot = false;
  while ((match = tagRegex.exec(content)) !== null) {
    const [full, name, selfClose] = match;
    if (full.startsWith('<?') || full.startsWith('<!--')) continue;
    if (full.startsWith('</')) {
      if (stack.pop() !== name) return false;
    } else if (!selfClose) {
      stack.push(name);
      sawRoot = true;
    } else {
      sawRoot = true;
    }
  }
  return sawRoot && stack.length === 0;
}
