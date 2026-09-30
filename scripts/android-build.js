#!/usr/bin/env node
/**
 * Builds Android artifacts and copies them to build-output/ with readable names.
 *
 *   node scripts/android-build.js apk        release APK (install directly on phones)
 *   node scripts/android-build.js aab        release App Bundle (upload to Google Play)
 *   node scripts/android-build.js debug-apk  debug APK (needs Metro running)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TARGETS = {
  apk: { task: 'assembleRelease', dir: 'apk/release', ext: 'apk' },
  aab: { task: 'bundleRelease', dir: 'bundle/release', ext: 'aab' },
  'debug-apk': { task: 'assembleDebug', dir: 'apk/debug', ext: 'apk' },
};

const kind = process.argv[2];
const target = TARGETS[kind];
if (!target) {
  console.error(
    `Usage: node scripts/android-build.js <${Object.keys(TARGETS).join('|')}>`,
  );
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const androidDir = path.join(root, 'android');
const isWindows = process.platform === 'win32';
// Absolute path: cmd.exe may be configured not to search the working directory.
const gradlew = path.join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew');

console.log(`> ${gradlew} ${target.task}`);
const result = spawnSync(
  isWindows ? `"${gradlew}"` : gradlew,
  [target.task, '--console=plain'],
  {
    cwd: androidDir,
    stdio: 'inherit',
    shell: isWindows, // .bat files need a shell on Windows
  },
);
if (result.status !== 0) {
  console.error(`\nGradle ${target.task} failed.`);
  process.exit(result.status ?? 1);
}

const outDir = path.join(androidDir, 'app', 'build', 'outputs', target.dir);
const built = fs.readdirSync(outDir).find(f => f.endsWith(`.${target.ext}`));
if (!built) {
  console.error(`No .${target.ext} found in ${outDir}`);
  process.exit(1);
}

const { version } = require(path.join(root, 'package.json'));
const destDir = path.join(root, 'build-output');
fs.mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, `FileHop-${version}-${kind}.${target.ext}`);
fs.copyFileSync(path.join(outDir, built), dest);

const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
console.log(`\nBuilt ${path.relative(root, dest)} (${mb} MB)`);
