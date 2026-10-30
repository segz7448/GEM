import * as SecureStore from 'expo-secure-store';
import { getBuildTarget } from './buildTarget';

const TOKEN_KEY = 'gem.githubToken';

/**
 * The GitHub token lives only in this device's secure storage - never in
 * app.json or anywhere else in the repo. Any GitHub token committed to a
 * public repository is auto-revoked by GitHub's secret scanning, which is
 * what killed the previous baked-in token and every build screen with it.
 */

export async function getGithubToken(): Promise<string> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token ?? '';
}

/**
 * Token for authenticated GitHub calls. Throws a human-actionable error when
 * none is set, so screens surface "add it in Settings" instead of a raw 401.
 */
export async function requireGithubToken(): Promise<string> {
  const token = await getGithubToken();
  if (!token) {
    throw new Error(
      'No GitHub token on this device. Add one in Settings under GitHub Token - it is stored only on this phone.',
    );
  }
  return token;
}

export async function saveGithubToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('Paste a GitHub token first.');
  await SecureStore.setItemAsync(TOKEN_KEY, trimmed);
}

export async function clearGithubToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/**
 * Check used by the Settings Test button: validates a candidate token against
 * the configured build-target repo before (or without) saving it.
 */
export async function testGithubToken(token: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = token.trim();
  if (!trimmed) return { ok: false, message: 'Paste a GitHub token first.' };
  try {
    const target = await getBuildTarget();
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`,
      {
        headers: {
          Authorization: `Bearer ${trimmed}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (res.ok) return { ok: true, message: `Connected to ${target.owner}/${target.repo}.` };
    if (res.status === 401) {
      return { ok: false, message: 'GitHub rejected this token (401). Check it pasted fully and has not been revoked.' };
    }
    if (res.status === 404) {
      return {
        ok: false,
        message: `Token works, but ${target.owner}/${target.repo} was not found. Check the build target below.`,
      };
    }
    return { ok: false, message: `GitHub answered ${res.status}. Try again.` };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Could not reach GitHub.' };
  }
}
