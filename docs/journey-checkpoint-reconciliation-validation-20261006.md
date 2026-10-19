# 재시작 후 종료 안내 기록 자동 정리 검증

기준: 2026-10-06, FE·BE `feature/transit-guidance-v1`의 미커밋 작업. [이전 실제 END 검증](journey-apns-end-validation-20261006.md)에서 남았던 checkpoint 수동 재검증 UX를 후속 수정했다. 운영 전체 완료 기록은 아니다.

## 구현한 동작

- 인증 준비 기록이 남은 개발 iOS 앱은 로그인 준비 완료 뒤 cold 진입/foreground 복귀에 서버 상태를 조회한다. 내부 합성 인증 화면에도 같은 coordinator를 연결했다. 진행 중인 native 세션은 건드리지 않는다.
- 서버 `POST /api/schedules/{scheduleId}/automatic-journey/{sessionId}/reconcile`는 상태만 반환한다. 계정·로그인 세대·본인 일정 접근·session/generation/revision/owner/digest·execution gate를 검증한다. 서버 세션을 종료하거나 만료시키지 않고, 복구 lease도 발급하지 않는다.
- `ARMED/ACTIVE`면 기록을 보존한다. 위치 입력/Activity를 자동 복구하지 않는다. 기존 복구에는 별도의 적격성·동의·서버 validate가 필요하다.
- 정확한 소유 기록의 `STOPPED/EXPIRED`와 유효한 checkedAt/endedAt을 받으면 native가 동일 checkpoint인지 비교한 뒤 회수하고, 성공한 경우에만 JS binding을 지운다. 다른 세션·세대·현재 실행 중인 안내를 정리하지 않는다.
- 서버 연결 실패는 `서버 연결 대기 · 기록 보존`으로 남긴다. 앱이 foreground일 때 5초 간격으로 재시도한다. 401/404·다른 로그인·잘못된 receipt는 종료 근거로 취급하지 않고 보존/차단한다. background JS 실행은 보장하지 않는다.
- 영속 stop outbox를 먼저 읽고 처리한다. 미전송 종료/저장 오류가 남으면 정리를 보류한다. 동시 호출은 합쳐 처리하고 logout/stop/새 binding과 늦은 응답의 경쟁을 차단한다. native 회수 뒤 JS 삭제 실패도 재시도할 수 있도록 JS 근거를 남긴다.
- 내부 시험 화면에 `남은 기록 없음 / 서버 확인 중 / 기록 보존 / 종료 확인 · 자동 정리 완료 / 서버 연결 대기 / 확인 불가`를 표시한다. 종료 정리를 위해 복구 버튼을 누를 필요가 없어졌다.

## 독립 시뮬레이터 E2E

대상은 `NoLate Journey P0 Isolated 20261004`, iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`이다. detached `deviceWindow-AppWindow-8`와 `Show in Device Hub` toolbar로 확인한 독립 창만 조작했다. embedded Device Hub·실기기·다른 시뮬레이터는 조작하지 않았다.

합성 JWT·일정·경로·도착정보와 분리된 loopback 시험 서버를 사용했다. 이동은 CoreSimulator 위치 replay→CoreLocation 입력이다. 단계 버튼으로 ACTIVE를 주입하지 않았다. 외부 전송은 승인된 Firebase 프로젝트의 기존 단일 설치 SHA-256 allowlist에 한정하고 로컬 Activity UPDATE를 차단했다. 실제 운영 로그인/일정/교통 데이터 시험은 아니다.

| 순서 | 확인 결과 |
| --- | --- |
| 최초 진입·준비 | checkpoint 없음. ARMED의 출발 0회 |
| GPS 이동 | ACTIVE/ACK·출발 1회. 실제 provider 전송 수락 |
| 앱 종료 뒤 cold 진입, 서버 ACTIVE | 상태 조회 1회, native IDLE·기록 보존. 복구 버튼 미사용, 추적/Activity 재생성·추가 출발 없음 |
| 앱 미실행 원격 END | 앱을 다시 열기 전에 END 수락 및 독립 잠금 카드 제거 확인 |
| reconcile 503 후 재시작 | 서버 STOPPED지만 조회 실패이므로 기록 보존. 동의/적격성 확인 후에도 새 준비 차단. 복구 버튼 미사용 |
| 조회 503 해제, foreground 유지 | 앱 버튼·재시작 없이 재시도로 `종료 확인 · 자동 정리 완료`. 새 준비 가능, 복구 버튼 비활성 |
| 정리 뒤 새 준비 | 두 번째 세션 ARMED·출발 0회·provider OFF. 이전 provider opt-in/추적을 묵시적으로 재사용하지 않음 |
| 두 번째 세션 UI 종료 | STOPPED·종료 큐 0·오류 없음. 최종 독립 잠금 화면 카드 없음 |

503은 test-source의 고정 상태 조회 장애 주입이다. 비행기 모드/OS 전체 네트워크 단절 시험으로 표현하지 않는다. 시험 중 서버/fixture를 reset하지 않았다.

최종 안전 계수:

~~~json
{"state":"STOPPED","reconciliationRequests":10,"prepareCount":2,"departureCount":1,"activationCount":1,"cancelCount":1,"guidancePushAcceptedCount":6,"guidancePushProviderAttemptCount":6,"guidancePushProviderRejectedCount":0,"guidancePushEndAcceptedCount":1,"trapRequests":0,"trapAuthorizationSeen":false}
~~~

`cancelCount`는 출발 알림 취소 계수다. 실제 provider 수락 6건 전부의 OS 개별 수신을 주장하지 않는다. `journey-readiness-check.mjs --expect-stopped`는 `OBSERVED_EXPECTATION_MET`이고, 자동 판정의 `apnsDelivery=UNVERIFIED`, `productionNavigation=UNVERIFIED`는 유지했다. END 시각 수신은 별도 육안 증거다.

### 화면 증거

- [최초 기록 없음](evidence/journey-checkpoint-reconciliation-20261006/01-initial-no-checkpoint.png)
- [GPS ACTIVE/ACK](evidence/journey-checkpoint-reconciliation-20261006/03-gps-active-ack.png)
- [재시작 후 진행 중 기록 보존](evidence/journey-checkpoint-reconciliation-20261006/05-restart-current-record-preserved.png)
- [앱 미실행 END 전 카드](evidence/journey-checkpoint-reconciliation-20261006/06-app-not-running-before-end.png)
- [원격 END 뒤 잠금 카드 제거](evidence/journey-checkpoint-reconciliation-20261006/07-remote-end-card-removed.png)
- [조회 503·기록 보존·새 준비 차단](evidence/journey-checkpoint-reconciliation-20261006/09-503-checkpoint-retained-new-prepare-disabled.png)
- [서버 회복 후 버튼 없이 자동 정리](evidence/journey-checkpoint-reconciliation-20261006/10-server-recovered-auto-cleanup.png)
- [정리 뒤 새 세션 준비](evidence/journey-checkpoint-reconciliation-20261006/11-new-prepare-after-auto-cleanup.png)
- [최종 종료 큐 0](evidence/journey-checkpoint-reconciliation-20261006/12-final-stop-queue-zero.png)
- [최종 잠금 카드 없음](evidence/journey-checkpoint-reconciliation-20261006/13-final-lock-no-card.png)

## 자동 검사·빌드

- FE 전체 Jest: 295 suites / 2,697 tests PASS. TypeScript PASS. 변경한 7개 TS/TSX 파일 범위 ESLint PASS(전체 프로젝트 lint 성공 주장은 아님).
- Swift 순수 검사: 269 tests PASS. scoped terminal 회수·다른 checkpoint/live session 보호 추가.
- BE automatic 패키지 및 Firebase client: 11 suites / 70 tests PASS. 새 상태 조회 6개는 기본 OFF·인증·identity fence·terminal 메타데이터·조회 부작용 없음·expired ARMED 보존을 검사한다.
- Node QA: END 5 + GPS 7 + readiness 3 = 15 tests PASS.
- 앱/위젯 ad-hoc signed simulator build PASS. 시험 바이너리에만 opt-in을 넣어 설치했고 source Info.plist는 기존 default-off로 복원했다.
- FE 회귀에 상태 조회의 single-flight, ACTIVE/ARMED 보존, 장애/회복, receipt 불일치, logout/새 로그인/늦은 응답, native 회수 거절, JS 삭제 실패 후 재시도, UI mount/foreground 연결을 포함했다.
- `.env`·인증 키 원문·Apple/Firebase 콘솔은 변경하지 않았다. 커밋/푸시 없음. 시험 종료 후 대상 GPS를 clear하고 PID/작업 디렉터리를 확인한 이번 Metro·시험 서버만 종료했다.

## 아직 열린 게이트·다음 실기기 확인법

1. 이번 자동 정리는 **동일 계정·로그인 세대·origin의 인증 binding + 확인 가능한 terminal receipt** 범위다. 새 로그인 세대/삭제된 일정/없는 서버 row는 임의 종료로 간주하지 않는다. 운영 소유권 이전과 안전한 회수 정책이 필요하다.
2. ACTIVE TTL 처리·운영 durable token 소유권/회전·terminal outbox·서버 재시작은 별도 구현이다. `/reconcile`는 이 문제를 조회 부작용으로 해결하지 않는다.
3. 실기기에서는 실제 로그인 완료 뒤 활성 기록 cold 진입→GPS 미재개·출발 중복 없음, 원격 END→잠금 카드 제거→cold 진입 자동 정리를 각각 확인한다. 내부 합성 인증 화면 E2E와 실제 로그인 root 진입은 구분한다.
4. 연결 단절 후 cold 진입은 기록 보존·새 준비 차단이어야 한다. foreground 복귀/연결 회복 뒤 정확한 terminal receipt로만 자동 정리되는지 확인한다. 집중 모드/잠금 Keychain/네트워크 제한도 실제 기기에서 별도 확인한다.
5. 다른 계정/새 로그인으로 바꾼 뒤 기존 기록을 정리하거나 추적을 복구하지 않아야 한다. 인증 mismatch·401/404·오염 receipt는 보존/차단으로 확인한다. 원문 token/GPS를 수집하지 않고 고정 진단 코드와 queue/state만 기록한다.
6. 오프라인 widget stale fallback·전체 VoiceOver/최대 글자·실제 일정/지도/공급자, 탑승 이후 버스 완주·하차 한 정류장 전·지하철/환승·음성/무음·배터리/현장 검증은 미완료다.

상세 절차는 [실기기 검증 런북](journey-device-validation-runbook.md), 단계 구분은 [로드맵](journey-guidance-roadmap.md)을 따른다.
