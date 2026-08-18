import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import { extractUploadZip, extractApkFromArtifactZip, extractTextFromLogZip, saveApkLocally } from './zipUtils';
import { scanProject, extractAppMeta } from './projectScanner';
import { generateWorkflow, WORKFLOW_PATH, WORKFLOW_FILENAME } from './workflowGenerator';
import { parseFailureLog } from './logParser';
import { upsertBuild, patchBuild, getBuild, listBuilds, type LocalBuild } from './db';
import { useBuildStore } from '../store/buildStore';
import { upsertBuildNotification } from './notifications';
import { startBuildKeepAlive, updateBuildKeepAliveMessage, stopBuildKeepAlive } from './buildKeepAlive';
import * as gh from './githubClient';

const POLL_INTERVAL_MS = 8_000;
const MAX_RUN_WAIT_MS = 30 * 60 * 1000;
const DISPATCH_CORRELATION_WINDOW_MS = 90_000; // how long we search for a run before assuming dispatch never landed

const UPLOAD_DIR = `${FileSystem.documentDirectory}pending-uploads/`;

function setStage(buildId: string, appName: string | null, status: LocalBuild['status'], stage: string) {
  useBuildStore.getState().setLive(buildId, { status, stage });
  patchBuild(buildId, { status, stage });
  upsertBuildNotification(buildId, appName, status);
  updateBuildKeepAliveMessage(stage.replace(/_/g, ' '));
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Starts a brand-new build. Persists the zip to durable storage FIRST — that's the checkpoint everything else resumes from. */
export async function runBuild(pickedLocalUri: string, originalFileName: string): Promise<string> {
  const buildId = Crypto.randomUUID();
  const appNameGuess = originalFileName.replace(/\.zip$/i, '');

  await FileSystem.makeDirectoryAsync(UPLOAD_DIR, { intermediates: true }).catch(() => undefined);
  const uploadZipPath = `${UPLOAD_DIR}${buildId}.zip`;
  await FileSystem.copyAsync({ from: pickedLocalUri, to: uploadZipPath });

  await upsertBuild({
    id: buildId,
    appName: appNameGuess,
    packageName: null,
    versionName: null,
    versionCode: null,
    status: 'queued',
    stage: 'queued',
    branchName: null,
    dispatchTime: null,
    githubRunId: null,
    uploadZipPath,
    apkSizeBytes: null,
    apkLocalPath: null,
    durationMs: null,
    scanIssues: null,
    failureReport: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  });

  runPipeline(buildId).catch(() => {
    // runPipeline handles its own failure state internally; this only
    // guards against a truly unexpected throw escaping it.
  });

  return buildId;
}

/** Called on app launch and from the background task — picks every non-terminal build back up from its last checkpoint. */
export async function resumePendingBuilds(): Promise<void> {
  const builds = await listBuilds();
  const pending = builds.filter((b) => !['completed', 'failed', 'cancelled'].includes(b.status));
  for (const build of pending) {
    runPipeline(build.id).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// The pipeline itself — every entry point (fresh start, app-launch resume,
// background-task resume) funnels through here. Every step checks what
// already happened before doing anything irreversible again.
// ---------------------------------------------------------------------------

async function runPipeline(buildId: string): Promise<void> {
  const build = await getBuild(buildId);
  if (!build || ['completed', 'failed', 'cancelled'].includes(build.status)) return;

  const appName = build.appName;
  const startedAt = build.createdAt ? new Date(build.createdAt).getTime() : Date.now();

  try {
    // ---- Already dispatched: skip straight to polling the run --------
    if (build.githubRunId) {
      await pollAndFinish(buildId, appName, build.githubRunId, build.branchName, startedAt);
      return;
    }

    // ---- Not yet dispatched: need the source, which requires the
    // persisted zip (not the in-memory list — that's gone if we're
    // resuming after a real restart). --------------------------------
    if (!build.uploadZipPath) {
      await fail(buildId, appName, 'Upload data was lost before the build could be dispatched — please re-upload.', [
        {
          errorType: 'pipeline',
          problem: 'Nothing to resume from',
          rootCause: 'No persisted upload was found for this build.',
        },
      ]);
      return;
    }

    setStage(buildId, appName, 'preparing', 'extracting_upload');
    startBuildKeepAlive(appName, 'Preparing build\u2026');
    const files = await extractUploadZip(build.uploadZipPath);

    setStage(buildId, appName, 'scanning', 'analyzing_project');
    const scan = scanProject(files);
    const meta = extractAppMeta(files);
    const blockingIssues = scan.issues.filter((i) => i.severity === 'error');

    await patchBuild(buildId, {
      packageName: meta.packageName,
      versionName: meta.versionName,
      versionCode: meta.versionCode,
      scanIssues: scan.issues,
    });

    if (scan.type === 'unknown' || blockingIssues.length > 0) {
      await fail(buildId, appName, 'Project failed validation before a build was attempted.', [
        {
          errorType: 'validation',
          problem: 'Upload did not pass pre-build validation',
          rootCause: blockingIssues.map((i) => i.message).join('; ') || 'Unrecognized project type.',
          suggestedFix: 'Fix the listed issues and re-upload.',
        },
      ]);
      return;
    }

    setStage(buildId, appName, 'generating_workflow', 'preparing_ci_config');
    const workflowYaml = generateWorkflow(scan.type);
    const pushFiles = files.map((f) => (f.isBinary ? { path: f.path, contentBase64: f.base64! } : { path: f.path, content: f.text! }));
    pushFiles.push({ path: WORKFLOW_PATH, content: workflowYaml });

    // Self-healing registration — see ensureWorkflowRegistered's comment
    // for why this has to happen against the base branch specifically,
    // not just the per-build branch pushed below.
    await gh.ensureWorkflowRegistered(WORKFLOW_PATH, workflowYaml);

    // ---- Branch: reuse if a prior attempt already created it ---------
    setStage(buildId, appName, 'uploading', 'pushing_to_build_branch');
    const branchName = build.branchName ?? `build/${buildId}`;
    let baseSha = await gh.getBranchRef(branchName);
    if (!baseSha) {
      baseSha = await gh.getBaseBranchSha();
      await gh.createBranch(branchName, baseSha);
    }
    // Checkpoint the branch name immediately — before the push, not after —
    // so a crash mid-push still knows the branch exists on resume.
    await patchBuild(buildId, { branchName });

    // pushFiles always creates fresh blobs/tree/commit and force-updates
    // the ref, so re-running it on resume is safe even if a previous
    // attempt partially or fully completed it.
    await gh.pushFiles(branchName, baseSha, pushFiles, `GEM build ${buildId}`);

    // ---- Dispatch: the one genuinely non-idempotent step -------------
    setStage(buildId, appName, 'starting_runner', 'dispatching_workflow');
    let dispatchTime = build.dispatchTime;
    let dispatched: gh.DispatchedRun | null = null;

    if (dispatchTime) {
      // A previous attempt may have already dispatched — search for its
      // run before dispatching again, to avoid firing a duplicate build.
      dispatched = await pollUntil(
        () => gh.findDispatchedRun(WORKFLOW_FILENAME, branchName, dispatchTime!),
        (r) => r !== null,
        DISPATCH_CORRELATION_WINDOW_MS,
      );
    }

    if (!dispatched) {
      dispatchTime = new Date().toISOString();
      await patchBuild(buildId, { dispatchTime });
      await gh.dispatchWorkflow(WORKFLOW_FILENAME, branchName, { build_id: buildId });
      dispatched = await pollUntil(
        () => gh.findDispatchedRun(WORKFLOW_FILENAME, branchName, dispatchTime!),
        (r) => r !== null,
        60_000,
      );
    }

    if (!dispatched) throw new Error('Timed out waiting for the dispatched workflow run to appear.');
    await patchBuild(buildId, { githubRunId: dispatched.runId });

    // The risky window is over — a confirmed run id means resume logic
    // alone is enough from here, so release the elevated process priority.
    stopBuildKeepAlive();

    // Upload is now safely represented on GitHub's side — the local
    // copy has served its purpose.
    await FileSystem.deleteAsync(build.uploadZipPath, { idempotent: true }).catch(() => undefined);
    await patchBuild(buildId, { uploadZipPath: null });

    await pollAndFinish(buildId, appName, dispatched.runId, branchName, startedAt);
  } catch (err: any) {
    stopBuildKeepAlive();
    await fail(buildId, appName, err.message, [{ errorType: 'pipeline', problem: 'GEM build pipeline error', rootCause: err.message }]);
  } finally {
    stopBuildKeepAlive();
    useBuildStore.getState().clearLive(buildId);
  }
}

async function pollAndFinish(buildId: string, appName: string | null, runId: number, branchName: string | null, startedAt: number): Promise<void> {
  try {
    setStage(buildId, appName, 'building', 'compiling');
    const finalRun = await pollUntil(() => gh.getRun(runId), (r) => r.status === 'completed', MAX_RUN_WAIT_MS);
    if (!finalRun) throw new Error('Build timed out.');

    if (finalRun.conclusion === 'success') {
      await finishSuccessfulBuild(buildId, appName, runId, startedAt);
    } else {
      await finishFailedBuild(buildId, appName, runId, finalRun.conclusion ?? 'unknown', startedAt);
    }
  } finally {
    if (branchName) await gh.deleteBranch(branchName).catch(() => undefined);
  }
}

export async function finishSuccessfulBuild(buildId: string, appName: string | null, runId: number, startedAt: number): Promise<void> {
  setStage(buildId, appName, 'downloading', 'fetching_artifact');
  const artifacts = await gh.listArtifacts(runId);
  const artifact = artifacts.find((a) => a.name === `gem-build-${buildId}`);
  if (!artifact) throw new Error('Build succeeded but no artifact was produced.');

  const artifactZipBase64 = await gh.downloadArtifactZipBase64(artifact.id);
  const { name, base64 } = await extractApkFromArtifactZip(artifactZipBase64);
  const saved = await saveApkLocally(buildId, name, base64);

  const build = await getBuild(buildId);
  await patchBuild(buildId, {
    status: 'completed',
    stage: 'completed',
    apkSizeBytes: saved.sizeBytes,
    apkLocalPath: saved.uri,
    durationMs: Date.now() - startedAt,
    completedAt: new Date().toISOString(),
    appName: appName || build?.packageName?.split('.').pop() || 'app',
  });
  await upsertBuildNotification(buildId, appName, 'completed');
  await gh.deleteArtifact(artifact.id);
}

export async function finishFailedBuild(buildId: string, appName: string | null, runId: number, conclusion: string, startedAt: number): Promise<void> {
  const rawLogZipBase64 = await gh.downloadRunLogsZipBase64(runId);
  const rawLogText = await extractTextFromLogZip(rawLogZipBase64);
  const report = parseFailureLog(rawLogText);
  await fail(buildId, appName, `Build failed (conclusion: ${conclusion}).`, report, Date.now() - startedAt);
}

async function fail(buildId: string, appName: string | null, message: string, report: any[], durationMs?: number): Promise<void> {
  const build = await getBuild(buildId);
  if (build?.uploadZipPath) {
    await FileSystem.deleteAsync(build.uploadZipPath, { idempotent: true }).catch(() => undefined);
  }
  await patchBuild(buildId, {
    status: 'failed',
    stage: 'failed',
    errorMessage: message,
    failureReport: report,
    durationMs: durationMs ?? null,
    completedAt: new Date().toISOString(),
    uploadZipPath: null,
  });
  await upsertBuildNotification(buildId, appName, 'failed');
}

async function pollUntil<T>(fn: () => Promise<T>, isDone: (v: T) => boolean, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (isDone(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return null;
}
