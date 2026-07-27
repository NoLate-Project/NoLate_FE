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

const config = getDefaultConfig(__dirname);
const isReleaseBuild = (process.env.CONFIGURATION ?? "")
  .toLowerCase()
  .includes("release");

if (isReleaseBuild) {
  // A large clean install can leave Watchman's macOS index incomplete after an
  // FSEvents UserDropped recrawl. Release bundles must crawl the installed tree
  // directly so an existing dependency file is never reported as missing.
  config.resolver.useWatchman = false;
}

module.exports = config;
