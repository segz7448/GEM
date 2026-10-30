import * as FileSystem from 'expo-file-system';
import { getBuildTarget } from './buildTarget';
import { requireGithubToken } from './githubToken';


const API_ROOT = 'https://api.github.com';

async function repositoryPath(): Promise<string> {
  const target = await getBuildTarget();
  return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
}

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await requireGithubToken();
  const res = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} on ${path}: ${body}`);
  }
  // 204 No Content responses (deleteRef, dispatch, etc.) have no JSON body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Fetches a binary endpoint (artifact/log zips) and returns a base64 string, since RN has no ArrayBuffer-to-file shortcut without one. */
async function ghBinaryBase64(path: string): Promise<string> {
  const token = await requireGithubToken();
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}`);
  const buffer = await res.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Pure-JS base64 encoder — deliberately doesn't rely on `btoa` or
 * `TextEncoder` being present as globals. Whether those are reliably
 * available in Hermes/React Native without an explicit polyfill isn't
 * something worth gambling the entire GitHub client on; this uses only
 * plain ECMAScript (bitwise ops, Uint8Array, codePointAt), which Hermes
 * has always supported directly.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result += BASE64_CHARS[(chunk >> 18) & 63] + BASE64_CHARS[(chunk >> 12) & 63] + BASE64_CHARS[(chunk >> 6) & 63] + BASE64_CHARS[chunk & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    result += BASE64_CHARS[(chunk >> 18) & 63] + BASE64_CHARS[(chunk >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    result += BASE64_CHARS[(chunk >> 18) & 63] + BASE64_CHARS[(chunk >> 12) & 63] + BASE64_CHARS[(chunk >> 6) & 63] + '=';
  }
  return result;
}

function utf8ToBytes(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i)!;
    if (code > 0xffff) i++; // consumed a surrogate pair (two UTF-16 units)
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

function base64Encode(text: string): string {
  return bytesToBase64(utf8ToBytes(text));
}

export interface PushFile {
  path: string;
  content?: string;
  contentBase64?: string;
}

export async function validateBuildTarget(): Promise<{ isPrivate: boolean }> {
  const target = await getBuildTarget();
  const repo = await gh<{ private?: boolean; default_branch?: string }>(await repositoryPath());
  if (repo.default_branch !== target.branch) {
    const branch = await gh<{ object: { sha: string } }>(`${await repositoryPath()}/git/ref/heads/${target.branch}`);
    if (!branch.object?.sha) throw new Error(`Base branch "${target.branch}" was not found in ${target.owner}/${target.repo}.`);
  }
  const permissions = await gh<{ enabled?: boolean }>(`${await repositoryPath()}/actions/permissions`);
  if (permissions.enabled === false) throw new Error('GitHub Actions is disabled for the configured build-target repository. Enable it, then retry.');
  return { isPrivate: repo.private === true };
}

export async function getFileSha(branchName: string, path: string): Promise<string | null> {
  try {
    const data = await gh<{ sha: string }>(`${await repositoryPath()}/contents/${path}?ref=${branchName}`);
    return data.sha;
  } catch {
    return null;
  }
}

export async function putFile(branchName: string, path: string, content: string, message: string, existingSha: string | null): Promise<void> {
  await gh(`${await repositoryPath()}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: base64Encode(content),
      branch: branchName,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });
}

/**
 * GitHub only recognizes a workflow_dispatch-triggered workflow as
 * dispatchable via the API if the file exists on the repo's DEFAULT
 * branch — dispatching against a temp branch alone (which is all the
 * per-build pipeline normally pushes) 404s with "workflow not found"
 * even though that branch has the file. This checks the base branch
 * once and self-heals by committing directly to it if missing.
 * Content on the base branch only needs the right trigger/inputs to
 * register the workflow_id — the actual steps that run for a given
 * build always come from what's pushed to that build's own branch.
 */
export async function ensureWorkflowRegistered(path: string, content: string): Promise<void> {
  const target = await getBuildTarget();
  const repository = await gh<{ default_branch?: string }>(await repositoryPath());
  const workflowBranch = repository.default_branch || target.branch;
  const existingSha = await getFileSha(workflowBranch, path);
  if (existingSha) return; // already registered — nothing to do
  await putFile(workflowBranch, path, content, 'GEM: register build workflow on default branch', null);
}

export async function getBaseBranchSha(): Promise<string> {
  const target = await getBuildTarget();
  const data = await gh<{ object: { sha: string } }>(`${await repositoryPath()}/git/ref/heads/${encodeURIComponent(target.branch)}`);
  return data.object.sha;
}

export async function getBranchRef(branchName: string): Promise<string | null> {
  try {
    const data = await gh<{ object: { sha: string } }>(`${await repositoryPath()}/git/ref/heads/${branchName}`);
    return data.object.sha;
  } catch {
    return null;
  }
}

export async function createBranch(branchName: string, fromSha: string): Promise<void> {
  await gh(`${await repositoryPath()}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
  });
}

export async function deleteBranch(branchName: string): Promise<void> {
  try {
    await gh(`${await repositoryPath()}/git/refs/heads/${branchName}`, { method: 'DELETE' });
  } catch {
    // Idempotent cleanup — already gone is fine.
  }
}

export async function pushFiles(branchName: string, baseSha: string, files: PushFile[], message: string): Promise<string> {
  const baseCommit = await gh<{ tree: { sha: string } }>(`${await repositoryPath()}/git/commits/${baseSha}`);

  const blobs: { path: string; sha: string }[] = [];
  for (const file of files) {
    const isBinary = !!file.contentBase64;
    const blob = await gh<{ sha: string }>(`${await repositoryPath()}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: isBinary ? file.contentBase64 : file.content,
        encoding: isBinary ? 'base64' : 'utf-8',
      }),
    });
    blobs.push({ path: file.path, sha: blob.sha });
  }

  const newTree = await gh<{ sha: string }>(`${await repositoryPath()}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
    }),
  });

  const newCommit = await gh<{ sha: string }>(`${await repositoryPath()}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }),
  });

  await gh(`${await repositoryPath()}/git/refs/heads/${branchName}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: true }),
  });

  return newCommit.sha;
}

export async function dispatchWorkflow(workflowFile: string, ref: string, inputs: Record<string, string>): Promise<void> {
  await gh(`${await repositoryPath()}/actions/workflows/${workflowFile}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref, inputs }),
  });
}

export interface DispatchedRun {
  runId: number;
  htmlUrl: string;
  status: string;
}

export async function findDispatchedRun(workflowFile: string, branchName: string, _sinceIso: string): Promise<DispatchedRun | null> {
  const data = await gh<{ workflow_runs: { id: number; html_url: string; status: string; created_at: string }[] }>(
    `${await repositoryPath()}/actions/workflows/${workflowFile}/runs?branch=${branchName}&per_page=5`,
  );
  // The build branch is unique per build (`build/<uuid>`), so any run on it
  // belongs to this build. Filtering by created_at against the DEVICE clock
  // (the old behavior) breaks discovery whenever the phone's clock is even a
  // few seconds ahead of GitHub's: the run's server-side created_at then
  // precedes sinceIso forever and the poll times out with "Timed out waiting
  // for the dispatched workflow run to appear." even though the run exists.
  if (data.workflow_runs.length === 0) return null;
  const run = [...data.workflow_runs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  return { runId: run.id, htmlUrl: run.html_url, status: run.status };
}

export async function getRun(runId: number): Promise<{ status: string; conclusion: string | null; html_url: string }> {
  return gh(`${await repositoryPath()}/actions/runs/${runId}`);
}

export async function listArtifacts(runId: number): Promise<{ id: number; name: string }[]> {
  const data = await gh<{ artifacts: { id: number; name: string }[] }>(`${await repositoryPath()}/actions/runs/${runId}/artifacts`);
  return data.artifacts;
}

export async function downloadArtifactZipBase64(artifactId: number): Promise<string> {
  return ghBinaryBase64(`${await repositoryPath()}/actions/artifacts/${artifactId}/zip`);
}

/**
 * Streams the artifact zip straight to disk with real byte-level progress,
 * instead of buffering the whole thing in memory via ghBinaryBase64. Used
 * for the on-device download-progress notification — the network transfer
 * is genuinely where the "downloading" stage's time goes, unlike the
 * comparatively fast local unzip/base64 step after it.
 */
export async function downloadArtifactZipToFile(
  artifactId: number,
  destPath: string,
  onProgress?: (bytesWritten: number, bytesExpected: number) => void,
): Promise<void> {
  const token = await requireGithubToken();
  const url = `${API_ROOT}${await repositoryPath()}/actions/artifacts/${artifactId}/zip`;
  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    destPath,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
    (progress) => onProgress?.(progress.totalBytesWritten, progress.totalBytesExpectedToWrite),
  );
  const result = await downloadResumable.downloadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`GitHub artifact download failed with status ${result?.status ?? 'unknown'}`);
  }
}

export async function downloadRunLogsZipBase64(runId: number): Promise<string> {
  return ghBinaryBase64(`${await repositoryPath()}/actions/runs/${runId}/logs`);
}

export async function deleteArtifact(artifactId: number): Promise<void> {
  try {
    await gh(`${await repositoryPath()}/actions/artifacts/${artifactId}`, { method: 'DELETE' });
  } catch {
    // Not fatal — artifacts also auto-expire.
  }
}

export async function cancelRun(runId: number): Promise<void> {
  try {
    await gh(`${await repositoryPath()}/actions/runs/${runId}/cancel`, { method: 'POST' });
  } catch {
    // Already completed — fine.
  }
}

/**
 * Re-runs a completed workflow run against the same commit it already ran
 * against. Doesn't require the branch that triggered it to still exist —
 * GitHub keeps the run tied to the commit SHA it built, independent of
 * whether the ref that pointed at it is still live. This is what makes a
 * "Retry" button on an already-finished build possible without re-uploading.
 */
export async function rerunWorkflow(runId: number): Promise<void> {
  await gh(`${await repositoryPath()}/actions/runs/${runId}/rerun`, { method: 'POST' });
}

/** Existence check only — used on resume to tell whether a push actually landed before the app died. */
export async function fileExistsOnBranch(branchName: string, path: string): Promise<boolean> {
  try {
    await gh(`${await repositoryPath()}/contents/${path}?ref=${branchName}`);
    return true;
  } catch {
    return false;
  }
}
