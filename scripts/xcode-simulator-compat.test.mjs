import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const cli = new URL('../node_modules/expo/node_modules/@expo/cli/build/src/start/', import.meta.url);

function load(relativePath, mocks, env = {}) {
  const exports = {};
  vm.runInNewContext(readFileSync(new URL(relativePath, cli), 'utf8'), {
    exports,
    process: { env },
    require(name) {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`);
      return mocks[name];
    },
  });
  return exports;
}

function resolveApp({ developerDir = '/Applications/Xcode.app/Contents/Developer', env = {}, files = {} } = {}) {
  const calls = [];
  const api = load('doctor/apple/simulatorApplication.js', {
    'node:fs': { existsSync: file => file in files },
    'node:path': path,
    '@expo/spawn-async': async (command, args) => {
      calls.push([command, args]);
      if (command === 'xcode-select') return { stdout: developerDir + '\n' };
      assert.equal(command, '/usr/bin/plutil');
      return { stdout: files[args.at(-1)] + '\n' };
    },
  }, env);
  return { result: api.getSimulatorApplicationAsync(), calls };
}

test('Xcode 27 locates Device Hub alongside Developer', async () => {
  const { result } = resolveApp({ files: {
    '/Applications/Xcode.app/Contents/Applications/DeviceHub.app/Contents/Info.plist': 'com.apple.dt.Devices',
  } });
  assert.equal((await result).processName, 'DeviceHub');
  assert.equal((await result).bundleId, 'com.apple.dt.Devices');
});

test('older Xcode continues to use Simulator', async () => {
  const { result } = resolveApp({ files: {
    '/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app/Contents/Info.plist': 'com.apple.iphonesimulator',
  } });
  assert.equal((await result).processName, 'Simulator');
});

for (const selected of ['/Volumes/Tools/Xcode Beta.app', '/Volumes/Tools/Xcode Beta.app/Contents/Developer']) {
  test(`DEVELOPER_DIR overrides xcode-select: ${selected}`, async () => {
    const { result, calls } = resolveApp({ env: { DEVELOPER_DIR: selected }, files: {
      '/Volumes/Tools/Xcode Beta.app/Contents/Applications/DeviceHub.app/Contents/Info.plist': 'com.apple.dt.Devices',
    } });
    assert.equal((await result).bundleId, 'com.apple.dt.Devices');
    assert.equal(calls.some(([command]) => command === 'xcode-select'), false);
  });
}

test('missing GUI returns null for the existing prerequisite fallback', async () => {
  assert.equal(await resolveApp().result, null);
});

for (const processName of ['Simulator', 'DeviceHub']) {
  test(`launcher opens the selected ${processName} path and checks its process`, async () => {
    const calls = [];
    let checks = 0;
    const appPath = `/Applications/Xcode Beta.app/Contents/Applications/${processName}.app`;
    const api = load('platforms/ios/ensureSimulatorAppRunning.js', {
      '@expo/osascript': { execAsync: async script => {
        assert.ok(script.includes(`name is "${processName}"`));
        return checks++ === 0 ? '0' : '1';
      } },
      '@expo/spawn-async': async (command, args) => { calls.push([command, Array.from(args)]); },
      '../../../log': { log() {} },
      '../../../utils/delay': { waitForActionAsync: ({ action }) => action() },
      '../../../utils/errors': { CommandError: Error },
      '../../doctor/apple/simulatorApplication': { getSimulatorApplicationAsync: async () => ({ appPath, processName }) },
    });
    await api.ensureSimulatorAppRunningAsync({ udid: 'test-device' });
    assert.deepEqual(calls, [['open', ['-a', appPath, '--args', '-CurrentDeviceUDID', 'test-device']]]);
  });
}

test('a simulator also listed by devicectl is booted via simctl; physical devices stay physical', async () => {
  const simulator = { udid: 'sim-1', name: 'iPhone Simulator', isAvailable: true, osType: 'iOS' };
  const physical = { udid: 'phone-1', name: 'Real iPhone', deviceType: 'device', osType: 'iOS' };
  const booted = [];
  const api = load('../run/ios/options/resolveDevice.js', {
    './promptDevice': {},
    '../../../log': {},
    '../../../start/platforms/ios/AppleDeviceManager': {
      AppleDeviceManager: { assertSystemRequirementsAsync: async () => {} },
      ensureSimulatorOpenAsync: async ({ udid }) => { booted.push(udid); return simulator; },
    },
    '../../../start/platforms/ios/promptAppleDevice': { sortDefaultDeviceToBeginningAsync: async devices => devices },
    '../../../start/platforms/ios/simctl': { getDevicesAsync: async () => [simulator] },
    '../../../utils/array': { uniqBy: (items, key) => [...new Map(items.slice().reverse().map(item => [key(item), item])).values()] },
    '../../../utils/errors': { CommandError: Error },
    '../../../utils/profile': { profile: fn => fn },
    '../../hints': { logDeviceArgument() {} },
    '../appleDevice/AppleDevice': { getConnectedDevicesAsync: async () => [{ ...simulator, deviceType: 'device' }, physical] },
  });
  assert.equal(await api.resolveDeviceAsync('sim-1', { osType: 'iOS' }), simulator);
  assert.equal(await api.resolveDeviceAsync('phone-1', { osType: 'iOS' }), physical);
  assert.deepEqual(booted, ['sim-1']);
});
