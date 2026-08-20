import type { ProjectType } from './projectScanner';

export const WORKFLOW_PATH = '.github/workflows/gem-android.yml';
export const WORKFLOW_FILENAME = 'gem-android.yml';

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

function uploadStep(): string {
  return `      - name: Locate APK
        id: apk
        run: |
          APK_PATH=$(find . -path "*/outputs/apk/*" -name "*.apk" | head -n 1)
          if [ -z "$APK_PATH" ]; then
            echo "No APK found under outputs/apk" >&2
            exit 1
          fi
          echo "path=$APK_PATH" >> "$GITHUB_OUTPUT"

      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: gem-build-\${{ inputs.build_id }}
          path: \${{ steps.apk.outputs.path }}
          retention-days: 1

${notifySuccessStep()}`;
}

function nativeAndroid(): string {
  return (
    header() +
    `
      - name: Generate Gradle wrapper if missing
        run: |
          if [ ! -f "./gradlew" ]; then
            echo "gradlew not found in upload — generating with the runner's system Gradle."
            gradle wrapper --gradle-version 8.7
          fi

      - name: Grant execute permission for gradlew
        run: chmod +x ./gradlew

      - name: Build debug APK
        run: ./gradlew assembleDebug --stacktrace
` +
    uploadStep() +
    notifyFailureStep()
  );
}

function reactNativeAndroid(): string {
  return (
    header() +
    `
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Grant execute permission for gradlew
        run: chmod +x ./android/gradlew

      - name: Build debug APK
        working-directory: ./android
        run: ./gradlew assembleDebug --stacktrace
` +
    uploadStep() +
    notifyFailureStep()
  );
}

function expoManagedAndroid(): string {
  return (
    header() +
    `
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm install

      - name: Align Expo package versions with SDK
        # Catches mismatched expo-* module versions (compiles fine,
        # throws NoSuchMethodError/NoClassDefFoundError against
        # expo-modules-core at runtime instead) before they reach a build.
        run: npx expo install --fix

      - name: Prebuild native Android project
        # Generates android/ from app.json + config plugins. Runs
        # entirely locally on the runner - no Expo account, token, or
        # cloud service involved.
        run: npx expo prebuild --platform android --clean --no-install

      - name: Grant execute permission for gradlew
        run: chmod +x android/gradlew

      - name: Build debug APK
        working-directory: android
        run: ./gradlew assembleDebug --stacktrace
` +
    uploadStep() +
    notifyFailureStep()
  );
}

function flutterAndroid(): string {
  return (
    header() +
    `
      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          channel: 'stable'

      - name: Install dependencies
        run: flutter pub get

      - name: Build debug APK
        run: flutter build apk --debug
` +
    uploadStep() +
    notifyFailureStep()
  );
}

export function generateWorkflow(type: ProjectType): string {
  switch (type) {
    case 'expo-managed':
      return expoManagedAndroid();
    case 'react-native':
      return reactNativeAndroid();
    case 'flutter':
      return flutterAndroid();
    case 'android-native-kotlin':
    case 'android-native-java':
    default:
      return nativeAndroid();
  }
}
