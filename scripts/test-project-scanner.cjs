const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const yaml = require('js-yaml');

function loadTypeScript(relativePath) {
  const sourcePath = path.join(__dirname, '..', relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const compiled = new Module(sourcePath, module);
  compiled.filename = sourcePath;
  compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  compiled._compile(js, sourcePath);
  return compiled.exports;
}

const { scanProject } = loadTypeScript('src/lib/projectScanner.ts');
const { generateWorkflow } = loadTypeScript('src/lib/workflowGenerator.ts');

function file(path, text = '', isBinary = false) {
  return { path, text, isBinary, ...(isBinary ? { base64: '' } : {}) };
}
function scan(name, files, expectedType) {
  const result = scanProject(files);
  assert.equal(result.type, expectedType, `${name}: wrong project type`);
  assert.ok(result.summary.length > 0, `${name}: missing summary`);
  assert.ok(result.signals.length > 0, `${name}: no evidence signals`);
  return result;
}

const native = scan('native Kotlin', [
  file('settings.gradle', "include ':app'"),
  file('app/build.gradle', "plugins { id 'com.android.application' }\nandroid { defaultConfig { applicationId 'com.example.native' } }"),
  file('app/src/main/AndroidManifest.xml', '<manifest package="com.example.native"><application /></manifest>'),
  file('app/src/main/java/MainActivity.kt', 'class MainActivity'),
  file('gradlew', '#!/bin/sh'),
  file('gradle/wrapper/gradle-wrapper.jar', '', true),
], 'android-native-kotlin');
assert.equal(native.issues.some((x) => x.severity === 'error'), false);

scan('Java Android despite unrelated Kotlin file', [
  file('app/build.gradle', "plugins { id 'com.android.application' }"),
  file('app/src/main/AndroidManifest.xml', '<manifest><application /></manifest>'),
  file('tools/Other.kt', 'class BuildTool'),
], 'android-native-java');

scan('bare React Native', [
  file('package.json', JSON.stringify({ dependencies: { 'react-native': '0.74.5' } })),
  file('android/app/build.gradle', "plugins { id 'com.android.application' }"),
  file('android/app/src/main/AndroidManifest.xml', '<manifest><application /></manifest>'),
], 'react-native');

scan('Expo managed', [
  file('package.json', JSON.stringify({ dependencies: { expo: '~51.0.0', 'react-native': '0.74.5' } })),
  file('app.json', JSON.stringify({ expo: { name: 'Sample', android: { package: 'com.example.sample' } } })),
], 'expo-managed');

scan('Flutter', [
  file('pubspec.yaml', 'name: sample\ndependencies:\n  flutter:\n    sdk: flutter\n'),
  file('lib/main.dart', 'void main() {}'),
], 'flutter');

const capacitor = scan('Capacitor Android', [
  file('package.json', JSON.stringify({ dependencies: { '@capacitor/core': '^6', '@capacitor/android': '^6' } })),
  file('capacitor.config.ts', 'export default {}'),
], 'capacitor');
assert.equal(capacitor.issues.some((x) => x.severity === 'error'), false);

scan('Cordova', [
  file('package.json', JSON.stringify({ devDependencies: { cordova: '^12' } })),
  file('config.xml', '<widget id="com.example" />'),
  file('www/index.html', '<html></html>'),
], 'cordova');

const unknown = scanProject([file('README.md', 'not a mobile project')]);
assert.equal(unknown.type, 'unknown');
assert.ok(unknown.issues.some((x) => x.severity === 'error'));
const malformed = scanProject([
  file('package.json', '{ not json'),
  file('app.json', '{"expo":{}}'),
]);
assert.ok(malformed.issues.some((x) => x.file === 'package.json' && x.severity === 'error'));

for (const type of ['android-native-java', 'android-native-kotlin', 'react-native', 'expo-managed', 'flutter', 'capacitor', 'cordova']) {
  const workflow = generateWorkflow(type, 'debug');
  assert.match(workflow, /workflow_dispatch:/, `${type}: no manual trigger`);
  assert.match(workflow, /gem-build-\$\{\{ inputs\.build_id \}\}/, `${type}: artifact name not correlated to build`);
  assert.match(workflow, /assembleDebug|flutter build apk --debug/, `${type}: no APK build command`);
  assert.match(workflow, /actions\/upload-artifact@v4/, `${type}: APK artifact is not uploaded`);
  const parsed = yaml.load(workflow);
  assert.ok(parsed.jobs?.build?.steps?.length >= 4, `${type}: workflow YAML did not parse into build steps`);
}
for (const type of ['android-native-java', 'android-native-kotlin', 'react-native', 'expo-managed', 'capacitor', 'cordova']) {
  const releaseWorkflow = generateWorkflow(type, 'release');
  const parsed = yaml.load(releaseWorkflow);
  assert.ok(parsed.jobs?.build?.steps?.length >= 5, `${type}: release YAML did not parse`);
  for (const secret of ['RELEASE_KEYSTORE_BASE64', 'RELEASE_STORE_PASSWORD', 'RELEASE_KEY_ALIAS', 'RELEASE_KEY_PASSWORD']) {
    assert.ok(releaseWorkflow.includes(secret), `${type}: missing ${secret} release setting`);
  }
  assert.ok(!/if:\s*\$\{\{[^\n]*secrets\./.test(releaseWorkflow), `${type}: secrets context must not be used directly in an if expression`);
}
assert.match(generateWorkflow('capacitor'), /npx cap sync android/);
assert.match(generateWorkflow('cordova'), /npx cordova prepare android/);
console.log('Project scanner fixtures: 9 passed. Build workflow generation checks: 7 passed.');
