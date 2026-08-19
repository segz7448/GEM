const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * By default the RN Gradle plugin's `react { debuggableVariants = ["debug"] }`
 * means the "debug" build variant NEVER gets a JS bundle embedded - it's
 * built expecting a live Metro server on the same machine. That's fine for
 * `expo run:android` over USB, but GEM's CI-built debug APK gets installed
 * directly on a phone with no Metro running anywhere, so it fails at
 * startup with "Unable to load script" / "Could not connect to development
 * server" - there's nowhere for it to fetch JS from.
 *
 * Setting debuggableVariants to an empty list removes "debug" from that
 * skip-list, so the debug variant bundles its own JS/assets exactly like
 * release does (see TaskConfiguration.kt: `if (!isDebuggableVariant) { ...
 * register bundle task ... }`). The APK is still a debug build (debuggable
 * flag, dev menu, etc.) - it's just self-contained now.
 *
 * Trade-off worth knowing: this does mean `npx expo start` + a debug build
 * installed this way won't live-reload from Metro anymore, since it's not
 * looking for a dev server. For iterative development, use
 * `npx expo run:android` (which reinstalls per-change anyway) or a dev
 * client; this change is specifically about the APK GEM's CI hands you to
 * install standalone.
 */
function withStandaloneDebugBundle(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    if (contents.includes('debuggableVariants = []')) {
      return config; // already patched
    }

    if (!/react\s*\{/.test(contents)) {
      return config; // template shape changed - don't guess
    }

    config.modResults.contents = contents.replace(
      /react\s*\{/,
      `react {\n    debuggableVariants = []`,
    );

    return config;
  });
}

module.exports = withStandaloneDebugBundle;
