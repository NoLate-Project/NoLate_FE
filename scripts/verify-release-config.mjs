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
const iosPodLock = read("ios/Podfile.lock");
const liveActivityPlugin = read("plugins/withNoLateLiveActivity.js");
const liveActivityExtensionInfo = read(
  "modules/nolate-live-activity/ios/Extension/Info.plist",
);
const liveActivityModels = read(
  "modules/nolate-live-activity/ios/NoLateLiveActivityModels.swift",
);
const liveActivityCoordinator = read(
  "modules/nolate-live-activity/ios/NoLateLiveActivityCoordinator.swift",
);
const liveActivityIntent = read(
  "modules/nolate-live-activity/ios/Shared/NoLateDepartureLiveActivityIntent.swift",
);
const liveActivityWidget = read(
  "modules/nolate-live-activity/ios/Extension/NoLateDepartureLiveActivity.swift",
);
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

assert.equal(app.version, "1.3.0");
assert.equal(app.orientation, "portrait", "The phone UI is designed and verified for portrait only");
assert.equal(pkg.version, app.version);
assert.equal(packageLock.version, app.version);
assert.equal(packageLock.packages?.[""]?.version, app.version);
assert.equal(app.ios.buildNumber, "53");
assert.equal(pkg.dependencies["react-native-google-mobile-ads"], "^16.4.0");
const adsPlugin = app.plugins.find(
  (entry) => Array.isArray(entry) && entry[0] === "react-native-google-mobile-ads",
);
assert.ok(adsPlugin, "Expo Google Mobile Ads config plugin is missing");
const expectedIosAdMobAppId = "ca-app-pub-6334753209593250~8546571360";
const expectedTrackingUsageDescription =
  "광고 식별자를 사용해 맞춤형 광고를 제공하고 광고 성과를 측정하기 위해 추적 권한을 요청합니다.";
assert.equal(
  app["react-native-google-mobile-ads"]?.android_app_id,
  adsPlugin[1]?.androidAppId,
  "Bare Android and Expo AdMob App IDs must match",
);
assert.equal(
  app["react-native-google-mobile-ads"]?.ios_app_id,
  adsPlugin[1]?.iosAppId,
  "Bare iOS and Expo AdMob App IDs must match",
);
assert.equal(
  adsPlugin[1]?.iosAppId,
  expectedIosAdMobAppId,
  "The release build must use the registered NoLate iOS AdMob App ID",
);
assert.match(
  adsPlugin[1]?.iosAppId ?? "",
  /^ca-app-pub-\d{16}~\d{10}$/,
  "The iOS AdMob App ID must use the ca-app-pub-<publisher>~<app> format",
);
assert.doesNotMatch(
  adsPlugin[1]?.iosAppId ?? "",
  /^ca-app-pub-3940256099942544~/,
  "Google sample iOS AdMob App IDs must never ship in a release build",
);
assert.equal(
  app["react-native-google-mobile-ads"]?.user_tracking_usage_description,
  adsPlugin[1]?.userTrackingUsageDescription,
  "Bare iOS and Expo ATT usage descriptions must match",
);
assert.equal(
  adsPlugin[1]?.userTrackingUsageDescription,
  expectedTrackingUsageDescription,
  "The ATT usage description must explain personalized ads and ad measurement",
);
assert.equal(app["react-native-google-mobile-ads"]?.delay_app_measurement_init, true);
assert.equal(adsPlugin[1]?.delayAppMeasurementInit, true);
assert.ok(
  app.plugins.includes("./plugins/withNoLateLiveActivity"),
  "The Live Activity config plugin must survive native regeneration",
);
assert.equal(app.ios.infoPlist.NSSupportsLiveActivities, true);
assert.equal(
  app.ios.infoPlist.NSSupportsLiveActivitiesFrequentUpdates,
  false,
  "Five-minute ETA refreshes must not opt into ActivityKit's frequent-update budget",
);
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
assert.ok(app.android.permissions.includes("CAMERA"));
assert.ok(app.android.permissions.includes("RECORD_AUDIO"));
assert.deepEqual(app.ios.associatedDomains, ["applinks:nolate.jinuk.dev"]);
assert.ok(
  app.android.intentFilters?.some((filter) =>
    filter.autoVerify === true &&
    filter.data?.some((data) =>
      data.scheme === "https" &&
      data.host === "nolate.jinuk.dev" &&
      data.pathPrefix === "/share/"
    )
  ),
  "Android verified app link for the production share path is missing",
);
assert.ok(rootAndroidFirebaseConfig === nativeAndroidFirebaseConfig, "Android Firebase config copies must match");
assert.ok(rootIosFirebaseConfig === nativeIosFirebaseConfig, "iOS Firebase config copies must match");

assert.equal(app.android.versionCode, 42);
assert.match(androidGradle, /versionCode 42/);
assert.match(androidGradle, /versionName "1\.3\.0"/);
assert.match(androidGradle, /release \{\s+signingConfig signingConfigs\.release/);
assert.match(androidGradle, /Release signing is not configured/);
assert.match(androidManifest, /android:usesCleartextTraffic="false"/);
assert.match(androidManifest, /android:allowBackup="false"/);
assert.match(androidManifest, /android:name="\.MainActivity"[^>]+android:screenOrientation="portrait"/);
assert.match(androidManifest, /android:autoVerify="true"[\s\S]*?android:host="nolate\.jinuk\.dev"[\s\S]*?android:pathPrefix="\/share\/"/);
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
]) {
  const declaration = androidManifest.match(
    new RegExp(`<uses-permission[^>]+android\\.permission\\.${permission}[^>]*>`, "g"),
  );
  assert.ok(declaration?.length, `Android manifest must explicitly remove ${permission}`);
  for (const entry of declaration) {
    assert.match(entry, /tools:node="remove"/, `${permission} must only be present as a merge removal marker`);
  }
}
for (const permission of ["CAMERA", "RECORD_AUDIO"]) {
  const declaration = androidManifest.match(
    new RegExp(`<uses-permission[^>]+android\\.permission\\.${permission}[^>]*>`, "g"),
  );
  assert.equal(declaration?.length, 1, `Android manifest must declare ${permission} exactly once`);
  assert.doesNotMatch(declaration[0], /tools:node="remove"/);
}
assert.match(androidManifest, /android\.speech\.RecognitionService/);
assert.match(androidGradle, /com\.google\.mlkit:text-recognition-korean:16\.0\.1/);
assert.ok(androidManifest.includes(adsPlugin[1].androidAppId));
assert.match(androidManifest, /com\.google\.android\.gms\.ads\.DELAY_APP_MEASUREMENT_INIT[\s\S]*?android:value="true"/);

assert.equal(
  (iosProject.match(/CURRENT_PROJECT_VERSION = 53;/g) ?? []).length,
  8,
  "The app and all three embedded extensions must use iOS build 53 in Debug and Release",
);
assert.equal(
  (iosProject.match(/CURRENT_PROJECT_VERSION = 52;/g) ?? []).length,
  2,
  "Only the two non-embedded test-target configurations may retain build 52",
);
assert.ok((iosProject.match(/MARKETING_VERSION = 1\.3\.0;/g) ?? []).length >= 10);
assert.ok(/PRODUCT_BUNDLE_IDENTIFIER = com\.anonymous\.nolatefe;/.test(iosProject), "Main iOS bundle identifier is missing");
assert.ok(/PRODUCT_BUNDLE_IDENTIFIER = "com\.anonymous\.nolatefe\.quick-schedule";/.test(iosProject), "Share extension bundle identifier is missing");
assert.ok(/APS_ENVIRONMENT = production;/.test(iosProject), "Release APNs environment must be production");
assert.ok(/NOLATE_API_BASE_URL = "?https:\/\//.test(iosProject), "Share extension release API must use HTTPS");
assert.ok(/PrivacyInfo\.xcprivacy in Resources/.test(iosProject), "Privacy manifest must be copied into the app bundle");
assert.match(iosProject, /NoLateLiveActivityExtension\.appex in Embed App Extensions/);
assert.match(iosProject, /PBXNativeTarget "NoLateLiveActivityExtension"/);
assert.match(iosProject, /PRODUCT_BUNDLE_IDENTIFIER = "com\.anonymous\.nolatefe\.live-activity"/);
assert.match(
  iosProject,
  /SWIFT_ACTIVE_COMPILATION_CONDITIONS = "\$\(inherited\) DEBUG NOLATE_LIVE_ACTIVITY_APP"/,
);
assert.match(iosProject, /target = .*NoLateLiveActivityExtension/);
assert.match(iosInfo, /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/);
assert.match(
  iosInfo,
  /<key>NSSupportsLiveActivitiesFrequentUpdates<\/key>\s*<false\/>/,
);
assert.match(iosPodLock, /- NoLateLiveActivity \(1\.0\.0\):/);
assert.match(liveActivityExtensionInfo, /com\.apple\.widgetkit-extension/);
assert.match(liveActivityModels, /struct NoLateDepartureContentState/);
assert.match(liveActivityModels, /actionExpiresAtEpochSeconds: Int64/);
assert.match(liveActivityModels, /maximumRouteSegments = 6/);
assert.match(liveActivityModels, /kind: \.destination,\s*label: "도착",\s*colorHex:/);
assert.match(liveActivityCoordinator, /"generation": activity\.map/);
assert.match(liveActivityCoordinator, /reconcileAndObserveActivities/);
assert.match(liveActivityCoordinator, /suppressedDuplicateActivityIds\.insert/);
const liveActivityGroupKey = liveActivityCoordinator.match(
  /private struct ActivityGroupKey[\s\S]*?\n  }/,
);
assert.ok(liveActivityGroupKey, "Live Activity duplicate grouping policy is missing");
assert.doesNotMatch(
  liveActivityGroupKey[0],
  /generation/,
  "Only one Activity may survive for a member/schedule across generations",
);
assert.match(liveActivityIntent, /NoLateAlarmDepartureActionBridge\.recordFromLiveActivity/);
assert.match(liveActivityIntent, /mayRecordDepartureAction/);
assert.match(liveActivityIntent, /await activity\.end\(/);
assert.doesNotMatch(liveActivityIntent, /replacingStatus\(\s*\.inTransit/);
assert.ok(
  (liveActivityWidget.match(/NoLateRouteBarView\(/g) ?? []).length >= 2,
  "Lock screen and expanded Dynamic Island must share the route bar component",
);
assert.match(liveActivityWidget, /Button\(intent: NoLateDepartureLiveActivityIntent/);
assert.match(liveActivityWidget, /isDepartureActionAvailable/);
assert.match(liveActivityWidget, /NoLateCompactStatusView/);
assert.match(liveActivityPlugin, /ensureTargetDependency/);
assert.match(liveActivityPlugin, /ensureEmbeddedProduct/);
assert.match(liveActivityPlugin, /delete group\.path/);
assert.match(liveActivityPlugin, /config\.ios\?\.bundleIdentifier/);
assert.doesNotMatch(
  liveActivityPlugin,
  /const BUNDLE_ID\s*=\s*["']com\./,
  "The extension bundle identifier must be derived from the configured app identifier",
);
assert.doesNotMatch(iosInfo, /NSAllowsArbitraryLoads/);
assert.doesNotMatch(iosInfo, /NSLocationAlwaysUsageDescription|NSFaceIDUsageDescription/);
assert.match(iosInfo, /UISupportedInterfaceOrientations[\s\S]*?UIInterfaceOrientationPortrait/);
assert.doesNotMatch(iosInfo, /UIInterfaceOrientationLandscape|UIInterfaceOrientationPortraitUpsideDown/);
assert.match(iosInfo, /NSRemindersUsageDescription/);
assert.match(iosInfo, /NSRemindersFullAccessUsageDescription/);
const nativeIosAdMobAppId = iosInfo.match(
  /<key>GADApplicationIdentifier<\/key>\s*<string>([^<]+)<\/string>/,
)?.[1];
assert.equal(
  nativeIosAdMobAppId,
  adsPlugin[1].iosAppId,
  "app.json and the native iOS Info.plist AdMob App IDs must match exactly",
);
assert.match(iosInfo, /GADDelayAppMeasurementInit[\s\S]*?<true\/>/);
const nativeTrackingUsageDescription = iosInfo.match(
  /<key>NSUserTrackingUsageDescription<\/key>\s*<string>([^<]+)<\/string>/,
)?.[1];
assert.equal(
  nativeTrackingUsageDescription,
  expectedTrackingUsageDescription,
  "app.json and the native iOS Info.plist ATT usage descriptions must match exactly",
);
assert.ok(app.ios.infoPlist.NSRemindersUsageDescription);
assert.ok(app.ios.infoPlist.NSRemindersFullAccessUsageDescription);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypeEmailAddress/);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypePreciseLocation/);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypeOtherUserContent/);

const sharedAccessGroupSuffix = "com.anonymous.nolatefe";
const runtimeAccessGroup = `457QQLB6H6.${sharedAccessGroupSuffix}`;
assert.match(mainEntitlements, new RegExp(`\\$\\(AppIdentifierPrefix\\)${sharedAccessGroupSuffix}`));
assert.match(mainEntitlements, /com\.apple\.developer\.associated-domains[\s\S]*?applinks:nolate\.jinuk\.dev/);
assert.match(extensionEntitlements, new RegExp(`\\$\\(AppIdentifierPrefix\\)${sharedAccessGroupSuffix}`));
assert.ok(mainShareAuth.includes(runtimeAccessGroup));
assert.ok(shareExtension.includes(runtimeAccessGroup));
for (const key of ["nolte_access_token", "nolte_refresh_token", "nolate_auth_api_base_url"]) {
  assert.ok(shareExtension.includes(key), `Share extension is missing the native auth key: ${key}`);
}
assert.ok(mainShareAuth.includes('@"app:no-auth"'));
assert.ok(shareExtension.includes('"app:no-auth"'));
assert.ok(
  shareExtension.includes('"routeSetupRequired": true'),
  "Quick-share schedules must be marked for route setup",
);
assert.match(
  shareExtension,
  /let _: SavedSchedule = try await api\.post\("api\/schedules", json: payload\)/,
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
