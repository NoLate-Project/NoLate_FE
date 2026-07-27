import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pbxTargetConfig from "./lib/pbx-target-config.cjs";

const { verifyIosTargetConfigurationPolicy } = pbxTargetConfig;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const app = JSON.parse(read("app.json"));
const pkg = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
const envExample = read(".env.example");
const publicEnvSource = read("src/api/env.ts");
const scheduleSharingPolicy = read(
  "src/modules/share/scheduleSharingPolicy.ts",
);
const rootLayout = read("app/_layout.tsx");
const loginScreen = read("app/auth/login.tsx");
const signupScreen = read("app/auth/signup.tsx");
const jestSetup = read("jest.setup.js");
const scheduleDetail = read("app/schedule/[id].tsx");
const androidGradle = read("android/app/build.gradle");
const nolateTmapAndroidGradle = read("modules/nolate-tmap/android/build.gradle");
const androidManifest = read("android/app/src/main/AndroidManifest.xml");
const iosProject = read("ios/NoLateFE.xcodeproj/project.pbxproj");
const iosInfo = read("ios/NoLateFE/Info.plist");
const privacyManifest = read("ios/NoLateFE/PrivacyInfo.xcprivacy");
const mainEntitlements = read("ios/NoLateFE/NoLateFE.entitlements");
const extensionEntitlements = read("ios/NoLateShareExtension/NoLateShareExtension.entitlements");
const mainShareAuth = read("ios/NoLateFE/NoLateShareAuthModule.m");
const shareExtension = read("ios/NoLateShareExtension/ShareViewController.swift");
const rootAndroidFirebaseConfig = read("google-services.json");
const nativeAndroidFirebaseConfig = read("android/app/google-services.json");
const rootIosFirebaseConfig = read("ios/GoogleService-Info.plist");
const nativeIosFirebaseConfig = read("ios/NoLateFE/GoogleService-Info.plist");
const dependencyPatches = readdirSync(resolve(root, "patches"))
  .filter((name) => name.endsWith(".patch"))
  .map((name) => ({ name, source: read(`patches/${name}`) }));

assert.equal(app.version, "1.2.0");
assert.equal(app.orientation, "portrait", "The phone UI is designed and verified for portrait only");
assert.equal(pkg.version, app.version);
assert.equal(packageLock.version, app.version);
assert.equal(packageLock.packages?.[""]?.version, app.version);
assert.equal(app.ios.buildNumber, "45");
for (const patch of dependencyPatches) {
  assert.doesNotMatch(
    patch.source,
    /(?:^|\n)diff --git .*node_modules\/.*\/android\/(?:\.cxx|build)\/|\/Users\/|Binary files /,
    `${patch.name} must contain source changes only, never local build artifacts or absolute paths`,
  );
}
assert.doesNotMatch(
  publicEnvSource,
  /EXPO_PUBLIC_NAVER_MAP_CLIENT_SECRET|EXPO_PUBLIC_NAVER_CLIENT_ID/,
  "Unused Naver secrets/legacy IDs must not be statically embedded in the client bundle",
);
assert.match(
  publicEnvSource,
  /EXPO_PUBLIC_SCHEDULE_SHARING_ENABLED:\s*process\.env\.EXPO_PUBLIC_SCHEDULE_SHARING_ENABLED/,
  "Expo must statically embed the schedule-sharing rollout key",
);
assert.match(
  envExample,
  /^EXPO_PUBLIC_SCHEDULE_SHARING_ENABLED=true$/m,
  "Store/release environment defaults must keep schedule sharing available",
);
assert.doesNotMatch(
  envExample,
  /^EXPO_PUBLIC_SCHEDULE_SHARING_ENABLED=false$/m,
  "The checked-in release environment must not silently activate the sharing kill switch",
);
assert.doesNotMatch(
  jestSetup,
  /process\.env\.EXPO_PUBLIC_SCHEDULE_SHARING_ENABLED\s*=\s*["']false["']/,
  "The global Jest environment must retain the default-on sharing policy",
);
assert.match(
  scheduleSharingPolicy,
  /return rawValue === undefined \|\| rawValue === ["']true["'];/,
  "Missing configuration and only the exact literal true may enable schedule sharing",
);
assert.match(
  scheduleSharingPolicy,
  /getEnv\(SCHEDULE_SHARING_ENV_KEY\)/,
  "All sharing boundaries must use the central public rollout policy",
);
assert.doesNotMatch(
  scheduleSharingPolicy,
  /rawValue\??\.trim\(\)|String\(rawValue\)|toLowerCase\(\)/,
  "Malformed schedule-sharing configuration must remain disabled",
);
for (const [name, source] of [
  ["login", loginScreen],
  ["signup", signupScreen],
]) {
  assert.match(
    source,
    /retainScheduleShareTokenForEnabledPolicy\(\s*normalizeShareToken\(shareToken\)/,
    `${name} must discard old share tokens before post-auth navigation when sharing is off`,
  );
}
assert.match(
  rootLayout,
  /getScheduleSharingRouteRedirect\(/,
  "The root navigator must guard old sharing routes before their screens mount",
);
assert.doesNotMatch(
  rootLayout,
  /(?:TEMPORARY|DEV)[A-Z_]*ROUTE[A-Z_]*QA|ROUTE_QA_ACCESS/i,
  "Development route QA access must never ship in the root navigator",
);
assert.match(
  rootLayout,
  /if \(!isAuthenticated && !isPublicRoute\)/,
  "Unauthenticated private routes must redirect to login",
);
assert.match(
  rootLayout,
  /guard=\{isAuthenticated && isCurationCompleted\}/,
  "Private app routes must require authentication and completed onboarding",
);
assert.doesNotMatch(
  scheduleDetail,
  /DEV_ROUTE_QA_|id\s*===\s*["']route-qa["']|focusZoom/,
  "Simulator route fixtures must not ship in the schedule detail screen",
);
assert.equal(app.plugins.find((entry) => Array.isArray(entry) && entry[0] === "expo-build-properties")?.[1]?.android?.usesCleartextTraffic, false);
assert.ok(app.android.blockedPermissions.includes("android.permission.CAMERA"));
assert.ok(app.android.blockedPermissions.includes("android.permission.RECORD_AUDIO"));
assert.ok(rootAndroidFirebaseConfig === nativeAndroidFirebaseConfig, "Android Firebase config copies must match");
assert.ok(rootIosFirebaseConfig === nativeIosFirebaseConfig, "iOS Firebase config copies must match");

assert.match(androidGradle, /versionCode 41/);
assert.match(androidGradle, /versionName "1\.2\.0"/);
assert.match(androidGradle, /release \{\s+signingConfig signingConfigs\.release/);
assert.match(androidGradle, /Release signing is not configured/);
assert.match(
  nolateTmapAndroidGradle,
  /^\s*implementation ['"]com\.google\.android\.material:material:1\.12\.0['"]\s*$/m,
  "The TMAP wrapper must own the MaterialComponents resources required by its local AAR",
);
assert.match(androidManifest, /android:usesCleartextTraffic="false"/);
assert.match(androidManifest, /android:allowBackup="false"/);
assert.match(androidManifest, /android:name="\.MainActivity"[^>]+android:screenOrientation="portrait"/);
for (const internalActivity of [
  "com.canhub.cropper.CropImageActivity",
  "androidx.compose.ui.tooling.PreviewActivity",
]) {
  const escapedActivity = internalActivity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    androidManifest,
    new RegExp(`android:name="${escapedActivity}"[\\s\\S]*?android:exported="false"`),
    `${internalActivity} must not be externally launchable`,
  );
}
for (const permission of [
  "WRITE_EXTERNAL_STORAGE",
  "READ_EXTERNAL_STORAGE",
  "SYSTEM_ALERT_WINDOW",
  "WRITE_CALENDAR",
  "CAMERA",
  "RECORD_AUDIO",
]) {
  const declaration = androidManifest.match(
    new RegExp(`<uses-permission[^>]+android\\.permission\\.${permission}[^>]*>`, "g"),
  );
  assert.ok(declaration?.length, `Android manifest must explicitly remove ${permission}`);
  for (const entry of declaration) {
    assert.match(entry, /tools:node="remove"/, `${permission} must only be present as a merge removal marker`);
  }
}

verifyIosTargetConfigurationPolicy(iosProject, app.ios.buildNumber);
assert.ok((iosProject.match(/MARKETING_VERSION = 1\.2\.0;/g) ?? []).length >= 4);
assert.ok(/PRODUCT_BUNDLE_IDENTIFIER = com\.anonymous\.nolatefe;/.test(iosProject), "Main iOS bundle identifier is missing");
assert.ok(/PRODUCT_BUNDLE_IDENTIFIER = "com\.anonymous\.nolatefe\.quick-schedule";/.test(iosProject), "Share extension bundle identifier is missing");
assert.ok(/APS_ENVIRONMENT = production;/.test(iosProject), "Release APNs environment must be production");
assert.ok(/NOLATE_API_BASE_URL = "?https:\/\//.test(iosProject), "Share extension release API must use HTTPS");
assert.ok(/PrivacyInfo\.xcprivacy in Resources/.test(iosProject), "Privacy manifest must be copied into the app bundle");
assert.doesNotMatch(iosInfo, /NSAllowsArbitraryLoads/);
assert.doesNotMatch(iosInfo, /NSLocationAlwaysUsageDescription|NSFaceIDUsageDescription/);
assert.match(iosInfo, /UISupportedInterfaceOrientations[\s\S]*?UIInterfaceOrientationPortrait/);
assert.doesNotMatch(iosInfo, /UIInterfaceOrientationLandscape|UIInterfaceOrientationPortraitUpsideDown/);
assert.match(iosInfo, /NSRemindersUsageDescription/);
assert.match(iosInfo, /NSRemindersFullAccessUsageDescription/);
assert.ok(app.ios.infoPlist.NSRemindersUsageDescription);
assert.ok(app.ios.infoPlist.NSRemindersFullAccessUsageDescription);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypeEmailAddress/);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypePreciseLocation/);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypeOtherUserContent/);

const sharedAccessGroupSuffix = "com.anonymous.nolatefe";
const runtimeAccessGroup = `457QQLB6H6.${sharedAccessGroupSuffix}`;
const sharedAppGroup = "group.com.anonymous.nolatefe.shared";
assert.match(mainEntitlements, new RegExp(`\\$\\(AppIdentifierPrefix\\)${sharedAccessGroupSuffix}`));
assert.match(extensionEntitlements, new RegExp(`\\$\\(AppIdentifierPrefix\\)${sharedAccessGroupSuffix}`));
assert.ok(app.ios.entitlements["com.apple.security.application-groups"].includes(sharedAppGroup));
assert.ok(mainEntitlements.includes(sharedAppGroup));
assert.ok(extensionEntitlements.includes(sharedAppGroup));
assert.ok(mainShareAuth.includes(runtimeAccessGroup));
assert.ok(shareExtension.includes(runtimeAccessGroup));
assert.ok(mainShareAuth.includes(sharedAppGroup));
assert.ok(shareExtension.includes(sharedAppGroup));
for (const key of ["nolte_access_token", "nolte_refresh_token", "nolate_auth_api_base_url"]) {
  assert.ok(shareExtension.includes(key), `Share extension is missing the native auth key: ${key}`);
}
assert.ok(mainShareAuth.includes('@"app:no-auth"'));
assert.ok(shareExtension.includes('"app:no-auth"'));
assert.ok(mainShareAuth.includes("getAppGroupSessionState"));
assert.ok(mainShareAuth.includes("setAppGroupSessionState"));
assert.ok(mainShareAuth.includes(
  "RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(setAppGroupSessionStateSync:",
));
assert.ok(mainShareAuth.includes(
  "RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(beginAppGroupSessionTransitionSync:",
));
assert.ok(mainShareAuth.includes(
  "RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(compareAndSetAppGroupSessionStateSync:",
));
assert.match(
  mainShareAuth,
  /compareAndSetAppGroupSessionStateSync:[\s\S]*?writeAppGroupSessionStateSynchronously:value[\s\S]*?writeAppGroupSessionStateSynchronously:@"invalidated"/,
  "A failed App Group active-session CAS must synchronously roll back to invalidated",
);
assert.ok(mainShareAuth.includes('@"status": @"mismatch"'));
assert.ok(mainShareAuth.includes('@"status": @"partial"'));
assert.ok(mainShareAuth.includes('hasPrefix:@"publishing:"'));
assert.match(
  shareExtension,
  /"Bearer \\\(workflow\.accessToken\)"[\s\S]*?forHTTPHeaderField: "Authorization"/,
  "Share Extension must send the workflow-captured signed access JWT generation",
);
assert.match(
  mainShareAuth,
  /status = SecItemAdd\([\s\S]*?if \(status == errSecDuplicateItem\) \{[\s\S]*?status = SecItemUpdate\(/,
  "The native shared-Keychain writer must converge an Expo/native duplicate-Add race with Update",
);
assert.ok(shareExtension.includes('private let appGroupSessionStateKey = "nolate_auth_session_state"'));
assert.ok(shareExtension.includes("readAppGroupSessionStateStrict"));
assert.ok(shareExtension.includes("captureWorkflowSession"));
assert.ok(shareExtension.includes("isWorkflowCurrent(workflow)"));
assert.doesNotMatch(
  shareExtension,
  /writeKeychain\(|SecItemUpdate\(|SecItemAdd\(/,
  "Share extension must never persist a refreshed credential over a newer app session",
);
assert.doesNotMatch(
  shareExtension,
  /api\/member\/auth\/refresh|ShareTokenRefreshCoordinator|refreshTokens\(|retrying:/,
  "Share extension must never consume the main app's single-use rotating refresh token",
);
assert.match(
  shareExtension,
  /if http\.statusCode == 401 \{[\s\S]*?throw ShareAPIError\.loginRequired\s+\}/,
  "Share extension access-token expiry must fail closed and direct the user to the app",
);
assert.ok(
  shareExtension.includes('"routeSetupRequired": true'),
  "Quick-share schedules must be marked for route setup",
);
assert.match(
  shareExtension,
  /let _: SavedSchedule = try await api\.post\([\s\S]*?"api\/schedules",[\s\S]*?workflow: workflow/,
  "The share extension must save the parsed schedule directly",
);
assert.match(
  shareExtension,
  /extensionContext\.open\(url\)[\s\S]*?completeRequest/,
  "The share extension must safely complete even when the containing-app URL cannot open",
);
assert.doesNotMatch(
  shareExtension,
  /PlaceInputView|findRoutes|routeOptions|pendingQuickSchedule/,
  "The quick-share screen must not restore the removed route editor or draft handoff flow",
);
assert.doesNotMatch(
  shareExtension,
  /unicodeScalars\.prefix\(/,
  "Quick share must never silently truncate the original sentence",
);
assert.match(
  shareExtension,
  /let hasExplicitEndTime: Bool\?/,
  "Share extension must decode the parse contract's explicit-end flag compatibly",
);
assert.match(
  shareExtension,
  /parsed\.hasExplicitEndTime == true/,
  "A legacy parse response without the explicit-end flag must fall back to no end time",
);
assert.match(
  shareExtension,
  /"hasEndTime": explicitEndAt != nil/,
  "Share extension and the app must save the same explicit-end semantics",
);

console.log("Release configuration checks passed.");
