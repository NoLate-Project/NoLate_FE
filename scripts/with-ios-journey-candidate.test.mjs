import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { iosJourneyCandidateEnvironment, parseCandidateEnvFile } from "./with-ios-journey-candidate.mjs";

test("ordinary Xcode iOS Release archives enable the same journey gates", () => {
  const names = [
    "EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED",
    "EXPO_PUBLIC_JOURNEY_PRODUCT_ENABLED",
    "EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED",
    "NOLATE_JOURNEY_PRODUCT_BUILD",
    "EXPO_PUBLIC_AUTOMATIC_JOURNEY_DEVICE_FIELD_TEST_ENABLED",
  ];
  const readXcodeEnvironment = (configuration) => {
    const result = spawnSync("bash", ["-c", "source ios/.xcode.env; env"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, CONFIGURATION: configuration,
        EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED: "false",
        EXPO_PUBLIC_JOURNEY_PRODUCT_ENABLED: "false",
        EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED: "false",
        NOLATE_JOURNEY_PRODUCT_BUILD: "0",
        EXPO_PUBLIC_AUTOMATIC_JOURNEY_DEVICE_FIELD_TEST_ENABLED: "true" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return Object.fromEntries(result.stdout.split("\n").filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  };
  const release = readXcodeEnvironment("Release");
  assert.deepEqual(names.map((name) => release[name]), ["true", "true", "true", "1", "false"]);
  const debug = readXcodeEnvironment("Debug");
  assert.deepEqual(names.map((name) => debug[name]), ["false", "false", "false", "0", "true"]);
});

test("iOS TestFlight candidate enables the complete product gate", () => {
  const env = iosJourneyCandidateEnvironment({ EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED: "false" });
  for (const name of [
    "EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED",
    "EXPO_PUBLIC_JOURNEY_PRODUCT_ENABLED",
    "EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED",
  ]) assert.equal(env[name], "true");
  assert.equal(env.NOLATE_JOURNEY_PRODUCT_BUILD, "1");
  assert.equal(env.ENTRY_FILE, "index.js");
  for (const name of [
    "EXPO_PUBLIC_AUTOMATIC_JOURNEY_DEVICE_FIELD_TEST_ENABLED",
    "NOLATE_JOURNEY_DIAGNOSTICS_BUILD",
    "NOLATE_JOURNEY_AUTHENTICATED_BUILD",
    "NOLATE_JOURNEY_APNS_PILOT_BUILD",
    "NOLATE_JOURNEY_DEVICE_FIELD_TEST_BUILD",
  ]) assert.equal(env[name], name.startsWith("EXPO_") ? "false" : "0");
});

test("candidate env file parsing never executes values and product gates override it", () => {
  const parsed = parseCandidateEnvFile('EXPO_PUBLIC_API_BASE_URL="https://example.invalid"\n' +
    'EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED=false\n# ignored=1\n');
  assert.equal(parsed.EXPO_PUBLIC_API_BASE_URL, "https://example.invalid");
  assert.equal(iosJourneyCandidateEnvironment(parsed).EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED, "true");
  assert.equal(parsed.ignored, undefined);
});
