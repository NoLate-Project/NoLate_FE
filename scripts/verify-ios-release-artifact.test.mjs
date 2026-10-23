import assert from 'node:assert/strict';
import test from 'node:test';
import { extensionBundles, verifyIosReleaseMetadata } from './verify-ios-release-artifact.mjs';

function fixture() {
  const base = { CFBundleShortVersionString: '1.2.0', CFBundleVersion: '55', UIDeviceFamily: [1] };
  return {
    main: { ...base, CFBundleIdentifier: 'com.anonymous.nolatefe',
      UIApplicationSceneManifest: {
        UIApplicationSupportsMultipleScenes: false,
        UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          UISceneClassName: 'UIWindowScene',
          UISceneDelegateClassName: 'NoLateFE.SceneDelegate',
        }] },
      },
    },
    extensions: extensionBundles.map(CFBundleIdentifier => ({ ...base, CFBundleIdentifier })),
  };
}
const verify = ({ main, extensions }) => verifyIosReleaseMetadata(main, extensions,
  { version: '1.2.0', build: '55' });

test('accepts the scene-enabled iPhone-only release and all three extensions', () => {
  assert.doesNotThrow(() => verify(fixture()));
});
test('journey candidate requires native product, authenticated guidance and location modes', () => {
  const f = fixture();
  f.main.NoLateJourneyProductEnabled = true;
  f.main.NoLateJourneyAuthenticatedEnabled = true;
  f.main.UIBackgroundModes = ['remote-notification', 'location'];
  assert.doesNotThrow(() => verifyIosReleaseMetadata(f.main, f.extensions,
    { version: '1.2.0', build: '55' }, true));
  delete f.main.NoLateJourneyProductEnabled;
  assert.throws(() => verifyIosReleaseMetadata(f.main, f.extensions,
    { version: '1.2.0', build: '55' }, true), /native journey product/);
});
test('rejects the reviewed build 54 crash pattern: absent scene manifest', () => {
  const f = fixture(); delete f.main.UIApplicationSceneManifest;
  f.main.CFBundleVersion = '54';
  assert.throws(() => verify(f), /Missing UIApplicationSceneManifest/);
});
for (const [name, change] of [
  ['old build even when scene config exists', f => { f.main.CFBundleVersion = '54'; }],
  ['extension version drift', f => { f.extensions[0].CFBundleVersion = '54'; }],
  ['missing extension', f => { f.extensions.pop(); }],
  ['unexpected extension', f => { f.extensions[0].CFBundleIdentifier = 'other'; }],
  ['unintended iPad distribution', f => { f.main.UIDeviceFamily = [1, 2]; }],
  ['unexpanded delegate', f => { f.main.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName = '$(PRODUCT_MODULE_NAME).SceneDelegate'; }],
  ['non-window scene', f => { f.main.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneClassName = 'UIScene'; }],
  ['missing application scene', f => { f.main.UIApplicationSceneManifest.UISceneConfigurations = {}; }],
]) {
  test(`rejects ${name}`, () => { const f = fixture(); change(f); assert.throws(() => verify(f)); });
}
