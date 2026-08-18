# GEM Mobile

Expo/React Native app, entirely self-contained — no backend, no EAS
Build/Submit, no Expo-hosted services. The app talks directly to
`api.github.com` using an embedded token. As far as anyone using the
compiled app is concerned, GEM builds it themselves; the GitHub layer
only becomes visible to someone who decompiles the APK and reads the
bundled JS.

**This intentionally holds a full read/write GitHub token client-side.**
That was an explicit decision (see conversation) for a dedicated
throwaway GitHub account with nothing else on it — not a default
recommendation. If this account ever holds anything else, or the app
gets wide distribution, revisit that.

## Before building

Edit `app.json` → `expo.extra`:

```json
"extra": {
  "GITHUB_TOKEN": "<your GT_TOKEN>",
  "GITHUB_OWNER": "<your username or org>",
  "GITHUB_REPO": "<the private repo GEM builds through>",
  "GITHUB_BASE_BRANCH": "main"
}
```

The target repo needs at least one commit on that base branch and
Actions enabled. `GT_TOKEN_KEY` (admin) is intentionally **not**
referenced anywhere in this app — nothing in the pipeline needs
elevated scope, so it stays out entirely.

**First build only:** GEM checks whether `.github/workflows/gem-android.yml`
already exists on your base branch, and if not, commits it there
directly (`githubClient.ts` → `ensureWorkflowRegistered`) before doing
anything else. This is required, not optional — GitHub only treats a
`workflow_dispatch` workflow as dispatchable via the API once it
exists on the *default* branch specifically; a per-build temp branch
having the file isn't enough on its own. So expect one extra commit
to land on your base branch the first time you run a build. After
that it's a no-op check on every subsequent build.

## How a build actually runs (all on-device, `src/lib/buildPipeline.ts`)

1. `expo-document-picker` → zip picked, immediately copied to durable
   storage (`documentDirectory/pending-uploads/`) — this is the
   checkpoint everything else resumes from
2. `zipUtils.ts` (JSZip) extracts it in memory, Zip-Slip guarded
3. `projectScanner.ts` detects project type + validates structure
4. `workflowGenerator.ts` produces `.github/workflows/gem-android.yml`
5. The native foreground service starts here (see below) — the branch
   create/push/dispatch sequence is the one part of the pipeline that
   can't just be re-run from a cold start without risk of duplicating
   a dispatched build
6. `githubClient.ts` creates a throwaway branch (or reuses one from a
   prior attempt), pushes every file via the Git Data API, dispatches
   the workflow, and polls for the correlated run — checking first
   whether a previous attempt's dispatch already landed before firing
   another one
7. Once a run id is confirmed, the foreground service stops and the
   local upload copy is deleted — from here, ordinary background
   polling is enough
8. On success: downloads the artifact, extracts the APK (`zipUtils.ts`),
   saves it to `expo-file-system`, deletes the GitHub artifact
9. On failure: downloads run logs, `logParser.ts` turns them into a
   structured, deduplicated report — no AI call needed
10. The branch is always deleted once the run reaches a terminal state

Every step from #1 onward is resumable — `resumePendingBuilds()` runs
on app launch and from the background task, and re-enters this exact
same pipeline function, which checks what already happened (branch
exists? already dispatched? run already completed?) before repeating
any step.

`zustand` (`src/store/buildStore.ts`) holds the live in-memory stage
while a build is running in the current session; `expo-sqlite`
(`src/lib/db.ts`) is the persisted source of truth everything else
reads from — history, the build detail screen, and the background task.

## Expo components in use

| Component | What it's used for |
|---|---|
| `expo-document-picker` | picking the project `.zip` |
| `expo-file-system` | reading the upload, saving the finished APK |
| `jszip` | all zip extraction/creation, pure JS (no native zip module) |
| `expo-sqlite` | build history + pipeline state (local-only, per spec) |
| `expo-crypto` | generating each build's UUID |
| `expo-notifications` | live-updating build-progress notification (same identifier reused per build) |
| `expo-task-manager` + `expo-background-fetch` | resumes polling a dispatched run's status while the app is closed |
| `expo-secure-store` | encrypted storage for user-supplied AI provider keys |
| `expo-sharing` / `expo-intent-launcher` | opening/sharing the finished APK |
| `expo-router` | screens/navigation |

## Native module: `modules/gem-foreground-service`

Closes the last gap from checkpointing alone: the few seconds between
copying an upload to disk and confirming GitHub dispatched a run. A
real Android foreground service (`BuildKeepAliveService.kt`) holds the
app process at foreground priority for exactly that window — it does
no work itself, it just makes the OS much less likely to kill the
process while `buildPipeline.ts` is mid push/dispatch. It's started
right before the risky work begins and stopped the moment a run id is
confirmed (`src/lib/buildKeepAlive.ts` / `buildPipeline.ts`); after
that point, the checkpoint/resume logic alone is enough.

**Requires a dev client, not Expo Go.** Custom native modules like
this one only work in a build produced by `expo run:android` (which
this project already uses) — Expo Go can't load them. If you're
currently testing in Expo Go, that stops working the moment this
module is added; you'll need `npx expo run:android` (or a
same-shaped dev-client build) from here on.

Local modules under `modules/` are autolinked automatically by Expo's
tooling as of recent SDK versions — no extra config needed beyond
what's already in `app.json`. If it doesn't get picked up, run
`npx expo-modules-autolinking verify` to check discovery.

## Known limitations
- **No true push notifications** — everything fires from in-app
  polling or the background task. If the OS fully kills the
  background task, nothing arrives until the app reopens.
- **Android only** — iOS/Windows workflow templates aren't built yet.
- **No AI-assisted failure analysis wired up yet** — Settings stores
  and tests provider keys, but nothing sends a failed build's log to
  them for an AI explanation; failures currently only get the
  regex-based report from `logParser.ts`.
- App-icon extraction for history rows, resumable downloads, and
  light/dark/system theming from the original spec aren't built.

## `gem-backend/` (retired)

The earlier NestJS backend from this conversation is no longer part
of the architecture — everything it did now runs on-device. Kept
around only if you want to revisit a server-side design later (e.g.
if the GitHub account this uses ever needs to hold anything else).
