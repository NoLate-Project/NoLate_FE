import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function iosJourneyCandidateEnvironment(base = process.env) {
  return {
    ...base,
    EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED: "true",
    EXPO_PUBLIC_JOURNEY_PRODUCT_ENABLED: "true",
    EXPO_PUBLIC_AUTOMATIC_JOURNEY_AUTHENTICATED_ENABLED: "true",
    NOLATE_JOURNEY_PRODUCT_BUILD: "1",
    // A TestFlight product candidate must not inherit development-only switches.
    EXPO_PUBLIC_AUTOMATIC_JOURNEY_DEVICE_FIELD_TEST_ENABLED: "false",
    NOLATE_JOURNEY_DIAGNOSTICS_BUILD: "0",
    NOLATE_JOURNEY_AUTHENTICATED_BUILD: "0",
    NOLATE_JOURNEY_APNS_PILOT_BUILD: "0",
    NOLATE_JOURNEY_DEVICE_FIELD_TEST_BUILD: "0",
  };
}

export function parseCandidateEnvFile(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--env-file");
  const file = fileIndex < 0 ? null : args[fileIndex + 1];
  if (fileIndex >= 0 && (!file || file === "--")) {
    throw new Error("--env-file requires a path");
  }
  if (fileIndex >= 0) args.splice(fileIndex, 2);
  const local = file ? parseCandidateEnvFile(readFileSync(resolve(file), "utf8")) : {};
  const env = iosJourneyCandidateEnvironment({ ...local, ...process.env });
  const verified = spawnSync(process.execPath,
    ["scripts/verify-release-config.mjs", "--platform", "ios", "--journey-candidate"],
    { cwd: root, env, stdio: "inherit" });
  if (verified.error) throw verified.error;
  if (verified.status !== 0) process.exit(verified.status ?? 1);

  const command = args.filter((arg, index) => !(index === 0 && arg === "--"));
  if (command.length === 0) {
    console.log("iOS journey TestFlight candidate flags verified; no build command was supplied.");
  } else {
    if (command[0] === "xcodebuild") {
      for (const name of ["EXPO_PUBLIC_API_BASE_URL", "EXPO_PUBLIC_ODSAY_IOS_API_KEY",
        "EXPO_PUBLIC_TMAP_APP_KEY"]) {
        if (!env[name] || env[name].startsWith("YOUR_")) {
          throw new Error(`${name} is required for a usable TestFlight archive`);
        }
      }
      if (!env.EXPO_PUBLIC_API_BASE_URL.startsWith("https://")) {
        throw new Error("TestFlight archive requires an HTTPS API origin");
      }
    }
    const result = spawnSync(command[0], command.slice(1), { cwd: root, env, stdio: "inherit" });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
}
