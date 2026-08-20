const fs = require('fs');
const path = require('path');

/**
 * Expo's own base Android mods hard-fail `expo prebuild` if
 * android.googleServicesFile points at a path that doesn't exist - which
 * would break CI on every run until the real Firebase file is committed.
 *
 * This only sets that config key (which triggers Expo's built-in copy into
 * android/app/google-services.json) when the file is actually present at
 * the project root:
 *  - Before the real file is added: prebuild still succeeds. The device
 *    just won't get a real FCM token until it's added (push.ts's
 *    getDevicePushTokenAsync() will fail gracefully and return null).
 *  - After it's added: behaves exactly like a normal googleServicesFile
 *    config would.
 */
function withGoogleServicesIfPresent(config) {
  const projectRoot = config._internal?.projectRoot ?? process.cwd();
  const filePath = path.join(projectRoot, 'google-services.json');

  if (fs.existsSync(filePath)) {
    config.android = config.android || {};
    config.android.googleServicesFile = './google-services.json';
  } else {
    console.warn(
      '[GEM] google-services.json not found at project root - skipping Firebase wiring for this build. ' +
        'Add the real file from the Firebase console to enable FCM push notifications on-device.',
    );
  }

  return config;
}

module.exports = withGoogleServicesIfPresent;
