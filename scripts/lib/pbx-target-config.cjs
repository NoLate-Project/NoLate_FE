"use strict";

function section(source, name) {
  const startMarker = `/* Begin ${name} section */`;
  const endMarker = `/* End ${name} section */`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`PBX section not found: ${name}`);
  }
  return source.slice(start + startMarker.length, end);
}

function parseObjects(sectionSource) {
  const objects = new Map();
  const header = /^\s*([A-F0-9]+) \/\* ([^*]+) \*\/ = \{/gm;
  let match;
  while ((match = header.exec(sectionSource)) !== null) {
    const openBrace = header.lastIndex - 1;
    let depth = 0;
    let closeBrace = -1;
    for (let index = openBrace; index < sectionSource.length; index += 1) {
      if (sectionSource[index] === "{") depth += 1;
      if (sectionSource[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          closeBrace = index;
          break;
        }
      }
    }
    if (closeBrace < 0) {
      throw new Error(`Unterminated PBX object: ${match[1]}`);
    }
    objects.set(match[1], {
      comment: match[2].trim(),
      body: sectionSource.slice(openBrace + 1, closeBrace),
    });
    header.lastIndex = closeBrace + 1;
  }
  return objects;
}

function buildSettingsFor(source, targetName, configurationName) {
  const targets = parseObjects(section(source, "PBXNativeTarget"));
  const target = Array.from(targets.values()).find(
    (candidate) => candidate.comment === targetName,
  );
  if (!target) throw new Error(`PBX target not found: ${targetName}`);
  const configurationListId = target.body.match(
    /buildConfigurationList = ([A-F0-9]+) /,
  )?.[1];
  if (!configurationListId) {
    throw new Error(`PBX configuration list missing: ${targetName}`);
  }

  const lists = parseObjects(section(source, "XCConfigurationList"));
  const configurationList = lists.get(configurationListId);
  if (!configurationList) {
    throw new Error(`PBX configuration list object missing: ${targetName}`);
  }
  const entries = configurationList.body.match(
    /buildConfigurations = \(([\s\S]*?)\);/,
  )?.[1];
  const configurations = Array.from(
    entries?.matchAll(/([A-F0-9]+) \/\* ([^*]+) \*\//g) ?? [],
  );
  const configurationId = configurations.find(
    (entry) => entry[2].trim() === configurationName,
  )?.[1];
  if (!configurationId) {
    throw new Error(
      `PBX configuration not found: ${targetName}/${configurationName}`,
    );
  }

  const buildConfigurations = parseObjects(
    section(source, "XCBuildConfiguration"),
  );
  const configuration = buildConfigurations.get(configurationId);
  if (!configuration) {
    throw new Error(
      `PBX build configuration object missing: ${targetName}/${configurationName}`,
    );
  }
  const settingsBody = configuration.body.match(
    /buildSettings = \{([\s\S]*?)\n\s*\};/,
  )?.[1];
  if (settingsBody === undefined) {
    throw new Error(
      `PBX build settings missing: ${targetName}/${configurationName}`,
    );
  }
  const settings = {};
  for (const setting of settingsBody.matchAll(
    /^\s*([A-Z0-9_]+) = (.*);$/gm,
  )) {
    const rawValue = setting[2].trim();
    settings[setting[1]] =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue;
  }
  return settings;
}

function assertSetting(settings, key, expected, label) {
  if (settings[key] !== expected) {
    throw new Error(
      `${label} ${key} must be ${expected}, got ${settings[key] ?? "<missing>"}`,
    );
  }
}

function verifyIosTargetConfigurationPolicy(source, expectedBuildNumber) {
  const policy = [
    {
      target: "NoLateFE",
      entitlements: "NoLateFE/NoLateFE.entitlements",
    },
    {
      target: "NoLateShareExtension",
      entitlements:
        "NoLateShareExtension/NoLateShareExtension.entitlements",
    },
  ];
  const resolved = {};
  for (const entry of policy) {
    resolved[entry.target] = {};
    for (const configurationName of ["Debug", "Release"]) {
      const label = `${entry.target}/${configurationName}`;
      const settings = buildSettingsFor(
        source,
        entry.target,
        configurationName,
      );
      assertSetting(
        settings,
        "CURRENT_PROJECT_VERSION",
        expectedBuildNumber,
        label,
      );
      assertSetting(
        settings,
        "CODE_SIGN_ENTITLEMENTS",
        entry.entitlements,
        label,
      );
      resolved[entry.target][configurationName] = settings;
    }
  }

  resolved.NoLateFETests = {};
  for (const configurationName of ["Debug", "Release"]) {
    const label = `NoLateFETests/${configurationName}`;
    const settings = buildSettingsFor(
      source,
      "NoLateFETests",
      configurationName,
    );
    assertSetting(
      settings,
      "CURRENT_PROJECT_VERSION",
      expectedBuildNumber,
      label,
    );
    if (settings.CODE_SIGN_ENTITLEMENTS !== undefined) {
      throw new Error(
        `${label} must inherit the host app at runtime and must not declare app entitlements`,
      );
    }
    resolved.NoLateFETests[configurationName] = settings;
  }

  return resolved;
}

module.exports = {
  buildSettingsFor,
  verifyIosTargetConfigurationPolicy,
};
