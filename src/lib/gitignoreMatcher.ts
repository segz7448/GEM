/**
 * A minimal .gitignore pattern matcher, covering the common real-world
 * subset: comments (#), blank lines, negation (!), directory-only
 * patterns (trailing /), anchored patterns (leading /), and glob
 * wildcards (* and **). It does not implement the full gitignore spec
 * (character classes like [abc], escaped special characters, etc.) —
 * for the purpose this serves (deciding what a build upload should skip,
 * not being a git implementation), covering the common cases well is the
 * right tradeoff over exhaustive correctness.
 *
 * Ported from GitManager's gitignoreMatcher, which solves the exact same
 * problem this project has (deciding what to exclude from a bulk upload)
 * more correctly than GEM's original hardcoded folder-name exclusion list.
 */

interface GitignoreRule {
  regex: RegExp;
  negate: boolean;
}

function globToRegex(pattern: string): string {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
          continue;
        }
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }
    if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
      i += 1;
      continue;
    }
    re += c;
    i += 1;
  }
  return re;
}

/** Parses raw .gitignore content into an ordered list of compiled rules. Order matters — later rules (including negations) override earlier ones for the same path. */
export function parseGitignore(content: string): GitignoreRule[] {
  const lines = content.split('\n');
  const rules: GitignoreRule[] = [];

  for (const raw of lines) {
    let line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    }

    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }

    let anchored = false;
    if (line.startsWith('/')) {
      anchored = true;
      line = line.slice(1);
    }
    if (line.includes('/')) anchored = true;

    const regexBody = globToRegex(line);
    const fullRegex = anchored
      ? new RegExp(`^${regexBody}${dirOnly ? '(?:/.*)?$' : '$'}`)
      : new RegExp(`(^|/)${regexBody}${dirOnly ? '(?:/.*)?$' : '$'}`);

    rules.push({ regex: fullRegex, negate });
  }

  return rules;
}

/** Returns true if `path` (forward-slash separated, no leading slash) should be ignored per the given ruleset. Later matching rules win — mirrors git's own precedence, including negation un-ignoring a path matched by an earlier broader rule. */
export function isIgnored(path: string, rules: GitignoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(path)) {
      ignored = !rule.negate;
    }
  }
  return ignored;
}

/**
 * Built-in defaults applied even when the upload has no .gitignore of its
 * own, covering the most common accidental-inclusion offenders. This list
 * is also what makes folder/file uploads fast — excluding node_modules/
 * and .git/ here is what prevents the walker from ever descending into
 * them in the first place (see zipUtils.ts's zipPickedDirectory), not
 * just hiding them from the review list after the fact.
 */
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/',
  '.git/',
  '.expo/',
  '.gradle/',
  '.idea/',
  '.vscode/',
  'android/build/',
  'android/app/build/',
  'android/.gradle/',
  'ios/Pods/',
  'ios/build/',
  '.DS_Store',
  'Thumbs.db',
  '.env',
  '.env.local',
  '*.log',
  '__pycache__/',
  '.venv/',
  'venv/',
];

export function getDefaultRules(): GitignoreRule[] {
  return parseGitignore(DEFAULT_IGNORE_PATTERNS.join('\n'));
}

export interface IgnorableEntry {
  path: string;
}

/** Filters entries against a .gitignore's content (if any) plus the built-in defaults, returning both kept and ignored so callers can show what was excluded. */
export function filterIgnoredEntries<T extends IgnorableEntry>(entries: T[], gitignoreContent: string | null): { kept: T[]; ignored: T[] } {
  const rules = gitignoreContent ? [...getDefaultRules(), ...parseGitignore(gitignoreContent)] : getDefaultRules();

  const kept: T[] = [];
  const ignored: T[] = [];
  for (const entry of entries) {
    if (isIgnored(entry.path, rules)) {
      ignored.push(entry);
    } else {
      kept.push(entry);
    }
  }
  return { kept, ignored };
}
