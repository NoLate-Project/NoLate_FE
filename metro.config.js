// const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
//
// /**
//  * Metro configuration
//  * https://reactnative.dev/docs/metro
//  *
//  * @type {import('@react-native/metro-config').MetroConfig}
//  */
// const config = {};
//
// module.exports = mergeConfig(getDefaultConfig(__dirname), config);


const { getDefaultConfig } = require("expo/metro-config");
const { createHash } = require("node:crypto");

const config = getDefaultConfig(__dirname);
// Expo inlines public environment values into JS. Release builds for different
// servers or transit providers can otherwise reuse the first transformed module.
const publicEnvironment = Object.keys(process.env)
    .filter((key) => key.startsWith("EXPO_PUBLIC_"))
    .sort()
    .map((key) => [key, process.env[key]]);
config.cacheVersion += ":" + createHash("sha256").update(JSON.stringify(publicEnvironment)).digest("hex");
// Isolated E2E servers change compile-time EXPO_PUBLIC values between runs.
// Partition their transform cache; never clear the shared 8085 server's cache.
if (process.env.NOLATE_E2E_METRO_CACHE_NAMESPACE?.startsWith("nolate-eta-real-e2e.")) {
    config.cacheVersion += ":" + process.env.NOLATE_E2E_METRO_CACHE_NAMESPACE;
}
// Isolated QA can use Node file watching when the local Watchman socket is unavailable.
// Metro's useWatchman switch is top-level; a resolver field does not change its file map.
if (process.env.NOLATE_QA_NO_WATCHMAN === "1") config.useWatchman = false;
module.exports = config;
