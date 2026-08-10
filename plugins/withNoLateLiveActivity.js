const { createRunOncePlugin, withInfoPlist, withXcodeProject } = require("@expo/config-plugins");

const TARGET_NAME = "NoLateLiveActivityExtension";
const MODULE_ROOT = "../modules/nolate-live-activity/ios";
const APP_INTENT_PATH = `${MODULE_ROOT}/Shared/NoLateDepartureLiveActivityIntent.swift`;
const EXTENSION_SOURCE_PATHS = [
  `${MODULE_ROOT}/NoLateLiveActivityModels.swift`,
  `${MODULE_ROOT}/Shared/NoLateDepartureActivityAttributes.swift`,
  APP_INTENT_PATH,
  `${MODULE_ROOT}/Extension/NoLateLiveActivityBundle.swift`,
  `${MODULE_ROOT}/Extension/NoLateDepartureLiveActivity.swift`,
  `${MODULE_ROOT}/Extension/NoLateRouteBarView.swift`,
];
const ASSET_PATH = `${MODULE_ROOT}/Extension/Assets.xcassets`;
const INFO_PLIST_PATH = `${MODULE_ROOT}/Extension/Info.plist`;

const unquote = (value) => String(value ?? "").replace(/^"|"$/g, "");

function liveActivityBundleIdentifier(config) {
  const mainBundleIdentifier = String(config.ios?.bundleIdentifier ?? "").trim();
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(mainBundleIdentifier)) {
    throw new Error("A valid config.ios.bundleIdentifier is required for Live Activity.");
  }
  return `${mainBundleIdentifier}.live-activity`;
}

function appendingSwiftCompilationCondition(existing, condition) {
  const current = unquote(existing).trim();
  const tokens = current.split(/\s+/).filter(Boolean);
  if (tokens.includes(condition)) return `"${current}"`;
  return `"${[...(tokens.length ? tokens : ["$(inherited)"]), condition].join(" ")}"`;
}

function targetEntry(project, name) {
  const section = project.pbxNativeTargetSection();
  for (const [uuid, target] of Object.entries(section)) {
    if (uuid.endsWith("_comment") || typeof target !== "object") continue;
    if (unquote(target.name) === name) return { uuid, target };
  }
  return null;
}

function buildPhase(project, target, isa) {
  const phases = project.hash.project.objects[isa] ?? {};
  for (const reference of target.buildPhases ?? []) {
    const phase = phases[reference.value];
    if (phase) return phase;
  }
  return null;
}

function fileReference(project, path, fileType) {
  const references = project.pbxFileReferenceSection();
  const moduleRelativePath = path.startsWith(`${MODULE_ROOT}/`)
    ? path.slice(MODULE_ROOT.length + 1)
    : path;
  for (const [uuid, reference] of Object.entries(references)) {
    if (uuid.endsWith("_comment") || typeof reference !== "object") continue;
    const existingPath = unquote(reference.path);
    if (existingPath === path || existingPath === moduleRelativePath) return uuid;
  }
  const uuid = project.generateUuid();
  references[uuid] = {
    isa: "PBXFileReference",
    lastKnownFileType: fileType,
    path: `"${path}"`,
    sourceTree: '"<group>"',
  };
  references[`${uuid}_comment`] = path.split("/").at(-1);
  return uuid;
}

function addBuildFile(project, phase, fileRef, comment) {
  const buildFiles = project.pbxBuildFileSection();
  const alreadyPresent = (phase.files ?? []).some(({ value }) =>
    buildFiles[value]?.fileRef === fileRef
  );
  if (alreadyPresent) return;
  const uuid = project.generateUuid();
  buildFiles[uuid] = { isa: "PBXBuildFile", fileRef, fileRef_comment: comment };
  buildFiles[`${uuid}_comment`] = `${comment} in ${phase.isa === "PBXResourcesBuildPhase" ? "Resources" : "Sources"}`;
  phase.files ??= [];
  phase.files.push({ value: uuid, comment: buildFiles[`${uuid}_comment`] });
}

function ensureGroup(project, fileRefs) {
  const groups = project.hash.project.objects.PBXGroup;
  let groupUuid = project.findPBXGroupKey({ name: TARGET_NAME });
  let created = false;
  if (!groupUuid) {
    // Children use SOURCE_ROOT-relative paths. Keeping this group pathless avoids resolving
    // `../modules/...` twice after a clean prebuild.
    const group = project.addPbxGroup([], TARGET_NAME, undefined, '"<group>"');
    groupUuid = group.uuid;
    created = true;
    project.addToPbxGroup(groupUuid, project.getFirstProject().firstProject.mainGroup);
  }
  const group = groups[groupUuid];
  // node-xcode serializes an omitted addPbxGroup path as the literal `undefined` unless it is
  // removed explicitly. Existing hand-wired groups may intentionally be module-relative.
  if (created || unquote(group.path) === "undefined") delete group.path;
  for (const { fileRef, comment } of fileRefs) {
    if (!group.children.some(({ value }) => value === fileRef)) {
      group.children.push({ value: fileRef, comment });
    }
  }
}

function ensureTargetDependency(project, mainTargetUuid, extensionTargetUuid) {
  project.hash.project.objects.PBXTargetDependency ??= {};
  project.hash.project.objects.PBXContainerItemProxy ??= {};
  const dependencies = project.pbxNativeTargetSection()[mainTargetUuid].dependencies ?? [];
  const dependencySection = project.hash.project.objects.PBXTargetDependency ?? {};
  const alreadyPresent = dependencies.some(({ value }) =>
    dependencySection[value]?.target === extensionTargetUuid
  );
  if (!alreadyPresent) project.addTargetDependency(mainTargetUuid, [extensionTargetUuid]);
}

function ensureEmbeddedProduct(project, mainTarget, extensionTarget) {
  const phases = project.hash.project.objects.PBXCopyFilesBuildPhase ?? {};
  let embedPhase;
  for (const reference of mainTarget.buildPhases ?? []) {
    const candidate = phases[reference.value];
    if (candidate?.dstSubfolderSpec === 13 || candidate?.dstSubfolderSpec === "13") {
      embedPhase = candidate;
      break;
    }
  }
  if (!embedPhase) {
    embedPhase = project.addBuildPhase(
      [],
      "PBXCopyFilesBuildPhase",
      "Embed App Extensions",
      project.getFirstTarget().uuid,
      "app_extension",
    ).buildPhase;
  }
  embedPhase.name = '"Embed App Extensions"';
  const productRef = extensionTarget.productReference;
  const buildFiles = project.pbxBuildFileSection();
  const alreadyEmbedded = (embedPhase.files ?? []).some(({ value }) =>
    buildFiles[value]?.fileRef === productRef
  );
  if (alreadyEmbedded) return;
  const uuid = project.generateUuid();
  buildFiles[uuid] = {
    isa: "PBXBuildFile",
    fileRef: productRef,
    fileRef_comment: `${TARGET_NAME}.appex`,
    settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
  };
  buildFiles[`${uuid}_comment`] = `${TARGET_NAME}.appex in Embed App Extensions`;
  embedPhase.files ??= [];
  embedPhase.files.push({ value: uuid, comment: buildFiles[`${uuid}_comment`] });
}

function configurationsForTarget(project, target) {
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const configurations = project.pbxXCBuildConfigurationSection();
  return (list?.buildConfigurations ?? [])
    .map(({ value }) => configurations[value])
    .filter(Boolean);
}

function extensionBuildSettings(project, config, mainTarget, extensionTarget, bundleIdentifier) {
  const teamByConfiguration = {};
  for (const build of configurationsForTarget(project, mainTarget)) {
    teamByConfiguration[build.name] = build.buildSettings.DEVELOPMENT_TEAM;
    build.buildSettings.SWIFT_ACTIVE_COMPILATION_CONDITIONS =
      appendingSwiftCompilationCondition(
        build.buildSettings.SWIFT_ACTIVE_COMPILATION_CONDITIONS,
        "NOLATE_LIVE_ACTIVITY_APP",
      );
  }

  for (const build of configurationsForTarget(project, extensionTarget)) {
    const settings = build.buildSettings;
    settings.APPLICATION_EXTENSION_API_ONLY = "YES";
    settings.CODE_SIGN_STYLE = "Automatic";
    settings.CURRENT_PROJECT_VERSION = config.ios?.buildNumber ?? "1";
    settings.DEVELOPMENT_TEAM = teamByConfiguration[build.name] ?? '""';
    settings.GENERATE_INFOPLIST_FILE = "NO";
    settings.INFOPLIST_FILE = `"${INFO_PLIST_PATH}"`;
    settings.IPHONEOS_DEPLOYMENT_TARGET = "16.6";
    settings.LD_RUNPATH_SEARCH_PATHS =
      '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"';
    settings.MARKETING_VERSION = config.version ?? "1.0.0";
    settings.PRODUCT_BUNDLE_IDENTIFIER = `"${bundleIdentifier}"`;
    settings.PRODUCT_NAME = TARGET_NAME;
    settings.SKIP_INSTALL = "YES";
    settings.SWIFT_EMIT_LOC_STRINGS = "YES";
    settings.SWIFT_VERSION = "5.0";
    settings.TARGETED_DEVICE_FAMILY = "1";
  }
}

function ensureLiveActivityTarget(project, config) {
  const mainTarget = project.getFirstTarget();
  const bundleIdentifier = liveActivityBundleIdentifier(config);
  project.hash.project.objects.PBXTargetDependency ??= {};
  project.hash.project.objects.PBXContainerItemProxy ??= {};
  let extension = targetEntry(project, TARGET_NAME);
  if (!extension) {
    const added = project.addTarget(
      TARGET_NAME,
      "app_extension",
      TARGET_NAME,
      bundleIdentifier,
    );
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", added.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", added.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", added.uuid);
    project.addTargetAttribute("CreatedOnToolsVersion", "16.0", added);
    extension = { uuid: added.uuid, target: added.pbxNativeTarget };
  }

  ensureTargetDependency(project, mainTarget.uuid, extension.uuid);
  ensureEmbeddedProduct(project, mainTarget.firstTarget, extension.target);

  const sourcePhase = buildPhase(project, extension.target, "PBXSourcesBuildPhase");
  const resourcePhase = buildPhase(project, extension.target, "PBXResourcesBuildPhase");
  const mainSourcePhase = buildPhase(project, mainTarget.firstTarget, "PBXSourcesBuildPhase");
  if (!sourcePhase || !resourcePhase || !mainSourcePhase) {
    throw new Error("Unable to locate Live Activity Xcode build phases.");
  }

  const fileRefs = EXTENSION_SOURCE_PATHS.map((path) => ({
    fileRef: fileReference(project, path, "sourcecode.swift"),
    comment: path.split("/").at(-1),
  }));
  const assetRef = fileReference(project, ASSET_PATH, "folder.assetcatalog");
  const infoRef = fileReference(project, INFO_PLIST_PATH, "text.plist.xml");
  for (const file of fileRefs) addBuildFile(project, sourcePhase, file.fileRef, file.comment);
  addBuildFile(project, resourcePhase, assetRef, "Assets.xcassets");
  const intentRef = fileRefs.find(({ comment }) => comment === "NoLateDepartureLiveActivityIntent.swift");
  addBuildFile(project, mainSourcePhase, intentRef.fileRef, intentRef.comment);
  ensureGroup(project, [
    ...fileRefs,
    { fileRef: assetRef, comment: "Assets.xcassets" },
    { fileRef: infoRef, comment: "Info.plist" },
  ]);
  extensionBuildSettings(
    project,
    config,
    mainTarget.firstTarget,
    extension.target,
    bundleIdentifier,
  );
}

function withNoLateLiveActivity(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSSupportsLiveActivities = true;
    // ETA updates are scheduled at five-minute granularity. Opting into the
    // high-frequency ActivityKit budget would add battery cost without a UX need.
    mod.modResults.NSSupportsLiveActivitiesFrequentUpdates = false;
    return mod;
  });
  config = withXcodeProject(config, (mod) => {
    ensureLiveActivityTarget(mod.modResults, mod);
    return mod;
  });
  return config;
}

const plugin = createRunOncePlugin(
  withNoLateLiveActivity,
  "with-nolate-live-activity",
  "1.0.0",
);

plugin.__internal = {
  appendingSwiftCompilationCondition,
  liveActivityBundleIdentifier,
};

module.exports = plugin;
