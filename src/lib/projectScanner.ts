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
  summary: string;
  signals: string[];
  hasGradlew: boolean;
  hasGradleWrapperJar: boolean;
  hasAndroidManifest: boolean;
  issues: ScanIssue[];
}

function parsePackageJson(files: ProjectFile[]): Record<string, any> | null {
  const file = files.find((f) => f.path === 'package.json' && f.text);
  if (!file?.text) return null;
  try {
    const parsed = JSON.parse(file.text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function dependencies(packageJson: Record<string, any> | null): Record<string, string> {
  return {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
    ...(packageJson?.peerDependencies ?? {}),
  };
}

function label(type: ProjectType): string {
  const labels: Record<ProjectType, string> = {
    'android-native-kotlin': 'Native Android (Kotlin)',
    'android-native-java': 'Native Android (Java)',
    flutter: 'Flutter Android app',
    'react-native': 'React Native Android app',
    'expo-managed': 'Expo managed app',
    capacitor: 'Capacitor app',
    cordova: 'Cordova app',
    unknown: 'Unrecognized project',
  };
  return labels[type];
}

/**
 * Analyze project configuration and source markers before the user starts a build.
 * This is static, deterministic analysis; it does not execute uploaded code or claim
 * to understand app features. The same result is used by the review UI and pipeline.
 */
export function scanProject(files: ProjectFile[]): ScanResult {
  const paths = files.map((f) => f.path.replace(/\\/g, '/'));
  const has = (predicate: (p: string) => boolean) => paths.some(predicate);
  const findText = (path: string) => files.find((f) => f.path.replace(/\\/g, '/') === path && !f.isBinary)?.text ?? '';
  const packageJson = parsePackageJson(files);
  const deps = dependencies(packageJson);
  const packageText = findText('package.json');
  const hasPackage = !!packageJson;
  const hasExpoConfig = has((p) => /^(app\.json|app\.config\.(js|ts|mjs|cjs))$/.test(p));
  const appJson = findText('app.json');
  const hasExpoDependency = !!deps.expo || /"expo"\s*:/.test(packageText);
  const hasReactNativeDependency = !!deps['react-native'] || /"react-native"\s*:/.test(packageText);
  const hasGradle = has((p) => /(^|\/)build\.gradle(\.kts)?$/.test(p));
  const hasApplicationGradle = files.some((f) => {
    if (!/(^|\/)build\.gradle(\.kts)?$/.test(f.path)) return false;
    const txt = f.text ?? '';
    return /com\.android\.application|applicationId\s*(?:=\s*)?["']/.test(txt);
  });
  const manifestFiles = files.filter((f) => /(^|\/)AndroidManifest\.xml$/.test(f.path) && !f.isBinary);
  const hasManifest = manifestFiles.length > 0;
  const hasGradlew = has((p) => /(^|\/)gradlew$/.test(p));
  const hasGradleWrapperJar = has((p) => /(^|\/)gradle-wrapper\.jar$/.test(p));
  const hasKotlinAppSource = has((p) => /(^|\/)app\/src\/main\/.*\.kt$/i.test(p) || /(^|\/)src\/main\/.*\.kt$/i.test(p));
  const hasJavaAppSource = has((p) => /(^|\/)app\/src\/main\/.*\.java$/i.test(p) || /(^|\/)src\/main\/.*\.java$/i.test(p));
  const hasPubspec = has((p) => /(^|\/)pubspec\.yaml$/.test(p));
  const pubspec = files.find((f) => /(^|\/)pubspec\.yaml$/.test(f.path) && f.text)?.text ?? '';
  const hasFlutterSdk = /(^|\n)\s*flutter\s*:\s*\n\s*sdk\s*:\s*flutter\b/.test(pubspec);
  const hasFlutterEntry = has((p) => /(^|\/)lib\/main\.dart$/.test(p));
  const hasCapacitorConfig = has((p) => /(^|\/)capacitor\.config\.(json|ts|js)$/.test(p));
  const hasCapacitorDependency = !!deps['@capacitor/android'] || !!deps['@capacitor/core'];
  const hasCordovaConfig = has((p) => /(^|\/)config\.xml$/.test(p));
  const hasCordovaDependency = !!deps.cordova || !!deps['cordova-android'];
  const hasCordovaWebRoot = has((p) => /(^|\/)www\/index\.html$/.test(p));

  let type: ProjectType = 'unknown';
  // Prefer committed Android projects over a managed Expo config: an Expo
  // project with android/ present is built as a native React Native project.
  if (hasFlutterSdk && hasFlutterEntry) type = 'flutter';
  else if (hasCapacitorDependency && hasCapacitorConfig) type = 'capacitor';
  else if (hasCordovaDependency && hasCordovaConfig && hasCordovaWebRoot) type = 'cordova';
  else if (hasReactNativeDependency && hasApplicationGradle && hasManifest) type = 'react-native';
  else if (hasReactNativeDependency && hasExpoDependency && hasExpoConfig) type = 'expo-managed';
  else if (hasExpoDependency && hasExpoConfig) type = 'expo-managed';
  else if (hasApplicationGradle && hasManifest) type = hasKotlinAppSource ? 'android-native-kotlin' : 'android-native-java';

  const issues: ScanIssue[] = [];
  const signals: string[] = [];
  if (hasPackage) signals.push('Parsed package.json');
  else if (paths.some((p) => p === 'package.json')) issues.push({ severity: 'error', message: 'package.json exists but could not be parsed.', file: 'package.json' });
  if (hasExpoDependency) signals.push('Expo dependency found in package.json');
  if (hasReactNativeDependency) signals.push('React Native dependency found in package.json');
  if (hasFlutterSdk) signals.push('Flutter SDK dependency found in pubspec.yaml');
  if (hasFlutterEntry) signals.push('Flutter entrypoint found at lib/main.dart');
  if (hasCapacitorDependency) signals.push('Capacitor dependency found in package.json');
  if (hasCapacitorConfig) signals.push('Capacitor config found');
  if (hasCordovaDependency) signals.push('Cordova dependency found in package.json');
  if (hasCordovaConfig) signals.push('Cordova config.xml found');
  if (hasManifest) signals.push(`${manifestFiles.length} Android manifest${manifestFiles.length === 1 ? '' : 's'} found`);
  if (hasApplicationGradle) signals.push('Android application Gradle module found');
  if (hasGradlew) signals.push('Gradle wrapper script found');
  if (hasGradleWrapperJar) signals.push('Gradle wrapper JAR found');
  if (hasKotlinAppSource) signals.push('Kotlin app source found');
  if (hasJavaAppSource) signals.push('Java app source found');

  if (type === 'unknown') {
    issues.push({ severity: 'error', message: 'Could not identify a supported Android project. Include the project root, package manifest, and native/Expo/Flutter Android configuration.' });
  }
  if ((type === 'android-native-kotlin' || type === 'android-native-java' || type === 'react-native') && !hasManifest) {
    issues.push({ severity: 'error', message: 'AndroidManifest.xml was not found.' });
  }
  if (hasGradle && !hasGradlew && (type === 'android-native-java' || type === 'android-native-kotlin')) {
    issues.push({ severity: 'warning', message: 'Gradle wrapper is missing. GEM will generate one on the build runner; confirm the project uses a compatible Android Gradle Plugin.' });
  }
  if (hasGradlew && !hasGradleWrapperJar && (type === 'android-native-java' || type === 'android-native-kotlin')) {
    issues.push({ severity: 'error', message: 'gradlew is present but gradle-wrapper.jar is missing.', file: 'gradle/wrapper/gradle-wrapper.jar' });
  }
  if (type === 'expo-managed' && !hasPackage) {
    issues.push({ severity: 'error', message: 'Expo project needs a valid package.json.' });
  }
  if (type === 'capacitor' && !hasPackage) {
    issues.push({ severity: 'error', message: 'Capacitor project needs a valid package.json.' });
  }
  if (type === 'capacitor' && !deps['@capacitor/android']) {
    issues.push({ severity: 'error', message: 'Capacitor Android platform dependency @capacitor/android is missing from package.json.' });
  }
  if (type === 'cordova' && !hasPackage) {
    issues.push({ severity: 'error', message: 'Cordova project needs a valid package.json.' });
  }
  if (hasExpoDependency && hasExpoConfig && !appJson && !paths.some((p) => /app\.config\.(js|ts|mjs|cjs)$/.test(p))) {
    issues.push({ severity: 'warning', message: 'Expo config is present but app.json could not be read. Dynamic app.config files are not executed during scanning.' });
  }

  // Catch malformed critical config and broken XML before a cloud workflow is queued.
  const JSONC_TOLERANT = /(^|\/)(tsconfig.*|jsconfig|\.babelrc|\.eslintrc|\.prettierrc)\.json$|(^|\/)\.vscode\/.*\.json$/;
  const CRITICAL_JSON = /(^|\/)(package|app|eas)\.json$/;
  for (const file of files) {
    if (file.isBinary || !file.text) continue;
    const path = file.path.replace(/\\/g, '/');
    if (path.endsWith('.json') && !JSONC_TOLERANT.test(path)) {
      try {
        JSON.parse(file.text);
      } catch {
        issues.push({ severity: CRITICAL_JSON.test(path) ? 'error' : 'warning', message: 'Invalid JSON.', file: path });
      }
    }
    if (path.endsWith('.xml') && !isWellFormedXml(file.text)) {
      issues.push({ severity: 'error', message: 'Invalid or malformed XML.', file: path });
    }
  }

  const summary = type === 'unknown'
    ? 'No supported Android build type could be confirmed from the project files.'
    : `${label(type)} detected from ${signals.length} project signals. This is static configuration analysis, not a review of app features or code behavior.`;
  return { type, summary, signals, hasGradlew, hasGradleWrapperJar, hasAndroidManifest: hasManifest, issues };
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
