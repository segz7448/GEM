const { withAppBuildGradle } = require('@expo/config-plugins');

// Read at prebuild time, sourced from the env vars
// .github/workflows/build-gem.yml sets on the "Build release APK" step.
// Wrapped in a Groovy-side conditional (System.getenv(...)) rather than
// baked in as a literal, so the same generated build.gradle also works
// for a local `expo prebuild` with no secrets present - it just falls
// back to Expo's default debug-signed release in that case.
const SIGNING_BLOCK = `
        release {
            if (System.getenv("RELEASE_STORE_PASSWORD")) {
                storeFile file(System.getenv("RELEASE_STORE_FILE") ?: "release.keystore")
                storePassword System.getenv("RELEASE_STORE_PASSWORD")
                keyAlias System.getenv("RELEASE_KEY_ALIAS")
                keyPassword System.getenv("RELEASE_KEY_PASSWORD")
            }
        }
`;

/**
 * Without this, Expo's default generated project signs "release" builds
 * with the debug keystore - the build succeeds and produces an
 * installable APK either way, so the gap is silent: RELEASE_* secrets
 * being configured wouldn't actually change what signs the output.
 * This plugin adds a real signingConfigs.release block and points
 * buildTypes.release at it whenever the env var is present.
 *
 * Implementation note: this patches the generated build.gradle with
 * targeted regex replacements rather than a full Groovy AST transform.
 * That's fragile in the general case, but build.gradle here is
 * Expo's own template output (not user-authored), so its shape is
 * predictable enough for this to be reliable in practice. If a future
 * Expo SDK upgrade changes that template's structure, this is the
 * first thing to check if a release build stops picking up signing.
 */
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    if (!contents.includes('signingConfigs {') || contents.includes('RELEASE_STORE_PASSWORD')) {
      return config; // already patched, or template shape changed - don't guess
    }

    let updated = contents.replace(/signingConfigs\s*\{/, `signingConfigs {\n${SIGNING_BLOCK}`);

    updated = updated.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[^}]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig System.getenv("RELEASE_STORE_PASSWORD") ? signingConfigs.release : signingConfigs.debug`,
    );

    config.modResults.contents = updated;
    return config;
  });
}

module.exports = withReleaseSigning;
