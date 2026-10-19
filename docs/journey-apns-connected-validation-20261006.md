# 실제 APNs 연결·독립 시뮬레이터 검증 — 2026-10-06

판정: **연결/진단 구현 및 GPS·종료 E2E 확인. 실제 원격 UPDATE 수신 게이트는 실패/미검증.**
이 문서는 키 수정 전의 실패 이력이다. 사용자 설정 완료 후 실제 전송 24회 수락 및 잠금 중 접근→대기 안내 수신을 확인했다. 현재 결과는 [Sandbox 키 수정 후 재검증](journey-apns-sandbox-validation-20261006.md)을 따른다. 위치 만료 표시와 원격 END는 여전히 미완료다.
FE·BE `feature/transit-guidance-v1`의 기존 dirty 작업 위에서 수행했다. 이번 작업을 커밋·푸시하지 않았다.

## 범위와 격리

- 사용자 승인으로 기존 개발·운영 겸용 Firebase `nolate-cbdf2`를 사용했다. 서버 서비스 계정은 원래 BE 외부 경로에서만 읽었다. FE에 키를 복사하지 않았으며 콘솔/키/운영 DB·일정/다른 설치는 변경하지 않았다.
- 실제 FCM/APNs 대상은 명시적으로 선택한 시험 설치의 SHA-256 allowlist 한 개뿐이다. raw FCM/APNs/Activity token·JWT·자격증명은 화면/문서에 남기지 않았다.
- `NoLate Journey P0 Isolated 20261004`, iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`. Computer Use로 detached 창 `deviceWindow-AppWindow-8`과 `Show in Device Hub`를 확인하고 **그 독립 창만** 조작했다. Device Hub embedded 화면·실기기는 사용하지 않았다.
- `authenticatedJourneyApnsHarness` loopback 15544 + trap 15545, dotenv 비활성 Metro 8088. 실제 provider만 외부 호출이며 일정/JWT/도착정보는 합성이다. 실제 로그인/교통 노선 완주가 아니다.
- 시험 opt-in은 설치용 Debug 빌드에만 적용하고 소스 Info.plist는 원상 복원했다. 운영 기본 OFF, DEBUG·SIMULATOR·10분 제한은 유지한다.

## 구현·수정

1. 시험 설치 등록 helper: DEBUG iOS simulator/project 검사 → 실제 APNs token 확인 → sandbox SDK 매핑 → FCM token/SHA-256. 각 단계 12초 timeout, 고정 오류 코드, 원문 노출 금지. 별도 등록 버튼은 시험 도구이며 이동 단계 버튼이 아니다.
2. native 출발 receipt ACK 뒤에만 원격 UPDATE 발행. 확정 HTTP 거절 이후 같은 epoch의 추가 GPS 진행/새 timestamp로 반복 발송하지 않는다. 새 명시 시험/token epoch로만 재시도한다.
3. 서버의 도착정보 검증이 native의 120초 source TTL을 30초 세션 lease와 혼동해 `ARRIVAL_REJECTED`를 내던 문제를 수정했다. 전체 content의 GPS 15초/세션 lease fence는 유지한다. 120초 허용·121초 거절 회귀 검사를 추가했다.
4. 실제 시도/실패 수와 고정 원인 코드 추가. provider 예외/본문/token은 반환하지 않는다. 모호한 실패도 실패 카운터에 포함되며 같은 timestamp blind retry는 차단한다.
5. isolated sender에 `com.anonymous.nolatefe.push-type.liveactivity` topic을 명시했다. 공용 Firebase client 기본 topic 정책은 변경하지 않았다.
6. 시험 Metro의 Watchman socket 실패 때문에 explicit `NOLATE_QA_NO_WATCHMAN=1` 옵션을 추가했다. 기본 Metro 설정이나 사용자의 전역 Watchman 설정은 변경하지 않았다. Pod 정렬 및 앱/위젯 실제 빌드를 수행했다.

## 실제 실행 결과

| 검사 | 관측·판정 |
| --- | --- |
| APNs/FCM 설치 등록 | genuine 일반 APNs token 및 FCM token 확보, 설치 지문 확인. Activity update token은 이후 별도 발급 |
| 위치 출발 | CoreSimulator GPS `marker-walk`만 주입. ARMED→ACTIVE, 출발 1회·ACKNOWLEDGED. 단계 강제 변경 없음 |
| 수정 전 | 도착정보 계약 오류로 provider 도달 전 거절. TTL 수정 뒤 실제 provider에서 환경 불일치 발생 |
| 반복 발송 보호 전/후 | 초기 버전은 거절 5회. 보호 추가 후 같은 시험 세션 1회로 유지. GPS 계속 이동해도 추가 발송하지 않음 |
| 최종 명시 topic 서버 | 새 세션 2개 각각 1회: attempts=2, failed=2, accepted=0. 두 번째는 실제 APNs sandbox 매핑을 명시한 후 시험 |
| 실제 오류 | `APNS_ENVIRONMENT_MISMATCH` — Firebase 예외 원인의 `BadEnvironmentKeyInToken`. 특정 콘솔 키가 원인이라는 확정은 아님 |
| 잠금 화면 | 로컬 최초 생성 카드 “합성 정류장 1까지·도보 약 60m”와 경로 바 관측. 원격 전용 시험은 로컬 UPDATE를 꺼서 이 캡처를 원격 전달 성공으로 인정하지 않음 |
| 만료 표시 | 앱이 위치 확인 중으로 바뀐 뒤 잠금 카드가 초기 문구/마커를 유지한 것을 관측. OS stale 표시 전환은 통과하지 못했으며 후속 재검증 필요 |
| 종료 | 앱 STOPPED·종료 큐 0, 서버 STOPPED, 잠금 카드 제거 확인. **로컬 종료이며 실제 원격 END 수신 증거가 아님** |
| 최종 서버 카운터 | prepare=2/departure=2/activation=2/cancel=2, trapRequests=0, trapAuthorizationSeen=false. 중간 reset 없이 확인 |

전송 오류를 보기 위해 임의 Activity token·`simctl push`·로컬 UPDATE를 실제 APNs 증거로 대체하지 않았다. SDK sandbox 매핑과 명시 topic 후에도 실패했으므로 Firebase Apple 앱 환경·team/key/bundle 매핑을 확인해야 한다. [점검 절차](journey-device-validation-runbook.md#31-실제-관측된-환경-불일치-점검).

## 자동 검사

- FE Jest: **295 suites / 2,673 tests PASS**. 설치 helper 18개 포함.
- Swift 순수 정책: **264 tests PASS**. 확정 거절 후 추가 publish 차단 포함.
- BE 대상 계약: **11 tests PASS**, APNs pilot 8개 + Firebase message 3개. TTL 경계·환경/일반 token 오류 분류·비밀정보 비노출·기본/명시 topic 포함.
- TypeScript `tsc --noEmit`: PASS.
- 변경 TS/TSX 대상 lint: PASS. 전체 `expo lint`는 0 errors / 154 warnings이며 전체 무경고를 주장하지 않는다.
- 앱/위젯 실제 Xcode build: BUILD SUCCEEDED, 새 binary를 같은 독립 simulator에 설치했다.
- FE·BE `git diff --check`: PASS.

테스트 로그는 `/private/tmp/nolate-apns-next-*`에 한정했다. 전체 provider 로그·설정·환경 파일을 문서에 덤프하지 않았다.

## 독립 창 증거

- [실제 provider 거절](evidence/journey-apns-connected-20261006/02-actual-provider-rejected.png)
- [sandbox 매핑 이후 거절](evidence/journey-apns-connected-20261006/05-sandbox-mapping-provider-rejected.png)
- [잠금 로컬 최초 카드 — 원격 수신 아님](evidence/journey-apns-connected-20261006/06-sandbox-lock-local-only.png)
- [최종 STOPPED·종료 큐 0](evidence/journey-apns-connected-20261006/07-final-stopped-zero-outbox.png)
- [종료 후 잠금 카드 없음](evidence/journey-apns-connected-20261006/08-final-lock-no-guidance-card.png)

## 남은 게이트·정리

실제 원격 UPDATE의 구분 가능한 새 내용 수신·원격 END·token 회전/전달 지연/역전은 미검증이다. remote-only 무수신·거절 상태의 stale 표시도 남았다. 전체 접근성/VoiceOver, JS 중단·다른 로그인 세대 종료 재조정, ACTIVE 서버 TTL, 실제 본인 일정·지도·교통 공급자, 버스 승차 후 진행·하차/환승·음성은 완료 처리하지 않는다.

시험 종료·서버 STOPPED·큐 0·잠금 카드 제거를 확인한 후 synthetic GPS를 clear하고 이번에 띄운 서버/Metro만 종료했다. 다른 시뮬레이터·실기기·기존 미커밋 변경은 보존했다.

관련 공식 계약: [Apple ActivityKit push](https://developer.apple.com/documentation/ActivityKit/starting-and-updating-live-activities-with-activitykit-push-notifications), [Firebase Live Activity](https://firebase.google.com/docs/cloud-messaging/customize-messages/live-activity), [Firebase Apple client](https://firebase.google.com/docs/cloud-messaging/ios/get-started). 공식 문서는 환경 요구사항 근거이며 이 시험의 수신 성공 증거가 아니다.
