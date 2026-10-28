# GEM Mobile

Expo/React Native app, entirely self-contained — no backend, no EAS
Build/Submit, no Expo-hosted services. The app talks directly to
`api.github.com` using an embedded token. As far as anyone using the
compiled app is concerned, GEM builds it themselves; the GitHub layer
only becomes visible to someone who decompiles the APK and reads the
bundled JS.

GEM uses the configured GitHub token for direct GitHub API access; build uploads and Actions runs use the selected build-target repository.

## Configure the build target

Choose a GitHub repository with a base branch and GitHub Actions enabled. You can use this same GEM repository as the target. Each build pushes the selected project files and generated workflow to a temporary branch, builds an APK, downloads it, then deletes the temporary branch. If the target repo is public, those uploaded source files and the branch are visible to anyone until cleanup; GEM asks you to confirm each public build.

In GEM, open Settings → GitHub Build Target and enter the owner, repository name, and base branch. GEM stores these target fields in Android SecureStore and checks that the repository exists, the branch exists, and Actions are enabled before it starts.

The app still needs a GitHub token configured as `GITHUB_TOKEN` under `expo.extra`:

```json
"extra": {
  "GITHUB_TOKEN": "<your GT_TOKEN>",
  "GITHUB_OWNER": "<default owner for the Settings form>",
  "GITHUB_REPO": "<default target; may be GEM>",
  "GITHUB_BASE_BRANCH": "main"
}
```

The token must be able to read/write contents and run Actions in the selected target repository. Managing repository secrets needs the additional GitHub Actions secrets permission.

**First build only:** GEM checks whether `.github/workflows/gem-android.yml`
already exists on your base branch, and if not, registers it on the repository's *default branch*
(`githubClient.ts` → `ensureWorkflowRegistered`) before dispatch. GitHub
requires the workflow file on the default branch even when a build uses
a different configured base branch, so the first build may add one
workflow-registration commit to the default branch. After
that it's a no-op check on every subsequent build.

The UI uses one Material Community vector-icon set for navigation, project states, actions, and empty/error states. The custom 1024px launcher mark is a faceted violet-and-mint gem on a dark field.

## How a build actually runs (`src/lib/buildPipeline.ts`)

1. `expo-document-picker` → zip picked, immediately copied to durable
   storage (`documentDirectory/pending-uploads/`) — this is the
   checkpoint everything else resumes from
2. `zipUtils.ts` (JSZip) extracts it in memory, Zip-Slip guarded
3. `projectScanner.ts` reads manifests, package dependencies, Android
   project structure and source markers to detect project type (native
   Android, React Native, managed Expo, Flutter, Capacitor, Cordova) and
   validates the configuration. It shows the evidence and issues before
   build; it does not infer app features or review code behavior.
   `iconExtractor.ts` extracts the app icon when recognizable
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
| `expo-file-system` | reading the upload, saving the finished APK + extracted app icon |
| `jszip` | all zip extraction/creation, pure JS (no native zip module) |
| `expo-sqlite` | build history + pipeline state (local-only, per spec) |
| `expo-crypto` | generating each build's UUID |
| `expo-notifications` | live-updating build-progress notification (same identifier reused per build) |
| `expo-task-manager` + `expo-background-fetch` | resumes polling a dispatched run's status while the app is closed |
| `expo-secure-store` | encrypted storage for user-supplied AI provider keys and the build-target repository selection |
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

## Building GEM itself

`.github/workflows/build-gem.yml` builds this project into an APK via
GitHub Actions — same idea as what this app does for other projects,
just run once, manually, for GEM's own source. See "Signing a release
build" below for the release-build half of it.

The repository's own `build-gem.yml` workflow builds GEM itself. GEM's in-app builder can also use this repository as its target: it writes uploaded projects to temporary `build/{id}` branches, without overwriting the `main` source files. If the repo is public, those temporary source branches are public too, so GEM asks before uploading to a public target.

## Signing a release build

`build-gem.yml` always builds a debug APK. For an in-app Gradle release build, GEM uses the same four secrets to sign the APK and AAB when all are configured:

| Secret | What it is |
|---|---|
| `RELEASE_KEYSTORE_BASE64` | your `.keystore`/`.jks` file, base64-encoded |
| `RELEASE_STORE_PASSWORD` | keystore password |
| `RELEASE_KEY_ALIAS` | key alias inside the keystore |
| `RELEASE_KEY_PASSWORD` | password for that specific key |

Flutter release signing is not yet wired to these secrets; its workflow can produce a release APK/AAB but may be unsigned.

If you don't already have a keystore:

```bash
keytool -genkeypair -v -keystore release.keystore -alias gem-release \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore > release.keystore.b64   # paste this file's contents as RELEASE_KEYSTORE_BASE64
```

Without those secrets, the release step is skipped entirely (a notice
in the workflow run says so) rather than silently producing a
debug-signed "release" APK — Expo's default generated project signs
release builds with the debug keystore unless something overrides it,
which is exactly what `plugins/withReleaseSigning.js` exists to fix.

## Known limitations
- **No true push notifications** — everything fires from in-app
  polling or the background task. If the OS fully kills the
  background task, nothing arrives until the app reopens.
- **Android only** — iOS/Windows workflow templates aren't built yet.
- **No AI-assisted failure analysis wired up yet** — Settings stores
  and tests provider keys, but nothing sends a failed build's log to
  them for an AI explanation; failures currently only get the
  regex-based report from `logParser.ts`.
- Resumable downloads and light/dark/system theming from the original
  spec aren't built.
- **Icon extraction has limits**: works for managed Expo (`app.json`'s
  `expo.icon`) and native/bare-Android layouts (`mipmap-*/ic_launcher`
  by convention). A project using `app.config.js`/`.ts` instead of
  `app.json` won't resolve an icon (would need a JS evaluator, not a
  JSON parse) — falls back to the placeholder icon in that case, same
  as any project with no recognizable icon at all.

## `gem-backend/` (retired)

The earlier NestJS backend from this conversation is no longer part
of the architecture — everything it did now runs on-device. Kept
around only if you want to revisit a server-side design later (e.g.
if the GitHub account this uses ever needs to hold anything else).
