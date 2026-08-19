import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? {};
const TOKEN: string = extra.GITHUB_TOKEN ?? '';
const OWNER: string = extra.GITHUB_OWNER ?? '';
const REPO: string = extra.GITHUB_REPO ?? '';
const BASE_BRANCH: string = extra.GITHUB_BASE_BRANCH ?? 'main';

const API_ROOT = 'https://api.github.com';

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
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
  const res = await fetch(`${API_ROOT}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
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

export async function getFileSha(branchName: string, path: string): Promise<string | null> {
  try {
    const data = await gh<{ sha: string }>(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${branchName}`);
    return data.sha;
  } catch {
    return null;
  }
}

export async function putFile(branchName: string, path: string, content: string, message: string, existingSha: string | null): Promise<void> {
  await gh(`/repos/${OWNER}/${REPO}/contents/${path}`, {
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
  const existingSha = await getFileSha(BASE_BRANCH, path);
  if (existingSha) return; // already registered — nothing to do
  await putFile(BASE_BRANCH, path, content, 'GEM: register build workflow on default branch', null);
}

export async function getBaseBranchSha(): Promise<string> {
  const data = await gh<{ object: { sha: string } }>(`/repos/${OWNER}/${REPO}/git/ref/heads/${BASE_BRANCH}`);
  return data.object.sha;
}

export async function getBranchRef(branchName: string): Promise<string | null> {
  try {
    const data = await gh<{ object: { sha: string } }>(`/repos/${OWNER}/${REPO}/git/ref/heads/${branchName}`);
    return data.object.sha;
  } catch {
    return null;
  }
}

export async function createBranch(branchName: string, fromSha: string): Promise<void> {
  await gh(`/repos/${OWNER}/${REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
  });
}

export async function deleteBranch(branchName: string): Promise<void> {
  try {
    await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${branchName}`, { method: 'DELETE' });
  } catch {
    // Idempotent cleanup — already gone is fine.
  }
}

export async function pushFiles(branchName: string, baseSha: string, files: PushFile[], message: string): Promise<string> {
  const baseCommit = await gh<{ tree: { sha: string } }>(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);

  const blobs: { path: string; sha: string }[] = [];
  for (const file of files) {
    const isBinary = !!file.contentBase64;
    const blob = await gh<{ sha: string }>(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: isBinary ? file.contentBase64 : file.content,
        encoding: isBinary ? 'base64' : 'utf-8',
      }),
    });
    blobs.push({ path: file.path, sha: blob.sha });
  }

  const newTree = await gh<{ sha: string }>(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseCommit.tree.sha,
      tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
    }),
  });

  const newCommit = await gh<{ sha: string }>(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }),
  });

  await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${branchName}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha, force: true }),
  });

  return newCommit.sha;
}

export async function dispatchWorkflow(workflowFile: string, ref: string, inputs: Record<string, string>): Promise<void> {
  await gh(`/repos/${OWNER}/${REPO}/actions/workflows/${workflowFile}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref, inputs }),
  });
}

export interface DispatchedRun {
  runId: number;
  htmlUrl: string;
  status: string;
}

export async function findDispatchedRun(workflowFile: string, branchName: string, sinceIso: string): Promise<DispatchedRun | null> {
  const data = await gh<{ workflow_runs: { id: number; html_url: string; status: string; created_at: string }[] }>(
    `/repos/${OWNER}/${REPO}/actions/workflows/${workflowFile}/runs?branch=${branchName}&per_page=5`,
  );
  const candidates = data.workflow_runs.filter((r) => new Date(r.created_at) >= new Date(sinceIso));
  if (candidates.length === 0) return null;
  const run = candidates.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  return { runId: run.id, htmlUrl: run.html_url, status: run.status };
}

export async function getRun(runId: number): Promise<{ status: string; conclusion: string | null; html_url: string }> {
  return gh(`/repos/${OWNER}/${REPO}/actions/runs/${runId}`);
}

export async function listArtifacts(runId: number): Promise<{ id: number; name: string }[]> {
  const data = await gh<{ artifacts: { id: number; name: string }[] }>(`/repos/${OWNER}/${REPO}/actions/runs/${runId}/artifacts`);
  return data.artifacts;
}

export async function downloadArtifactZipBase64(artifactId: number): Promise<string> {
  return ghBinaryBase64(`/repos/${OWNER}/${REPO}/actions/artifacts/${artifactId}/zip`);
}

export async function downloadRunLogsZipBase64(runId: number): Promise<string> {
  return ghBinaryBase64(`/repos/${OWNER}/${REPO}/actions/runs/${runId}/logs`);
}

export async function deleteArtifact(artifactId: number): Promise<void> {
  try {
    await gh(`/repos/${OWNER}/${REPO}/actions/artifacts/${artifactId}`, { method: 'DELETE' });
  } catch {
    // Not fatal — artifacts also auto-expire.
  }
}

export async function cancelRun(runId: number): Promise<void> {
  try {
    await gh(`/repos/${OWNER}/${REPO}/actions/runs/${runId}/cancel`, { method: 'POST' });
  } catch {
    // Already completed — fine.
  }
}

/** Existence check only — used on resume to tell whether a push actually landed before the app died. */
export async function fileExistsOnBranch(branchName: string, path: string): Promise<boolean> {
  try {
    await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${branchName}`);
    return true;
  } catch {
    return false;
  }
}
