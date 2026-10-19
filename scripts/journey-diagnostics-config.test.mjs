import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { configureJourneyDiagnostics, configureJourneyPushPilot, configureDeviceFieldTest } = require("../plugins/withNoLateJourneyDiagnostics").__internal;
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const expoCLI = join(dirname(require.resolve("expo/package.json")), "bin/cli");
const diagnosticDescription = "길안내 개발 검증 중 전경과 잠금 상태의 위치 수신을 확인합니다. 위치 좌표는 서버에 전송하지 않습니다.";
const normalDescription = "NoLate에서 현재 위치를 출발지로 설정하기 위해 위치 권한이 필요합니다.";

function introspectIOSInfoPlist(enabled) {
  // In-memory only: never write or print full Expo config, and never load .env.
  let output;
  try {
    output = execFileSync(process.execPath, [expoCLI, "config", "--type", "introspect", "--json"], {
      cwd: projectRoot,
      env: { ...process.env, EXPO_NO_DOTENV: "1", NOLATE_JOURNEY_DIAGNOSTICS_BUILD: enabled ? "1" : "0" },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    throw new Error("Expo Info.plist introspection failed; full config and process output were withheld.");
  }
  let parsed;
  try { parsed = JSON.parse(output); } catch {
    throw new Error("Expo introspection did not return valid JSON; config output was withheld.");
  }
  const info = parsed._internal?.modResults?.ios?.infoPlist;
  assert.ok(info, "Expo must expose the resolved iOS Info.plist for this regression test");
  return info;
}

test("default build keeps production capabilities unchanged", () => {
  const original = { UIBackgroundModes: ["remote-notification"], NSLocationWhenInUseUsageDescription: "original" };
  assert.equal(configureJourneyDiagnostics(original, false), original);
  assert.equal(original.NoLateJourneyDiagnosticsEnabled, undefined);
});
test("APNs trial needs diagnostic and authenticated opt-ins; turning off strips both flags", () => {
  const normal = { UIBackgroundModes: ["remote-notification"] };
  assert.deepEqual(configureJourneyPushPilot(normal, true, true), normal);
  const diagnostic = configureJourneyDiagnostics(normal, true);
  const authenticated = configureJourneyPushPilot(diagnostic, true, false);
  assert.equal(authenticated.NoLateJourneyAuthenticatedEnabled, true);
  assert.equal(authenticated.NoLateJourneyAPNsPilotEnabled, undefined);
  const pilot = configureJourneyPushPilot(diagnostic, true, true);
  assert.equal(pilot.NoLateJourneyAPNsPilotEnabled, true);
  assert.deepEqual(configureJourneyPushPilot(pilot, false, false), diagnostic);
  assert.deepEqual(configureJourneyPushPilot(diagnostic, false, true), diagnostic);
});
test("device field test requires all independent native build opt-ins", () => {
  const base = { UIBackgroundModes: ["remote-notification"] };
  assert.deepEqual(configureDeviceFieldTest(base, true), base);
  const diagnostic = configureJourneyDiagnostics(base, true);
  assert.deepEqual(configureDeviceFieldTest(diagnostic, true), diagnostic);
  const authenticated = configureJourneyPushPilot(diagnostic, true, false);
  const enabled = configureDeviceFieldTest(authenticated, true);
  assert.equal(enabled.NoLateJourneyDeviceFieldTestEnabled, true);
  assert.deepEqual(configureDeviceFieldTest(enabled, false), authenticated);
});
test("explicit diagnostic build adds capabilities without losing existing modes", () => {
  const original = { UIBackgroundModes: ["remote-notification"] };
  const configured = configureJourneyDiagnostics(original, true);
  assert.deepEqual(configured.UIBackgroundModes, ["remote-notification", "location", "audio"]);
  assert.equal(configured.NoLateJourneyDiagnosticsEnabled, true);
  assert.deepEqual(original.UIBackgroundModes, ["remote-notification"]);
});
test("diagnostic configuration is idempotent", () => {
  const configured = configureJourneyDiagnostics({ UIBackgroundModes: ["location"] }, true);
  assert.deepEqual(configureJourneyDiagnostics(configured, true), configured);
});
test("returning to a normal build removes only diagnostic capabilities", () => {
  const original = { UIBackgroundModes: ["remote-notification", "audio"], NSLocationWhenInUseUsageDescription: "original" };
  const diagnostic = configureJourneyDiagnostics(original, true);
  const restored = configureJourneyDiagnostics(diagnostic, false);
  assert.deepEqual(restored.UIBackgroundModes, original.UIBackgroundModes);
  assert.equal(restored.NoLateJourneyDiagnosticsEnabled, undefined);
  assert.equal(restored.NoLateJourneyDiagnosticsOriginalBackgroundModes, undefined);
  assert.deepEqual(restored, original);
});

test("real Expo plugin chain preserves the normal permission and background modes", () => {
  const info = introspectIOSInfoPlist(false);
  assert.equal(info.NoLateJourneyDiagnosticsEnabled, undefined);
  assert.deepEqual(info.UIBackgroundModes, ["remote-notification"]);
  assert.equal(info.NSLocationWhenInUseUsageDescription, normalDescription);
});

test("real Expo plugin chain applies diagnostic permission after expo-location", () => {
  const info = introspectIOSInfoPlist(true);
  assert.equal(info.NoLateJourneyDiagnosticsEnabled, true);
  assert.deepEqual(info.UIBackgroundModes, ["remote-notification", "location", "audio"]);
  assert.equal(info.NSLocationWhenInUseUsageDescription, diagnosticDescription);
  assert.equal(info.NoLateJourneyDiagnosticsOriginalLocationDescription, normalDescription);
  assert.deepEqual(info.NoLateJourneyDiagnosticsOriginalBackgroundModes, ["remote-notification"]);
});

test("resolved diagnostic plist restores the actual normal permission and capabilities", () => {
  const restored = configureJourneyDiagnostics(introspectIOSInfoPlist(true), false);
  assert.equal(restored.NoLateJourneyDiagnosticsEnabled, undefined);
  assert.equal(restored.NoLateJourneyDiagnosticsOriginalLocationDescription, undefined);
  assert.equal(restored.NoLateJourneyDiagnosticsOriginalBackgroundModes, undefined);
  assert.equal(restored.NSLocationWhenInUseUsageDescription, normalDescription);
  assert.deepEqual(restored.UIBackgroundModes, ["remote-notification"]);
});
