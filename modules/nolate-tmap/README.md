# NoLate TMAP native module

This local Expo module wraps TMAP Vector Map SDK for iOS and Android. The
vendor binaries are downloaded from TMAP's official distribution endpoint and
are intentionally not committed to the repository.

Install both platform SDKs before a native build:

```sh
npm run setup:tmap-native
```

You can install a single platform with
`bash scripts/install-tmap-native-sdk.sh ios` or
`bash scripts/install-tmap-native-sdk.sh android`.

The JavaScript map facade keeps a WebView fallback for Expo Go and tests, but
development and production native builds use this module.

Both platforms currently use TMAP Vector Map SDK 3.7. The iOS SDK's bundled
VSMSDK requires iOS 16.6 or later, so the app deployment target is 16.6.
`EXPO_PUBLIC_TMAP_APP_KEY` must be authorized for the native Vector Map product
and the app's Android package name / iOS bundle identifier.

Route direction arrows come from the SDK route-line renderer itself:

- Android: `TMapTrafficLine.setShowIndicator(true)`
- iOS: `TMapTrafficLine.showDirectionIndicator = true`

The app does not paint or position its own route arrows.
