import * as SQLite from 'expo-sqlite';
import type { ScanIssue } from './projectScanner';
import type { ParsedFailure } from './logParser';

export type LocalBuildStatus =
  | 'queued'
  | 'preparing'
  | 'scanning'
  | 'generating_workflow'
  | 'uploading'
  | 'starting_runner'
  | 'building'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface LocalBuild {
  id: string;
  appName: string | null;
  packageName: string | null;
  versionName: string | null;
  versionCode: number | null;
  status: LocalBuildStatus;
  stage: string | null;
  branchName: string | null;
  dispatchTime: string | null;
  githubRunId: number | null;
  uploadZipPath: string | null;
  appIconPath: string | null;
  apkSizeBytes: number | null;
  apkLocalPath: string | null;
  durationMs: number | null;
  scanIssues: ScanIssue[] | null;
  failureReport: ParsedFailure[] | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

type Row = Omit<LocalBuild, 'scanIssues' | 'failureReport'> & { scanIssues: string | null; failureReport: string | null };

let dbInstance: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync('gem.db');
  await dbInstance.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY NOT NULL,
      appName TEXT,
      packageName TEXT,
      versionName TEXT,
      versionCode INTEGER,
      status TEXT NOT NULL,
      stage TEXT,
      branchName TEXT,
      dispatchTime TEXT,
      githubRunId INTEGER,
      uploadZipPath TEXT,
      appIconPath TEXT,
      apkSizeBytes INTEGER,
      apkLocalPath TEXT,
      durationMs INTEGER,
      scanIssues TEXT,
      failureReport TEXT,
      errorMessage TEXT,
      createdAt TEXT NOT NULL,
      completedAt TEXT
    );
  `);
  // Lightweight migration for installs created before these columns
  // existed — CREATE TABLE IF NOT EXISTS won't add them retroactively.
  for (const col of ['branchName TEXT', 'dispatchTime TEXT', 'githubRunId INTEGER', 'uploadZipPath TEXT', 'appIconPath TEXT']) {
    await dbInstance.execAsync(`ALTER TABLE builds ADD COLUMN ${col};`).catch(() => undefined);
  }
  return dbInstance;
}

function rowToBuild(row: Row): LocalBuild {
  return {
    ...row,
    scanIssues: row.scanIssues ? JSON.parse(row.scanIssues) : null,
    failureReport: row.failureReport ? JSON.parse(row.failureReport) : null,
  };
}

export async function upsertBuild(build: LocalBuild): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO builds
      (id, appName, packageName, versionName, versionCode, status, stage, branchName, dispatchTime, githubRunId,
       uploadZipPath, appIconPath, apkSizeBytes, apkLocalPath, durationMs, scanIssues, failureReport, errorMessage, createdAt, completedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
      appName=excluded.appName, packageName=excluded.packageName, versionName=excluded.versionName,
      versionCode=excluded.versionCode, status=excluded.status, stage=excluded.stage,
      branchName=excluded.branchName, dispatchTime=excluded.dispatchTime, githubRunId=excluded.githubRunId,
      uploadZipPath=excluded.uploadZipPath, appIconPath=excluded.appIconPath,
      apkSizeBytes=excluded.apkSizeBytes, apkLocalPath=excluded.apkLocalPath,
      durationMs=excluded.durationMs, scanIssues=excluded.scanIssues, failureReport=excluded.failureReport,
      errorMessage=excluded.errorMessage, completedAt=excluded.completedAt;`,
    [
      build.id,
      build.appName,
      build.packageName,
      build.versionName,
      build.versionCode,
      build.status,
      build.stage,
      build.branchName,
      build.dispatchTime,
      build.githubRunId,
      build.uploadZipPath,
      build.appIconPath,
      build.apkSizeBytes,
      build.apkLocalPath,
      build.durationMs,
      build.scanIssues ? JSON.stringify(build.scanIssues) : null,
      build.failureReport ? JSON.stringify(build.failureReport) : null,
      build.errorMessage,
      build.createdAt,
      build.completedAt,
    ],
  );
}

/** Convenience partial-update for pipeline stage transitions — reads, merges, writes. */
export async function patchBuild(id: string, patch: Partial<LocalBuild>): Promise<LocalBuild> {
  const existing = await getBuild(id);
  const merged: LocalBuild = { ...(existing as LocalBuild), ...patch, id };
  await upsertBuild(merged);
  return merged;
}

export async function listBuilds(): Promise<LocalBuild[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT * FROM builds ORDER BY createdAt DESC;');
  return rows.map(rowToBuild);
}

export async function getBuild(id: string): Promise<LocalBuild | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM builds WHERE id = ?;', [id]);
  return row ? rowToBuild(row) : null;
}

export async function deleteBuild(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM builds WHERE id = ?;', [id]);
}

export async function clearHistory(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM builds;');
}

/** Every build not yet in a terminal state — covers both pre-dispatch (resume via uploadZipPath) and post-dispatch (resume via githubRunId) cases. */
export async function resumableBuildIds(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM builds WHERE status NOT IN ('completed', 'failed', 'cancelled');`,
  );
  return rows.map((r) => r.id);
}
