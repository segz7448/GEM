const { withGradleProperties } = require('@expo/config-plugins');

/**
 * GitHub Actions' ubuntu-latest runners were OOM-killing the Gradle
 * daemon's JetifyTransform step while it processed the (large, native-lib
 * heavy) hermes-android debug AAR - Expo's default gradle.properties only
 * grants the daemon `-Xmx2048m`, which isn't enough headroom once Jetifier
 * is added on top of everything else already resident in that JVM.
 *
 * Two changes, both belt-and-suspenders:
 *  1. Raise org.gradle.jvmargs to give the daemon more heap.
 *  2. Disable Jetifier outright. RN 0.74 / Expo SDK 51 and every
 *     dependency in this project are already fully AndroidX-native, so
 *     Jetifier has nothing to actually rewrite - it was pure overhead
 *     (and the single biggest memory consumer) with zero functional need.
 *
 * Implemented as a mod (not a hand-edited android/gradle.properties) because
 * `expo prebuild --clean` regenerates android/ from scratch on every CI run,
 * so anything not applied through a config plugin gets silently wiped.
 */
function withGradleMemoryFix(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    const setProp = (key, value) => {
      const existing = props.find((item) => item.type === 'property' && item.key === key);
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    };

    setProp(
      'org.gradle.jvmargs',
      '-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError',
    );
    setProp('android.enableJetifier', 'false');

    return config;
  });
}

module.exports = withGradleMemoryFix;
