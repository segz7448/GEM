const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const glyphs = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = [...walk('app'), ...walk('src/components')].filter((file) => /\.(tsx|ts)$/.test(file));
const missing = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<Icon\s+name="([^"]+)"/g)) {
    if (!glyphs[match[1]]) missing.push(`${file}: ${match[1]}`);
  }
}
for (const name of ['creation', 'atom-variant', 'vector-polyline', 'cloud-outline', 'view-dashboard', 'view-dashboard-outline', 'cog', 'cog-outline', 'history']) {
  if (!glyphs[name]) missing.push(`dynamic icon map: ${name}`);
}
assert.deepEqual(missing, [], `Unknown vector icons: ${missing.join(', ')}`);
const config = JSON.parse(fs.readFileSync('app.json', 'utf8'));
assert.equal(config.expo.icon, './assets/gem-launcher-icon.png');
assert.equal(config.expo.android.adaptiveIcon.foregroundImage, './assets/gem-launcher-icon.png');
assert.ok(fs.statSync(config.expo.icon.replace('./', '')).size > 1000, 'Launcher icon asset should be a real rendered image');
console.log(`Vector icon names: ${files.length} UI modules checked. Launcher and adaptive icon assets configured.`);
