import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const app = JSON.parse(read("app.json"));
const pkg = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
const publicEnvSource = read("src/api/env.ts");
const rootLayout = read("app/_layout.tsx");
const scheduleDetail = read("app/schedule/[id].tsx");
const androidGradle = read("android/app/build.gradle");
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
assert.equal(app.ios.buildNumber, "42");
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

assert.ok((iosProject.match(/CURRENT_PROJECT_VERSION = 42;/g) ?? []).length >= 4);
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
assert.ok(shareExtension.includes('private let appGroupSessionStateKey = "nolate_auth_session_state"'));
assert.ok(shareExtension.includes("readAppGroupSessionStateStrict"));
assert.ok(shareExtension.includes("captureWorkflowSession"));
assert.ok(shareExtension.includes("isWorkflowCurrent(workflow)"));
assert.doesNotMatch(
  shareExtension,
  /writeKeychain\(|SecItemUpdate\(|SecItemAdd\(/,
  "Share extension must never persist a refreshed credential over a newer app session",
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
