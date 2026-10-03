# App Review 시뮬레이터 검증 — 2026-09-09

## 결론

실제 iOS Release 앱에서 발견한 **로그아웃·재실행 순환 대기 문제를 수정했고, 동일 시뮬레이터에서 복구 → 로그인 → 로그아웃 → 재실행 → 재로그인이 통과했다.** 기존 데이터를 지우지 않고 수정본을 설치했으며 테스트 일정도 유지됐다.

전체 자동 테스트 250개 스위트 / 1,844개, 타입검사, 변경 파일 린트와 Release 빌드가 통과했다. 사용자가 테스트 계정 탈퇴를 직접 실행한 뒤, 17:59–18:00 KST에 기존 자격 증명 로그인 거절과 앱 재실행 후 로그인 화면 유지까지 확인했다. 이후 사용자 요청으로 앱과 세 확장의 빌드 번호를 55로 통일했고 배포 설정 검사가 통과했다. 업로드 바이너리 동일성 및 아래 미검증 항목이 남아 있으므로 **심사 준비 전체 통과로 판정하지 않는다.**

## 환경

- 앱: NoLate 1.3.0, 수정 전 빌드 54 / 수정 후 빌드 55, `com.anonymous.nolatefe`
- 소스: 현재 작업 트리(기존 미커밋 변경 및 동시 진행 중인 다른 수정 포함). 이번 작업은 인증 정리 순환 대기 수정과 관련 회귀 테스트 추가
- 기기: 전용 iPhone 17 Pro / iOS 26.5 시뮬레이터
- 이름: NoLate App Review QA 20260909
- UDID: `A20E8DC9-7ADF-42AE-9FC8-DE870E2061B7`
- API: `https://nolate.jinuk.dev`
- 최종 빌드: Release, `CODE_SIGNING_ALLOWED=YES`, `CODE_SIGN_IDENTITY=-`
- 산출물: `/private/tmp/nolate-review-qa-20260909/Build/Products/Release-iphonesimulator/NoLateFE.app`
- App Store Connect에 업로드된 바이너리와의 동일성은 이번 검증 범위에 포함하지 않음. 업로드·심사 제출하지 않음.

## 실제 화면 검증

| 항목 | 결과 | 근거 / 범위 |
| --- | --- | --- |
| Release 빌드·설치·실행 | 통과 | 수정 전 54 및 수정 후 55, Xcode 빌드 종료 코드 0. 당시 확장 빌드 번호 불일치는 이후 55 통일로 해소 |
| ATT 시스템 팝업 | 통과 | 한국어 목적 문구, 추적 금지 요청 / 허용 버튼 표시 |
| ATT 거부 | 통과 | 실제 거부 선택 후 로그인 화면 유지. TCC `kTCCServiceUserTracking` 값 0 |
| ATT 거부 후 재실행 | 통과 | 다시 묻지 않고 로그인 화면 표시 |
| ATT 허용 | 통과 | 실제 허용 상태 확인. TCC 값 2 |
| ATT 허용 후 재실행 | 통과 | 다시 묻지 않고 로그인 화면 표시 |
| 가입 폼 검증 | 통과 | 유효하지 않은 비밀번호 경고. 올바른 입력으로 약관 단계 진입 |
| 최신 가입 약관 조회 | 통과 | 서명 빌드에서 서버 조회 실패 안내 없이 표시 |
| 필수 약관 선택 | 통과 | 미선택 시 가입 버튼 비활성화, 모두 선택하면 활성화 |
| 개인정보처리방침 | 통과 | 서버 문서 2026.08.24 조회, 광고·UMP·ATT 고지 펼쳐 보기 |
| 잘못된 로그인 | 통과 | 미등록 테스트 이메일에 ‘이메일 또는 비밀번호를 다시 확인해 주세요’ 표시 |
| 회원가입·자동 로그인 | 통과 | 사용자 승인 후 일회용 계정 ReviewQA (#292) 생성, 온보딩 및 메인 진입 |
| 캘린더 연결 없이 시작 | 통과 | 외부 캘린더 연결을 생략해도 빈 메인 캘린더 진입 |
| 일정 생성·조회·수정 | 통과 | 테스트 일정 생성 후 제목과 종일 설정 변경, 상세 및 캘린더 반영 |
| 재실행 시 로그인·일정 유지 | 통과 | 로그아웃 전 앱 종료·재실행에서 수정된 일정 유지 |
| 기존 무한 로딩 상태 복구 | 수정 후 통과 | 앱 데이터를 지우지 않고 수정본을 설치하자 로그인 화면으로 복구 |
| 로그아웃 | 수정 후 통과 | 확인 버튼 실행 후 로그인 화면으로 전환. 기존 3분 이상 대기 현상 재발하지 않음 |
| 로그아웃 후 재실행 | 수정 후 통과 | 앱 종료·재실행 후 로그인 화면 유지, 로그인 상태 확인 무한 로딩 없음 |
| 일반 로그인 폼 재로그인 | 수정 후 통과 | 복구 직후 및 로그아웃·재실행 후 동일 계정으로 로그인 성공, 기존 일정 유지 |
| 회원탈퇴 입력 검증 | 통과 | ReviewQA #292에서 탈퇴 창 진입, 비밀번호 미입력 시 비활성화 / 입력 후 실행 버튼 활성화 |
| 실제 회원탈퇴·탈퇴 후 로그인 거절 | 사후 검증 통과 | 최종 탈퇴는 사용자가 직접 실행했다고 알림. 로그인 화면으로 돌아온 상태를 관찰하고, 직전 성공했던 테스트 계정 자격 증명으로 로그인 거절 확인 |
| 탈퇴 후 앱 재실행 | 통과 | 앱 종료·재실행 후 빈 로그인 폼 표시. 인증 복구 무한 로딩 재발 없음 |
| 일정 단독 삭제 | 미검증 | 생성·수정은 검증했지만 단독 삭제는 실행하지 않음 |
| 실제 광고 노출·UMP 지역별 화면 | 미검증 | 광고 정책 단위 테스트와 실제 광고 동작은 구분 |
| 실제 APNs·백그라운드 알림·외부 SNS 로그인 | 미검증 | 이번 시뮬레이터 검증으로 실기기 결과를 대체하지 않음 |

## 자동 테스트

최종 수정 후 결과:

- 전체 테스트: **250개 스위트 / 1,844개 통과** (`/private/tmp/nolate-logout-fix-tests-final.log`).
- 실제 API 인터셉터·인증 저장소·Live Activity coordinator를 연결한 회귀 테스트 7개 및 AuthProvider 생명주기 테스트 4개 추가.
- `npm run typecheck`: 통과. 변경한 인증/API 파일과 관련 테스트의 ESLint: 통과.
- 로컬 서명된 iOS Release 빌드: 통과 (`/private/tmp/nolate-logout-fix-build.log`).
- 빌드 55 통일 후 로컬 서명된 iOS Simulator Release 재빌드: 종료 코드 0 (`/private/tmp/nolate-build55-verification.log`). 산출물의 메인 앱·Share Extension·Widget·Live Activity Extension `Info.plist`를 직접 읽어 모두 **1.3.0 (55)**임을 확인했다. App Store 배포용 Archive 생성·업로드는 수행하지 않았다.
- `npm run verify:release-config`: 인증 수정 직후에는 메인 앱 55 / 세 확장 54 불일치로 실패했다. 이후 사용자 요청에 따라 `app.json`, 세 확장의 Debug/Release 번호, 검사 스크립트의 기대 번호를 모두 55로 맞췄다. 기본 검사와 `--platform ios` 검사 모두 **통과**. 비배포 테스트 타깃의 기존 번호 52는 유지했다.
- 작업 중 첫 전체 테스트와 타입검사에는 동시 수정 중인 공유 캘린더·inbox 관련 실패가 있었으나, 해당 파일을 수정하지 않고 최종 재실행에서 전체 통과를 확인했다.

수정 전 첫 화면 검증 단계에서도 아래 세 테스트 스위트, 총 18개 테스트는 통과했었다:

- `__tests__/trackingTransparency.test.ts`
- `__tests__/routeDetailAdvertisingPolicy.test.ts`
- `__tests__/accountCleanup.test.ts`

단위 테스트는 SDK·서버·네이티브 동작을 모킹하므로 실제 광고 네트워크 통신이나 서버 회원탈퇴 완료를 증명하지 않는다.

## 적용한 수정

- 로그아웃 전에 계정 정리를 완료한 경로에서는 서버 로그아웃 후 인증 토큰 삭제 시 동일 정리 listener를 다시 실행하지 않는다.
- 공유 refresh 작업은 인증 정리 listener를 직접 기다리지 않고 성공·확정 무효·일시 실패 결과를 반환한다. 일반 요청의 인증 무효화는 공유 refresh 작업 바깥에서 처리한다.
- Live Activity 등록·폐기 요청은 인증 실패 시 전역 정리로 재진입하지 않는다. 폐기는 refresh가 확정적으로 거절된 경우에만 서버 인증 폐기를 완료된 상태로 취급하고 네이티브 정리를 이어간다. 일반 401/403/404/503 및 통신 실패를 일괄 무시하지 않는다.
- 알림·위젯·Live Activity 정리 자체는 유지한다. 일시적 서버 장애에서는 네이티브 종료를 수행하되 자격 증명 삭제까지 진행하지 않는 회귀 테스트를 포함한다.

## 테스트 환경 문제와 해소

첫 빌드는 `CODE_SIGNING_ALLOWED=NO`로 만들었다. Keychain·앱 그룹 권한이 없는 이 빌드에서는 공개 약관 조회도 실패해 번들 문서를 표시했다. API 요청 인터셉터가 먼저 인증 저장소를 조회하는 구조를 확인했다.

동일 소스를 로컬 서명이 포함된 Release로 다시 빌드·설치했다. 시뮬레이터용 entitlement에 application identifier, Keychain 그룹, 앱 그룹 등이 포함됐고, 공개 문서와 가입 약관 조회가 정상화됐다. 이는 테스트 빌드 설정에 따른 문제로 분류하며, 실제 배포 바이너리의 결함으로 단정하지 않는다.

운영 `/health`는 HTTP 200 / `UP`, `/api/legal/signup-consents`는 HTTP 200 / 성공 응답을 확인했다. `/actuator/health`는 인증이 필요한 401 응답으로, 공개 health 경로와 구분했다.

## 증거 화면

수정 후:

- [데이터 초기화 없이 기존 정지 상태 복구](./2026-09-09-app-review-simulator/fixed-session-recovery.jpeg)
- [복구 후 일반 로그인과 기존 일정](./2026-09-09-app-review-simulator/fixed-login.jpeg)
- [로그아웃 완료](./2026-09-09-app-review-simulator/fixed-logout.jpeg)
- [로그아웃 후 재실행](./2026-09-09-app-review-simulator/fixed-logout-relaunch.jpeg)
- [재로그인 완료](./2026-09-09-app-review-simulator/fixed-relogin.jpeg)
- [회원탈퇴 비밀번호 입력 후 최종 실행 대기](./2026-09-09-app-review-simulator/withdrawal-ready.jpeg)
- [사용자 탈퇴 실행 후 로그인 화면](./2026-09-09-app-review-simulator/withdrawal-login-screen.jpeg)
- [탈퇴 계정 로그인 거절](./2026-09-09-app-review-simulator/withdrawal-login-rejected.jpeg)
- [탈퇴 후 재실행](./2026-09-09-app-review-simulator/withdrawal-relaunch.jpeg)

수정 전:

- [ATT 팝업](./2026-09-09-app-review-simulator/att-prompt.jpeg)
- [ATT 거부 후 재실행](./2026-09-09-app-review-simulator/att-denied-relaunch.jpeg)
- [ATT 허용 후 재실행](./2026-09-09-app-review-simulator/att-allowed-relaunch.jpeg)
- [서버 개인정보처리방침](./2026-09-09-app-review-simulator/privacy.jpeg)
- [미등록 계정 로그인 거절](./2026-09-09-app-review-simulator/invalid-login.jpeg)
- [최신 가입 약관과 활성화된 가입 버튼](./2026-09-09-app-review-simulator/signup-consent.jpeg)
- [가입 완료 후 온보딩](./2026-09-09-app-review-simulator/signup-success.jpeg)
- [테스트 일정 저장](./2026-09-09-app-review-simulator/schedule-saved.jpeg)
- [제목·종일 설정 수정 결과](./2026-09-09-app-review-simulator/schedule-edited.jpeg)
- [로그아웃 전 재실행 후 일정 유지](./2026-09-09-app-review-simulator/session-relaunch.jpeg)
- [테스트 계정 식별](./2026-09-09-app-review-simulator/test-profile.jpeg)
- [로그아웃 지연](./2026-09-09-app-review-simulator/logout-stuck.jpeg)
- [로그아웃 지연 후 재실행 차단](./2026-09-09-app-review-simulator/post-logout-relaunch.jpeg)

## 수정 전 발견한 차단 문제 — 이력

재현 순서:

1. 신규 이메일 계정 가입 후 캘린더 연결과 사용법을 건너뛴다.
2. 제목만 있는 개인 일정을 생성한다.
3. 제목을 변경하고 종일 일정으로 수정해 저장한다.
4. 앱을 종료·재실행한다. 이때까지 로그인과 일정은 정상 유지된다.
5. 프로필 → 로그아웃 → 확인을 누른다.
6. ‘로그아웃 중’ 상태가 3분 이상 유지된다.
7. 앱을 종료·재실행하면 ‘로그인 상태를 확인하고 있어요’에서 진행되지 않는다.

확인한 사실과 원인 후보를 구분한다:

- 화면 정지는 실제 서명된 Release 시뮬레이터 앱에서 관찰했다. 프로세스 크래시가 아니라 대기 상태다.
- `AuthContext.signOut`은 로컬 계정 정리 → 서버 logout → `clearAuthTokens()`를 수행한다.
- `clearAuthTokens()`의 invalidation listener는 다시 `clearAccountScopedLocalData()`를 기다린다.
- Live Activity 정리는 인증이 필요한 서버 토큰 폐기 API를 호출한다. 이 요청이 401로 이어지고 refresh도 실패하면 API 코드가 다시 `clearAuthTokens()`를 호출할 수 있다.
- `liveActivitySyncCoordinator.clearForAccount()`는 이미 진행 중인 `cleanupFlight`를 반환한다. 위 경로가 실행되면 정리 작업이 자기 자신의 완료를 간접적으로 기다릴 가능성이 있다.
- 최초 화면 검증에서는 **유력한 원인 후보**로 기록했다. 아래 추가 진단에서 실제 JS 모듈을 연결해 이 순환 대기가 존재함을 재현했다. 다만 이미 실행한 시뮬레이터의 HTTP 기록을 직접 확보한 것은 아니다.
- 최초 진단 시에는 앱 코드 수정 없이 증거만 기록했다. 이후 사용자 승인에 따라 위 수정을 적용하고 재검증했다.

## 수정 전 추가 원인 진단 — 실제 JS 모듈 연결 재현 이력

`logout-cleanup.diagnostic.ts`에서 실제 `apiClient` 인터셉터, `authStorage`, Live Activity coordinator, 회원 logout API 함수를 연결했다. 저장소·네이티브와 HTTP 응답만 로컬 가짜 구현으로 대체했다. 실제 서버 요청이나 사용자 데이터 변경 없이 실행했고, ActivityKit 미지원·활성 Activity 0개 조건에서도 재현됐다.

AuthContext의 관련 순서인 ‘계정 정리 → 서버 logout → 인증 정보 삭제 → invalidation listener의 계정 정리’를 구성했다. 다른 로컬 정리 단계와 React UI는 제외한 좁은 통합 진단이다.

| 비교 조건 | 결과 |
| --- | --- |
| logout 후에도 인증을 허용하는 대조군 | 정리 완료, 로컬 access token 삭제 |
| logout 후 토큰 폐기 API와 refresh가 모두 401을 반환 | 정리 Promise가 완료되지 않음, 로컬 access token 삭제까지 도달하지 못함 |

실제 관측 호출 순서:

```text
최초 Live Activity 토큰 폐기 200 → 네이티브 종료 완료
→ 서버 logout 200
→ 인증 정리 listener 진입
→ Live Activity 토큰 폐기 401
→ refresh 401
→ 인증 정리 listener 재진입
→ 기존 cleanupFlight를 다시 기다림 (완료되지 않음)
```

네트워크 가짜 구현은 즉시 응답하며 네이티브 정리도 즉시 완료한다. 따라서 이 진단의 대기는 iOS 부팅이나 실제 네트워크 지연이 아니라 JS 정리 로직 사이의 순환 대기다. 로컬 BE의 `compareAndLogout` 또한 정상 logout에서 세션 generation을 바꾸고 refresh token을 폐기하므로 테스트 조건은 서버의 인증 폐기 계약과 부합한다. 운영 실행 시점의 정확한 응답 경로는 별도 로그로 확인하지 않았다.

- 관련 기존 테스트 3개 스위트 / **42개 통과**: accountCleanup, authStorageKeychain, liveActivitySync. 각각 상대 모듈을 모킹해 이 교차 호출을 잡지 못했다.
- 진단 테스트 **2개 시나리오 확인**: 대조군 완료, 결함 조건 미완료. 여기서 PASS는 결함을 재현했다는 뜻이지 앱 문제가 해결됐다는 뜻이 아니다.
- 실행: `npm test -- --runInBand --no-watchman --testRegex 'logout-cleanup\.diagnostic\.ts$'`
- 당시 진단 파일은 기본 `*.test.ts` 테스트 대상에서 제외했다. 수정 후에는 `__tests__/logoutCleanupIntegration.test.ts`로 완료를 기대하는 정식 회귀 테스트를 추가했고, 진단 파일은 해당 회귀 테스트를 실행하는 호환 진입점으로 변경했다. 위 미완료 trace는 수정 전 기록이다.

수정 검토 지점은 `AuthContext.tsx:220`의 logout 전 정리, `AuthContext.tsx:229`의 중복 정리 진입, `api.ts:84`의 refresh 실패 시 인증 정리 재진입, `liveActivitySyncCoordinator.ts:714`의 기존 cleanupFlight 재사용이다. 서버 인증 폐기 전후의 정리 단계를 구분하고, 만료·폐기된 인증 상태에서도 같은 정리 작업으로 재진입하지 않도록 해야 한다. 알림·위젯·Live Activity 정리 자체를 생략하는 우회는 검증된 해결책이 아니다.

## 다음 검증

사용자가 계정 생성을 승인해 운영 서버에 일회용 계정 `nolate.sim.qa.20260909.1657@example.com` / ReviewQA / #292를 생성했고, 테스트 일정 `QA 심사 검증 수정완료` 1건을 저장했다. 이후 사용자가 직접 탈퇴를 실행했다. 사후 UI 검증에서 기존 자격 증명의 로그인 거절과 재실행 상태를 확인했으나, 서버 DB에서 계정·일정 원본이 물리적으로 삭제됐는지는 별도 조회하지 않았다. 비밀번호는 보고서에 기록하지 않는다. 기존 사용자 계정과 데이터는 수정·삭제하지 않았다.

로그아웃·재실행 차단 수정, 정상 재로그인, 사용자 탈퇴 실행 후 로그인 거절·재실행 검증은 완료했다. 메인 앱과 확장 빌드 번호 55 통일 및 배포 설정 재검사도 완료했다. 실제 광고·외부 SNS 로그인·APNs와 App Store 업로드 바이너리의 동일성은 별도 확인 대상이다. 이번 수정본은 커밋·푸시·App Store 업로드·심사 제출하지 않았다.
