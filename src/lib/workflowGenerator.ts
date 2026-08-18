import type { ProjectType } from './projectScanner';

export const WORKFLOW_PATH = '.github/workflows/gem-android.yml';
export const WORKFLOW_FILENAME = 'gem-android.yml';

function header(): string {
  return `name: gem-android-build

on:
  workflow_dispatch:
    inputs:
      build_id:
        required: true
        type: string

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

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
`;
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
    uploadStep()
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
    uploadStep()
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
    uploadStep()
  );
}

export function generateWorkflow(type: ProjectType): string {
  switch (type) {
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
