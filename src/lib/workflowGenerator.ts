import type { ProjectType } from './projectScanner';
import type { BuildProfile } from './db';

export const WORKFLOW_PATH = '.github/workflows/gem-android.yml';
export const WORKFLOW_FILENAME = 'gem-android.yml';

/**
 * Caches Gradle's dependency/wrapper downloads between runs, keyed on every
 * gradle config file in the project so a dependency change invalidates it.
 * `restore-keys` still lets a partial hit (older lockfile) warm-start instead
 * of a fully cold cache. Placed once per workflow, right after JDK setup —
 * safe to include even for projects with no committed gradlew, since Gradle
 * only ever writes into `~/.gradle` once it's actually invoked below.
 */
function gradleCacheStep(): string {
  return '      - name: Cache Gradle\n' +
    '        uses: actions/cache@v4\n' +
    '        with:\n' +
    '          path: |\n' +
    '            ~/.gradle/caches\n' +
    '            ~/.gradle/wrapper\n' +
    "          key: gradle-${{ runner.os }}-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}\n" +
    '          restore-keys: |\n' +
    '            gradle-${{ runner.os }}-\n';
}

/**
 * Release signing, without ever committing a keystore or touching the
 * uploaded project's build.gradle.
 *
 * Two steps: decode the base64 keystore secret to a runner-local temp file,
 * then compute Android Gradle Plugin's officially-supported "injected
 * signing" command-line properties (`android.injected.signing.*`) from repo
 * secrets. AGP applies these automatically to the release build type as
 * long as that build type doesn't already declare its own signingConfig —
 * true for the vast majority of freshly-generated / template projects,
 * including everything `expo prebuild` produces. Projects that already
 * define an explicit release signingConfig in build.gradle will need to
 * reference these same secret names themselves; GEM can't safely rewrite
 * an uploaded build.gradle without risking breaking it.
 *
 * All four secrets — ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD,
 * ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD — are optional. If unset, the
 * signing_args step just emits an empty string and the build falls back to
 * an unsigned release artifact rather than failing outright.
 */
function releaseSigningSteps(): string {
  return '      - name: Decode signing keystore\n' +
    '        id: keystore\n' +
    "        if: ${{ secrets.ANDROID_KEYSTORE_BASE64 != '' }}\n" +
    '        run: |\n' +
    '          echo "$KEYSTORE_BASE64" | base64 -d > "$RUNNER_TEMP/release.keystore"\n' +
    '          echo "path=$RUNNER_TEMP/release.keystore" >> "$GITHUB_OUTPUT"\n' +
    '        env:\n' +
    '          KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}\n' +
    '\n' +
    '      - name: Prepare release signing arguments\n' +
    '        id: signing_args\n' +
    '        run: |\n' +
    '          if [ -n "$KEYSTORE_PATH" ]; then\n' +
    '            echo "args=-Pandroid.injected.signing.store.file=$KEYSTORE_PATH -Pandroid.injected.signing.store.password=$KEYSTORE_PASSWORD -Pandroid.injected.signing.key.alias=$KEY_ALIAS -Pandroid.injected.signing.key.password=$KEY_PASSWORD" >> "$GITHUB_OUTPUT"\n' +
    '          else\n' +
    '            echo "No signing keystore configured — release artifact will be unsigned. Add ANDROID_KEYSTORE_BASE64 etc. in Secrets to sign it." >&2\n' +
    '            echo "args=" >> "$GITHUB_OUTPUT"\n' +
    '          fi\n' +
    '        env:\n' +
    '          KEYSTORE_PATH: ${{ steps.keystore.outputs.path }}\n' +
    '          KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}\n' +
    '          KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}\n' +
    '          KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}\n';
}

/**
 * Push notifications, no backend.
 *
 * The GitHub Actions runner itself calls FCM directly - there's no webhook
 * receiver, no server, no Cloud Function. The runner already knows exactly
 * when the build starts, succeeds, or fails, so it just POSTs to Google's
 * FCM HTTP v1 API in those moments.
 *
 * FCM's legacy server-key API was fully shut down in 2024 - HTTP v1 requires
 * a short-lived OAuth2 access token, minted here from a service account key
 * using Google's official `google-auth` Python library (preinstalled on
 * GitHub-hosted runners' Python, well-documented, stable contract - safer
 * than depending on a third-party auth Action's exact behavior).
 *
 * Two repo secrets required (see README/Settings screen for setup steps):
 *   - FIREBASE_SERVICE_ACCOUNT_JSON: full contents of a Firebase service
 *     account key (Firebase Console -> Project Settings -> Service accounts
 *     -> Generate new private key). Its project_id field is reused directly,
 *     so no separate FIREBASE_PROJECT_ID secret is needed.
 *   - FCM_DEVICE_TOKEN: the phone's FCM device token, copyable from GEM's
 *     Settings screen. Static single-device token, not a rotating backend -
 *     if it ever changes (reinstall, data clear), just re-copy it in.
 *
 * Every notify step has `continue-on-error: true` - a notification hiccup
 * must never break the actual build.
 */
function fcmAuthAndStartStep(): string {
  return `      - name: Authenticate to Firebase Cloud Messaging
        id: fcm_auth
        if: \${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON != '' }}
        continue-on-error: true
        run: |
          pip install --quiet google-auth
          python3 - <<'PYEOF'
          import json, os
          from google.oauth2 import service_account
          from google.auth.transport.requests import Request

          info = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
          creds = service_account.Credentials.from_service_account_info(
              info, scopes=["https://www.googleapis.com/auth/firebase.messaging"]
          )
          creds.refresh(Request())
          with open(os.environ["GITHUB_OUTPUT"], "a") as f:
              f.write(f"access_token={creds.token}\\n")
              f.write(f"project_id={info['project_id']}\\n")
          PYEOF
        env:
          FIREBASE_SERVICE_ACCOUNT_JSON: \${{ secrets.FIREBASE_SERVICE_ACCOUNT_JSON }}

      - name: Notify build started (FCM)
        if: steps.fcm_auth.outcome == 'success'
        continue-on-error: true
        run: |
          curl -sS -X POST \\
            "https://fcm.googleapis.com/v1/projects/\${{ steps.fcm_auth.outputs.project_id }}/messages:send" \\
            -H "Authorization: Bearer \${{ steps.fcm_auth.outputs.access_token }}" \\
            -H "Content-Type: application/json" \\
            -d '{
              "message": {
                "token": "\${{ secrets.FCM_DEVICE_TOKEN }}",
                "notification": {
                  "title": "GEM build started",
                  "body": "Building \${{ inputs.app_name }}\\u2026"
                },
                "data": { "buildId": "\${{ inputs.build_id }}", "status": "started" },
                "android": { "priority": "high" }
              }
            }'
`;
}

function notifySuccessStep(): string {
  return `      - name: Notify build succeeded (FCM)
        if: success() && steps.fcm_auth.outcome == 'success'
        continue-on-error: true
        run: |
          curl -sS -X POST \\
            "https://fcm.googleapis.com/v1/projects/\${{ steps.fcm_auth.outputs.project_id }}/messages:send" \\
            -H "Authorization: Bearer \${{ steps.fcm_auth.outputs.access_token }}" \\
            -H "Content-Type: application/json" \\
            -d '{
              "message": {
                "token": "\${{ secrets.FCM_DEVICE_TOKEN }}",
                "notification": {
                  "title": "\${{ inputs.app_name }} build ready",
                  "body": "Your APK finished building - tap to download."
                },
                "data": { "buildId": "\${{ inputs.build_id }}", "status": "success" },
                "android": { "priority": "high" }
              }
            }'
`;
}

function notifyFailureStep(): string {
  return `      - name: Notify build failed (FCM)
        if: failure() && steps.fcm_auth.outcome == 'success'
        continue-on-error: true
        run: |
          RUN_URL="\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}"
          curl -sS -X POST \\
            "https://fcm.googleapis.com/v1/projects/\${{ steps.fcm_auth.outputs.project_id }}/messages:send" \\
            -H "Authorization: Bearer \${{ steps.fcm_auth.outputs.access_token }}" \\
            -H "Content-Type: application/json" \\
            -d '{
              "message": {
                "token": "\${{ secrets.FCM_DEVICE_TOKEN }}",
                "notification": {
                  "title": "\${{ inputs.app_name }} build failed",
                  "body": "Tap to see the failed step in the run log."
                },
                "data": { "buildId": "\${{ inputs.build_id }}", "status": "failed", "runUrl": "'"$RUN_URL"'" },
                "android": { "priority": "high" }
              }
            }'
`;
}

function header(): string {
  return `name: gem-android-build

on:
  workflow_dispatch:
    inputs:
      build_id:
        required: true
        type: string
      app_name:
        required: false
        type: string
        default: 'your app'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

${fcmAuthAndStartStep()}
      - name: Setup JDK
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
`;
}

function uploadStep(profile: BuildProfile): string {
  const aabSteps =
    profile === 'release'
      ? '\n' +
        '      - name: Locate AAB\n' +
        '        id: aab\n' +
        '        run: |\n' +
        '          AAB_PATH=$(find . -path "*/outputs/bundle/*" -name "*.aab" | head -n 1 || true)\n' +
        '          echo "path=$AAB_PATH" >> "$GITHUB_OUTPUT"\n' +
        '\n' +
        '      - name: Upload AAB artifact\n' +
        "        if: steps.aab.outputs.path != ''\n" +
        '        uses: actions/upload-artifact@v4\n' +
        '        with:\n' +
        '          name: gem-build-${{ inputs.build_id }}-aab\n' +
        '          path: ${{ steps.aab.outputs.path }}\n' +
        '          retention-days: 1\n'
      : '';

  return (
    '      - name: Locate APK\n' +
    '        id: apk\n' +
    '        run: |\n' +
    '          APK_PATH=$(find . -path "*/outputs/apk/*" -name "*.apk" | head -n 1)\n' +
    '          if [ -z "$APK_PATH" ]; then\n' +
    '            echo "No APK found under outputs/apk" >&2\n' +
    '            exit 1\n' +
    '          fi\n' +
    '          echo "path=$APK_PATH" >> "$GITHUB_OUTPUT"\n' +
    '\n' +
    '      - name: Upload APK artifact\n' +
    '        uses: actions/upload-artifact@v4\n' +
    '        with:\n' +
    '          name: gem-build-${{ inputs.build_id }}\n' +
    '          path: ${{ steps.apk.outputs.path }}\n' +
    '          retention-days: 1\n' +
    aabSteps +
    '\n' +
    notifySuccessStep()
  );
}

/** `assembleDebug` for debug builds; signed `assembleRelease bundleRelease` (APK + AAB) for release. */
function gradleBuildStep(profile: BuildProfile, gradlewInvocation: string): string {
  if (profile === 'release') {
    return (
      '      - name: Build release APK + AAB\n' +
      '        run: ' + gradlewInvocation + ' assembleRelease bundleRelease ${{ steps.signing_args.outputs.args }} --stacktrace\n'
    );
  }
  return '      - name: Build debug APK\n' + '        run: ' + gradlewInvocation + ' assembleDebug --stacktrace\n';
}

function nativeAndroid(profile: BuildProfile): string {
  return (
    header() +
    '\n' +
    '      - name: Generate Gradle wrapper if missing\n' +
    '        run: |\n' +
    '          if [ ! -f "./gradlew" ]; then\n' +
    '            echo "gradlew not found in upload — generating with the runner\'s system Gradle."\n' +
    '            gradle wrapper --gradle-version 8.7\n' +
    '          fi\n' +
    '\n' +
    '      - name: Grant execute permission for gradlew\n' +
    '        run: chmod +x ./gradlew\n' +
    '\n' +
    gradleCacheStep() +
    (profile === 'release' ? '\n' + releaseSigningSteps() : '') +
    '\n' +
    gradleBuildStep(profile, './gradlew') +
    uploadStep(profile) +
    notifyFailureStep()
  );
}

function reactNativeAndroid(profile: BuildProfile): string {
  return (
    header() +
    '\n' +
    '      - name: Setup Node.js\n' +
    '        uses: actions/setup-node@v4\n' +
    '        with:\n' +
    "          node-version: '20'\n" +
    "          cache: 'npm'\n" +
    '\n' +
    '      - name: Install dependencies\n' +
    '        run: npm ci\n' +
    '\n' +
    '      - name: Grant execute permission for gradlew\n' +
    '        run: chmod +x ./android/gradlew\n' +
    '\n' +
    gradleCacheStep() +
    (profile === 'release' ? '\n' + releaseSigningSteps() : '') +
    '\n' +
    gradleBuildStep(profile, 'cd android && ./gradlew') +
    uploadStep(profile) +
    notifyFailureStep()
  );
}

function expoManagedAndroid(profile: BuildProfile): string {
  return (
    header() +
    '\n' +
    '      - name: Setup Node.js\n' +
    '        uses: actions/setup-node@v4\n' +
    '        with:\n' +
    "          node-version: '20'\n" +
    "          cache: 'npm'\n" +
    '\n' +
    '      - name: Install dependencies\n' +
    '        run: npm install\n' +
    '\n' +
    '      - name: Align Expo package versions with SDK\n' +
    '        # Catches mismatched expo-* module versions (compiles fine,\n' +
    '        # throws NoSuchMethodError/NoClassDefFoundError against\n' +
    '        # expo-modules-core at runtime instead) before they reach a build.\n' +
    '        run: npx expo install --fix\n' +
    '\n' +
    '      - name: Prebuild native Android project\n' +
    '        # Generates android/ from app.json + config plugins. Runs\n' +
    '        # entirely locally on the runner - no Expo account, token, or\n' +
    '        # cloud service involved.\n' +
    '        run: npx expo prebuild --platform android --clean --no-install\n' +
    '\n' +
    '      - name: Grant execute permission for gradlew\n' +
    '        run: chmod +x android/gradlew\n' +
    '\n' +
    gradleCacheStep() +
    (profile === 'release' ? '\n' + releaseSigningSteps() : '') +
    '\n' +
    gradleBuildStep(profile, 'cd android && ./gradlew') +
    uploadStep(profile) +
    notifyFailureStep()
  );
}

function flutterAndroid(profile: BuildProfile): string {
  // Flutter's release signing goes through android/key.properties, a different
  // mechanism than AGP's injected signing props used above — out of scope for
  // this pass. Release here still produces an (unsigned) app bundle + APK via
  // Flutter's own build, just without GEM wiring a keystore in automatically.
  const buildCmd =
    profile === 'release' ? 'flutter build apk --release && flutter build appbundle --release' : 'flutter build apk --debug';
  return (
    header() +
    '\n' +
    '      - name: Setup Flutter\n' +
    '        uses: subosito/flutter-action@v2\n' +
    '        with:\n' +
    "          channel: 'stable'\n" +
    '\n' +
    '      - name: Cache pub packages\n' +
    '        uses: actions/cache@v4\n' +
    '        with:\n' +
    '          path: |\n' +
    '            ~/.pub-cache\n' +
    "          key: pub-${{ runner.os }}-${{ hashFiles('**/pubspec.lock') }}\n" +
    '          restore-keys: |\n' +
    '            pub-${{ runner.os }}-\n' +
    '\n' +
    '      - name: Install dependencies\n' +
    '        run: flutter pub get\n' +
    '\n' +
    '      - name: Build APK' + (profile === 'release' ? ' + AAB' : '') + '\n' +
    '        run: ' + buildCmd + '\n' +
    uploadStep(profile) +
    notifyFailureStep()
  );
}

export function generateWorkflow(type: ProjectType, profile: BuildProfile = 'debug'): string {
  switch (type) {
    case 'expo-managed':
      return expoManagedAndroid(profile);
    case 'react-native':
      return reactNativeAndroid(profile);
    case 'flutter':
      return flutterAndroid(profile);
    case 'android-native-kotlin':
    case 'android-native-java':
    default:
      return nativeAndroid(profile);
  }
}
