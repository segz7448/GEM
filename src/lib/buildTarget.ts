import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const OWNER_KEY = 'gem.buildTarget.owner';
const REPO_KEY = 'gem.buildTarget.repo';
const BRANCH_KEY = 'gem.buildTarget.branch';
const extra = Constants.expoConfig?.extra ?? {};
const DEFAULT_OWNER = String(extra.GITHUB_OWNER ?? '');
const DEFAULT_REPO = String(extra.GITHUB_REPO ?? '');
const DEFAULT_BRANCH = String(extra.GITHUB_BASE_BRANCH ?? 'main');

export interface BuildTarget {
  owner: string;
  repo: string;
  branch: string;
}

/** Read the configured target fields for the Settings form. GEM itself may be the selected build repo. */
export async function getBuildTargetDraft(): Promise<BuildTarget> {
  const [storedOwner, storedRepo, storedBranch] = await Promise.all([
    SecureStore.getItemAsync(OWNER_KEY),
    SecureStore.getItemAsync(REPO_KEY),
    SecureStore.getItemAsync(BRANCH_KEY),
  ]);
  const owner = storedOwner ?? DEFAULT_OWNER;
  return { owner, repo: storedRepo ?? DEFAULT_REPO, branch: storedBranch ?? DEFAULT_BRANCH };
}

export async function saveBuildTarget(target: BuildTarget): Promise<void> {
  const owner = target.owner.trim();
  const repo = target.repo.trim();
  const branch = target.branch.trim() || 'main';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
    throw new Error('Enter a valid GitHub owner or organization.');
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
    throw new Error('Enter a valid GitHub repository name.');
  }
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.startsWith('/') || branch.endsWith('/') || branch.includes('..')) {
    throw new Error('Enter a valid base branch name.');
  }
  await Promise.all([
    SecureStore.setItemAsync(OWNER_KEY, owner),
    SecureStore.setItemAsync(REPO_KEY, repo),
    SecureStore.setItemAsync(BRANCH_KEY, branch),
  ]);
}

export async function getBuildTarget(): Promise<BuildTarget> {
  const target = await getBuildTargetDraft();
  if (!target.owner || !target.repo) {
    throw new Error('Set a GitHub build-target repository in Settings first. It must have a base branch and GitHub Actions enabled.');
  }
  return target;
}
