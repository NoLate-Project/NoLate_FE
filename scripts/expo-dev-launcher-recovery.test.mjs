import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('nullable Expo reload error callback falls back on the main queue without replacing supplied callbacks',
  { skip: process.platform !== 'darwin' }, () => {
    const source = readFileSync(join(root, 'node_modules/expo-dev-launcher/ios/EXDevLauncherController.m'), 'utf8');
    // Execute the installed dependency's actual normalization block, not a
    // JavaScript reimplementation. UIKit/network/app lifecycle remain E2E work.
    const match = source.match(/withTimeout:\(NSTimeInterval\)requestTimeout\s+onSuccess:[\s\S]*?\n\{\n([\s\S]*?)  EXDevLauncherUrl \*devLauncherUrl/);
    assert.ok(match && match[1].includes('if (onError == nil)'), 'The native recovery patch must be installed');
    const folder = mkdtempSync(join(tmpdir(), 'nolate-dev-launcher-recovery-'));
    try {
      const fixture = join(folder, 'recovery.m');
      const binary = join(folder, 'recovery');
      writeFileSync(fixture, `#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>
@interface LauncherProbe : NSObject
@property(nonatomic) NSInteger homeCount;
@property(nonatomic) BOOL onMain;
- (void)navigateToLauncher;
- (void (^)(NSError *))handler:(void (^)(NSError *))onError;
@end
@implementation LauncherProbe
- (void)navigateToLauncher { self.homeCount++; self.onMain = [NSThread isMainThread]; }
- (void (^)(NSError *))handler:(void (^)(NSError *))onError {
${match[1]}
  return onError;
}
@end
int main(void) { @autoreleasepool {
  LauncherProbe *probe = [LauncherProbe new];
  void (^fallback)(NSError *) = [probe handler:nil];
  if (!fallback) return 10;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
    fallback([NSError errorWithDomain:@"SyntheticOfflineManifest" code:1 userInfo:nil]);
  });
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2];
  while (probe.homeCount == 0 && [deadline timeIntervalSinceNow] > 0) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  }
  if (probe.homeCount != 1 || !probe.onMain) return 11;
  __block NSInteger suppliedCalls = 0;
  NSError *expected = [NSError errorWithDomain:@"SyntheticOfflineManifest" code:2 userInfo:nil];
  void (^supplied)(NSError *) = ^(NSError *error) { if (error == expected) suppliedCalls++; };
  [probe handler:supplied](expected);
  if (suppliedCalls != 1 || probe.homeCount != 1) return 12;
  return 0;
}}
`);
      execFileSync('xcrun', ['clang', '-fobjc-arc', '-fblocks', '-framework', 'Foundation', fixture, '-o', binary],
        { stdio: 'pipe', timeout: 30_000 });
      execFileSync(binary, [], { stdio: 'pipe', timeout: 5_000 });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

test('persistent launcher patch contains only its two reviewed iOS sources', () => {
  const patch = readFileSync(join(root, 'patches/expo-dev-launcher+6.0.21.patch'), 'utf8');
  const files = [...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map(match => match[2]);
  assert.deepEqual(files.sort(), [
    'node_modules/expo-dev-launcher/ios/EXDevLauncherController.m',
    'node_modules/expo-dev-launcher/ios/ReactDelegateHandler/ExpoDevLauncherAppDelegateSubscriber.swift',
  ]);
  assert.ok(patch.includes('if (onError == nil)'));
  assert.ok(patch.includes('UIScene.didActivateNotification'));
  assert.ok(patch.includes('[self onDeepLink:launchOptions[UIApplicationLaunchOptionsURLKey] options:@{}]'));
});
