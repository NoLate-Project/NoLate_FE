const { withInfoPlist } = require("@expo/config-plugins");

// Explicit opt-in for P0 development builds. Never enables tracking by itself.
function configureJourneyDiagnostics(info, enabled) {
  const previousModes = info.NoLateJourneyDiagnosticsOriginalBackgroundModes;
  if (!enabled) {
    if (!info.NoLateJourneyDiagnosticsEnabled) return info;
    const restored = { ...info };
    if (Array.isArray(previousModes)) restored.UIBackgroundModes = previousModes;
    const previousDescription = info.NoLateJourneyDiagnosticsOriginalLocationDescription;
    if (typeof previousDescription === "string") {
      if (previousDescription) restored.NSLocationWhenInUseUsageDescription = previousDescription;
      else delete restored.NSLocationWhenInUseUsageDescription;
    }
    delete restored.NoLateJourneyDiagnosticsEnabled;
    delete restored.NoLateJourneyDiagnosticsOriginalBackgroundModes;
    delete restored.NoLateJourneyDiagnosticsOriginalLocationDescription;
    return restored;
  }
  return {
    ...info,
    NoLateJourneyDiagnosticsEnabled: true,
    NoLateJourneyDiagnosticsOriginalBackgroundModes: previousModes ?? [...(info.UIBackgroundModes ?? [])],
    NoLateJourneyDiagnosticsOriginalLocationDescription:
      info.NoLateJourneyDiagnosticsOriginalLocationDescription ?? info.NSLocationWhenInUseUsageDescription ?? "",
    NSLocationWhenInUseUsageDescription:
      "길안내 개발 검증 중 전경과 잠금 상태의 위치 수신을 확인합니다. 위치 좌표는 서버에 전송하지 않습니다.",
    UIBackgroundModes: [...new Set([...(info.UIBackgroundModes ?? []), "location", "audio"])],
  };
}

function withNoLateJourneyDiagnostics(config) {
  // Register before expo-location in app.json. Info.plist mods run in reverse
  // registration order, so our opt-in description must be applied last.
  return withInfoPlist(config, (mod) => {
    mod.modResults = configureJourneyDiagnostics(
      mod.modResults,
      process.env.NOLATE_JOURNEY_DIAGNOSTICS_BUILD === "1",
    );
    mod.modResults = configureJourneyPushPilot(mod.modResults,
      process.env.NOLATE_JOURNEY_AUTHENTICATED_BUILD === "1",
      process.env.NOLATE_JOURNEY_APNS_PILOT_BUILD === "1");
    mod.modResults = configureDeviceFieldTest(mod.modResults,
      process.env.NOLATE_JOURNEY_DEVICE_FIELD_TEST_BUILD === "1");
    return mod;
  });
}

function configureJourneyPushPilot(info, authenticated, pushPilot) {
  const result = { ...info };
  delete result.NoLateJourneyAuthenticatedEnabled;
  delete result.NoLateJourneyAPNsPilotEnabled;
  if (info.NoLateJourneyDiagnosticsEnabled === true && authenticated) {
    result.NoLateJourneyAuthenticatedEnabled = true;
    if (pushPilot) result.NoLateJourneyAPNsPilotEnabled = true;
  }
  return result;
}

function configureDeviceFieldTest(info, requested) {
  const result = { ...info };
  delete result.NoLateJourneyDeviceFieldTestEnabled;
  if (requested && result.NoLateJourneyDiagnosticsEnabled === true &&
      result.NoLateJourneyAuthenticatedEnabled === true) {
    result.NoLateJourneyDeviceFieldTestEnabled = true;
  }
  return result;
}

module.exports = withNoLateJourneyDiagnostics;
module.exports.__internal = { configureJourneyDiagnostics, configureJourneyPushPilot, configureDeviceFieldTest };
