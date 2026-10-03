# Xcode 27 / Expo 54 iOS 실행 호환 수정

## 변경

- `patches/expo++@expo+cli+54.0.25.patch`: 선택된 Xcode의 Simulator 또는 Device Hub 탐색. `DEVELOPER_DIR` 및 공백이 있는 경로 지원. 실행 여부 확인과 창 활성화도 해당 앱을 사용한다.
- Xcode 27의 devicectl은 시뮬레이터도 반환한다. 같은 UDID가 중복될 때 simctl 결과를 우선하여 실제 기기 설치 경로로 들어가는 문제를 수정했다.
- `ios/NoLateFE/AppDelegate.swift`, `Info.plist`: 단일 Scene 생명주기 채택. Scene에서 UIWindow와 React Native를 시작하고 Expo foreground/background 콜백, 기존 로그인 URL 및 universal-link 핸들러로 연결한다. 콜드 스타트의 URL·user activity·알림 정보는 React Native launchOptions로 전달한다.
- `patches/expo-dev-launcher+6.0.21.patch`: Scene이 활성화된 뒤 개발 런처를 초기화한다. 콜드 스타트 개발 URL은 기존 AppDelegate URL 콜백을 기다리지 않고 처리한다.
- 기존 postinstall의 patch-package가 두 패치를 재적용한다. 앱 전체 SDK 업그레이드는 하지 않았다.

## 실행

```sh
cd ~/IdeaProjects/NoLate/NoLate_FE
npm run ios:simulator -- --device "iPhone 18 Pro"
```

`ios:simulator`는 Metro 주소를 127.0.0.1로 지정한다. 이 환경의 LAN 주소로 연결했을 때는 시간 초과가 발생했다. 기존 `npm run ios`는 그대로 사용할 수 있다. 실기기에서는 Mac의 접근 가능한 LAN 주소가 필요하다.

의존성을 새로 설치하면 postinstall이 패치를 적용한다. 현재 설치에도 이미 적용했다. 회귀 테스트는 `npm run test:ios-compat`로 실행한다.

## 검증

- 기존 패치 대상 파일을 원본으로 되돌린 후 postinstall 재적용 확인.
- CLI 회귀 테스트 8개 통과: 구형 Simulator, Device Hub, DEVELOPER_DIR 두 형식, 누락된 앱, 실행 명령, 시뮬레이터 중복 분류와 실기기 보존.
- Xcode 27 Release / Debug 시뮬레이터 빌드 성공.
- iOS 27 Release에서 로그인 화면과 프로세스 생존 확인. 이전 `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` 시작 실패 해소.
- iOS 26.5 Release에서도 로그인 화면 확인.
- iOS 27 Debug에서 localhost Metro 번들 로딩 및 로그인 화면 확인.
- 최종 Debug 빌드를 설치한 뒤 앱이 종료된 상태에서 개발 URL로 콜드 스타트하여 로그인 화면과 프로세스 생존 확인.
- Expo `run:ios --binary … --device … --no-bundler --no-install`로 설치·실행 경로 검증. Xcode 빌드 자체는 별도 xcodebuild로 수행했다.

## 남은 범위

- Device Hub는 정상 종료 및 강제 종료 후 재시작해도 UI 조회가 timeout으로 실패했다. 앱 프로세스와 simctl은 동작하지만, Device Hub를 통한 화면 조작 E2E는 완료하지 못했다.
- 일반 custom-scheme 딥링크 검증은 iOS의 “NoLate에서 열겠습니까?” 확인창에서 멈췄다. 실제 소셜 로그인, universal links, 푸시 클릭 및 백그라운드 복구는 별도 기기 검증이 필요하다.
- 이 저장소는 네이티브 iOS 코드를 직접 관리한다. `expo prebuild --clean`은 AppDelegate를 재생성하므로 이 Scene 변경을 보존하지 않는다. SDK 업그레이드 시 공식 Scene 지원으로 전환하고 두 호환 패치를 제거·재검증한다.
- `Unexpected devicectl JSON version` 경고는 남는다. 이번 검증은 시뮬레이터 대상이며 실제 연결 기기 설치는 검증하지 않았다.

## 참고

- [Expo iOS Simulator 문서](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Scene 생명주기 마이그레이션](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md)
- [Apple TN3187](https://developer.apple.com/documentation/technotes/tn3187-migrating-to-the-uikit-scene-based-life-cycle)

빌드 로그: `/private/tmp/nolate-xcode27-scene-release.log`, `/private/tmp/nolate-xcode27-scene-debug.log`.
CLI 로그: `/private/tmp/nolate-expo-ios-localhost.log`. Metro 로그: `/private/tmp/nolate-scene-metro.log`.
테스트 API는 기존 합성 계정 서버 127.0.0.1:5522를 사용했다. 이 주소를 운영 빌드에 포함하면 안 된다.

후속 로그인 조사: 테스트 서버가 127.0.0.1:5522를 점유한 채 사용자의 개발 서버와 공존하여 기존 계정 요청을 잘못 받았다. 테스트 서버 5522/5523을 종료했고, 127.0.0.1과 localhost가 모두 사용자의 개발 서버로 연결되는 것을 확인했다. 앱의 개발용 API 주소 설정은 변경하지 않았다.

화면 증거: [iOS 27 Release](2026-09-25-xcode27-compatibility/ios27-release-login.png), [iOS 26.5 Release](2026-09-25-xcode27-compatibility/ios26-release-login.png), [iOS 27 Debug 콜드 스타트](2026-09-25-xcode27-compatibility/ios27-debug-cold-login.png).
