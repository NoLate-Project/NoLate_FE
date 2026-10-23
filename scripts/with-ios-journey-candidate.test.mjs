import assert from "node:assert/strict";
import test from "node:test";
import { iosJourneyCandidateEnvironment, parseCandidateEnvFile } from "./with-ios-journey-candidate.mjs";

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
