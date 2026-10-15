import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const extensionBundles = [
  'com.anonymous.nolatefe.quick-schedule',
  'com.anonymous.nolatefe.live-activity',
  'com.anonymous.nolatefe.widget',
];

// This checks the compiled artifact, not the source Info.plist: an older archive
// can otherwise pass source checks while still crashing during UIKit launch.
export function verifyIosReleaseMetadata(main, extensions, expected) {
  assert.equal(main.CFBundleIdentifier, 'com.anonymous.nolatefe');
  const manifest = main.UIApplicationSceneManifest;
  assert.ok(manifest, 'Missing UIApplicationSceneManifest: iOS 27 launch crash');
  assert.equal(manifest.UIApplicationSupportsMultipleScenes, false);
  const scenes = manifest.UISceneConfigurations?.UIWindowSceneSessionRoleApplication;
  assert.equal(scenes?.length, 1, 'A single application window scene is required');
  assert.equal(scenes[0].UISceneClassName, 'UIWindowScene');
  assert.equal(scenes[0].UISceneDelegateClassName, 'NoLateFE.SceneDelegate',
    'Scene delegate must be expanded to its runtime class in the built plist');
  assert.deepEqual(main.UIDeviceFamily, [1], 'Keep iPhone-only distribution');
  assert.equal(extensions.length, extensionBundles.length);
  assert.deepEqual(extensions.map(info => info.CFBundleIdentifier).sort(),
    [...extensionBundles].sort(), 'All three expected extensions must be embedded');
  for (const info of [main, ...extensions]) {
    assert.equal(info.CFBundleShortVersionString, expected.version,
      `${info.CFBundleIdentifier}: wrong marketing version`);
    assert.equal(info.CFBundleVersion, expected.build,
      `${info.CFBundleIdentifier}: stale/mismatched build number`);
    assert.deepEqual(info.UIDeviceFamily, [1],
      `${info.CFBundleIdentifier}: keep iPhone-only distribution`);
  }
}

function verifyArtifact(input) {
  assert.ok(input, 'Usage: npm run verify:ios-artifact -- /path/to/app.app-or.xcarchive');
  const artifact = resolve(input);
  const appPath = artifact.endsWith('.xcarchive')
    ? join(artifact, 'Products/Applications/NoLateFE.app') : artifact;
  assert.ok(appPath.endsWith('.app'), 'Expected an .app or .xcarchive path');
  const readPlist = path => JSON.parse(execFileSync('/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', path], { encoding: 'utf8' }));
  const main = readPlist(join(appPath, 'Info.plist'));
  const plugins = join(appPath, 'PlugIns');
  const extensions = readdirSync(plugins).filter(name => name.endsWith('.appex'))
    .map(name => readPlist(join(plugins, name, 'Info.plist')));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  verifyIosReleaseMetadata(main, extensions, {
    version: config.version, build: config.ios.buildNumber,
  });
  assert.ok(existsSync(join(appPath, 'main.jsbundle')), 'Release JS bundle is missing');
  assert.ok(existsSync(join(appPath, main.CFBundleExecutable)), 'Native executable is missing');
  console.log(`Verified ${main.CFBundleShortVersionString} (${main.CFBundleVersion}): scene manifest, iPhone-only family, three extensions and bundled JS.`);
  console.log(appPath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyArtifact(process.argv[2]);
}
