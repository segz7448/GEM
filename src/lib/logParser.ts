export interface ParsedFailure {
  errorType: string;
  problem: string;
  rootCause: string;
  file?: string;
  line?: number;
  suggestedFix?: string;
  docsUrl?: string;
}

interface Rule {
  errorType: string;
  pattern: RegExp;
  build: (match: RegExpMatchArray) => Omit<ParsedFailure, 'errorType'>;
}

const RULES: Rule[] = [
  {
    errorType: 'gradle-compile',
    pattern: /^(?:e: )?(.+\.kts?):(\d+):(\d+)?:?\s*(.+)$/m,
    build: (m) => ({
      problem: 'Kotlin compilation error',
      rootCause: m[4].trim(),
      file: m[1],
      line: parseInt(m[2], 10),
      suggestedFix: 'Fix the syntax or type error at the reported location and re-upload.',
    }),
  },
  {
    errorType: 'java-compile',
    pattern: /^(.+\.java):(\d+): error: (.+)$/m,
    build: (m) => ({
      problem: 'Java compilation error',
      rootCause: m[3].trim(),
      file: m[1],
      line: parseInt(m[2], 10),
      suggestedFix: 'Fix the compile error at the reported location and re-upload.',
    }),
  },
  {
    errorType: 'missing-dependency',
    pattern: /Could not find ([^\s.]+(?:\.[^\s.]+)*)\./,
    build: (m) => ({
      problem: 'A dependency could not be resolved',
      rootCause: `Gradle could not find "${m[1]}" in any configured repository.`,
      suggestedFix: 'Check the dependency coordinates and that the required repository (e.g. mavenCentral, google) is declared.',
      docsUrl: 'https://docs.gradle.org/current/userguide/dependency_resolution.html',
    }),
  },
  {
    errorType: 'manifest-merge',
    pattern: /Manifest merger failed[^\n]*:\s*(.+)/,
    build: (m) => ({
      problem: 'AndroidManifest.xml merge failure',
      rootCause: m[1].trim(),
      file: 'AndroidManifest.xml',
      suggestedFix: 'Resolve the conflicting attribute — usually a mismatched value between the app manifest and a library manifest.',
    }),
  },
  {
    errorType: 'duplicate-class',
    pattern: /Duplicate class ([\w.$]+) found in modules (.+)/,
    build: (m) => ({
      problem: 'Duplicate class on the classpath',
      rootCause: `"${m[1]}" is provided by more than one dependency: ${m[2].trim()}.`,
      suggestedFix: 'Exclude the duplicate transitive dependency from one of the conflicting modules.',
    }),
  },
  {
    errorType: 'sdk-missing',
    pattern: /Failed to find target with hash string '([^']+)'/,
    build: (m) => ({
      problem: 'Required Android SDK platform is not installed on the runner',
      rootCause: `SDK target "${m[1]}" is missing.`,
      suggestedFix: 'Lower compileSdkVersion/targetSdkVersion to a version available on the standard GitHub-hosted runner, or add an SDK-install step.',
    }),
  },
  {
    errorType: 'oom',
    pattern: /(OutOfMemoryError|Metaspace)/,
    build: () => ({
      problem: 'Build process ran out of memory',
      rootCause: 'The Gradle daemon or a compiler process exceeded available heap/metaspace.',
      suggestedFix: 'Add org.gradle.jvmargs=-Xmx4g to gradle.properties, or reduce parallel workers.',
    }),
  },
];

export function parseFailureLog(rawLog: string): ParsedFailure[] {
  const lines = rawLog.split('\n');
  const seen = new Set<string>();
  const failures: ParsedFailure[] = [];

  const windowSize = 400;
  for (let start = 0; start < lines.length; start += windowSize / 2) {
    const window = lines.slice(start, start + windowSize).join('\n');
    for (const rule of RULES) {
      const match = window.match(rule.pattern);
      if (!match) continue;
      const built = rule.build(match);
      const key = `${rule.errorType}:${built.file || ''}:${built.line || ''}:${built.rootCause}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({ errorType: rule.errorType, ...built });
    }
  }

  if (failures.length === 0) {
    failures.push({
      errorType: 'unknown',
      problem: 'Build failed for an unrecognized reason',
      rootCause: lines.filter((l) => l.trim()).slice(-5).join('\n'),
      suggestedFix: 'Check the raw logs — this failure pattern is not yet recognized.',
    });
  }

  return failures;
}
