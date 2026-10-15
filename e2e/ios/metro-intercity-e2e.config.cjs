// Dedicated local intercity E2E only; never used by the app's normal Metro config.
// Expo's development virtual env merges .env after process.env. Excluding these
// files from this server's graph lets explicit test-session overrides take effect.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

if (process.env.CI !== '1' ||
    process.env.EXPO_PUBLIC_LOCAL_API_BASE_URL !== 'http://127.0.0.1:5524' ||
    process.env.EXPO_PUBLIC_TRANSIT_PROVIDER !== 'tmap') {
    throw new Error('Use this config only with the dedicated local API, CI=1 and explicit TMAP selection.');
}
const projectRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(projectRoot);
const escapedRoot = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const existing = config.resolver.blockList;
config.resolver.blockList = [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    new RegExp(`^${escapedRoot}/\\.env(?:\\.[^/]*)?$`),
];
module.exports = config;
