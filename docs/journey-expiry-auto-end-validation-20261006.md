# 서버 만료 → 자동 APNs END 검증

기준: 2026-10-06, FE·BE `feature/transit-guidance-v1` 미커밋 작업. [서버 TTL](journey-server-expiry-validation-20261006.md)의 후속 P2-3d3c **시험 sender 첫 slice**다. 운영 durable sender 완료 기록이 아니다.

2026-10-07 후속 [영속 소유권·실제 서버 재시작 검증](journey-durable-end-validation-20261007.md)에서 main-source durable dispatcher/file DB 복원과 실제 APNs END를 확인했다. 아래 메모리 sender 제약과 수치는 당시 결과로 보존한다.

## 구현·활성화 경계

- 변경은 BE test-source `JourneyGuidanceApnsPilot`, `AutomaticJourneyAuthenticatedHarness`, 회귀 검사에 한정한다. 운영 `AutomaticJourneyExpiry`에는 원격 END 연결을 추가하지 않았다. 기존 departure 위젯과 journey Activity의 wire format도 합치지 않았다.
- `NOLATE_JOURNEY_TEST_EXPIRY_END=1`일 때만 loopback harness의 1초 timer가 기존 세션 만료 worker 후 pinned lane을 검사한다. 미지정은 OFF다. `NOLATE_JOURNEY_TEST_SHORT_TTL=1`은 격리 SIMULATOR의 60초 실시간 시험에만 사용했다. 기존 실제 APNs 단일 설치 allowlist와 명시 provider opt-in을 유지했다.
- 클라이언트 시계나 `expiresAt`만으로 END를 결정하지 않는다. 정확한 소유권/login generation/binding의 read-only reconcile이 **저장된 EXPIRED·유효 endedAt**을 반환한 lane만 처리한다. historical 세션 정리로 새 세션을 중지하지 않는다.
- 자동 END는 `stop()`을 호출하지 않는다. 서버 EXPIRED·원래 endedAt·출발 receipt를 보존하며 원격 terminal 상태도 EXPIRED다. 정밀 마커·도착정보를 제거하고 과거 observedAt을 새 GPS처럼 바꾸지 않는다.
- 같은 벽시계 초는 다음 tick으로 미룬다. 미래 timestamp를 만들지 않는다. END는 provider I/O 전에 lane에 예약한다. 성공 뒤 반복 tick은 추가 전송하지 않고 UPDATE도 재활성화하지 못한다.
- 인증/terminal 검증 실패는 고정 오류 코드로 차단한다. provider 확정 거절·수락 여부 불확실 실패도 예약을 유지하고 timer가 무조건 반복하지 않는다. safe counter로 accepted/blocked/failed/unknown을 구분한다. 이는 durable retry/outbox의 대체물이 아니다.
- 메모리 lane은 최대 16개로 제한한다. Activity/FCM token은 출력하지 않는다. 서버 재시작 시 lane이 없어지는 제약은 그대로다.

시험 설치에서는 ON, source/운영 기본은 OFF다. `.env`, 운영 서버/DB, Firebase/Apple 콘솔·키 설정은 수정하지 않았다. FE/native 변경·재빌드 없이 기존 signed DEBUG simulator 바이너리의 opt-in을 확인해 사용했다.

## 독립 시뮬레이터 E2E

대상: `NoLate Journey P0 Isolated 20261004`, iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`. `deviceWindow-AppWindow-8`과 `Show in Device Hub`를 확인한 detached 독립 창만 조작했다. Computer Use skill의 창 확인·fresh AX 절차를 적용했다. embedded Device Hub/실기기/다른 simulator는 조작하지 않았다.

합성 JWT·일정·전체 저장 경로·도착정보·메모리 repository를 사용했다. 외부 전송만 기존 사용자 승인 단일 Firebase 시험 설치에 실제 발송했다. GPS replay는 CoreSimulator→CoreLocation 입력이며 phase/출발 강제 입력이 아니다. 수동 END 스크립트·UI stop·fixture reset·시계 점프 없이 실제 시간을 기다렸다.

| 시험 구간 | 관측 |
| --- | --- |
| 첫 세션 | ARMED 출발 0→GPS ACTIVE/ACK. 잠금 카드 존재→앱 terminate/GPS clear. 서버 ACTIVE/인증 요청 17에서 이후 EXPIRED·만료 1·자동 END 수락 1·provider 총 수락 6, 인증 요청은 17 불변. 사용자가 재진입하기 전 카드 없음 |
| 첫 재진입 | 정확한 terminal 조회 뒤 `종료 확인 · 자동 정리 완료`, native IDLE·오류 없음·큐 0·provider OFF. GPS/출발 자동 재개 없음 |
| 두 번째 세션 | 같은 설치 지문을 재확인하고 provider 재선택. GPS ACTIVE/ACK·provider 수락. 앱 terminate 뒤 **카드가 남아 있음**과 app service 부재를 함께 확인. 서버 ACTIVE/만료 1/END 1/provider 수락 10/인증 요청 29 |
| 두 번째 자연 만료 | 사용자 재진입 없이 EXPIRED·만료 2·자동 END 2·provider 수락 11/실패 0, 인증 요청 29 불변. 독립 잠금 카드 제거 확인. 후속 timer에서도 수락/END 계수 불변 |
| 두 번째 재진입 | 버튼 없이 자동 정리, IDLE·큐 0·provider OFF. 세 번째 새 ARMED 준비/출발 0→즉시 정상 UI 종료. STOPPED·큐 0·최종 잠금 카드 없음 |

**프로세스 관측 제한:** 두 시험 모두 terminate 직후 앱 service 부재를 확인했지만, END 이후에는 새 앱 PID가 관측됐다. 사용자가 앱을 열거나 restore/stop을 누르지 않았고 인증 요청·HTTP reconciliation 계수는 원격 종료 동안 늘지 않았다. 따라서 “앱 종료 후 사용자 재진입 없이 서버 timer END와 카드 제거”는 확인했으나, 전체 대기 동안 OS가 앱 프로세스를 한 번도 생성하지 않았다는 주장은 하지 않는다. 재생성 원인을 직접 추적한 것은 아니며 실기기 OS wake 동작은 별도 검사다.

최종 안전 계수: `prepare=3/departure=2/activation=2/cancel=2/expiryCount=2/reconciliationRequests=2/authenticatedRequests=34`, provider `attempts=11/accepted=11/rejected=0/END=2/automaticEND=2`, 자동 blocked/failed/unknown 각각 0, trap=0/Authorization=false. 두 GPS 세션에서 출발 각각 1회였으며 세 번째 세션은 출발하지 않았다.

첫 UPDATE들 전부의 개별 OS 수신을 주장하지 않는다. provider receipt와 육안 END 제거를 별도 기록했다. read-only readiness는 `OBSERVED_EXPECTATION_MET`이며 `apnsDelivery/productionNavigation=UNVERIFIED` 표기를 유지했다. native 로컬 초기 START와 UI 정상 종료는 원격-only 제거 증거와 구분한다.

### 화면 증거

- [첫 잠금 카드](evidence/journey-expiry-auto-end-20261006/04-lock-card-before-expiry.png)
- [첫 자동 END 뒤 카드 없음](evidence/journey-expiry-auto-end-20261006/05-first-auto-end-lock-card-removed.png)
- [첫 재진입 자동 정리](evidence/journey-expiry-auto-end-20261006/06-first-expired-auto-cleared.png)
- [두 번째 앱 종료 직후 카드 유지](evidence/journey-expiry-auto-end-20261006/08-second-lock-after-app-terminate.png)
- [두 번째 자동 END 후 카드 제거 확정](evidence/journey-expiry-auto-end-20261006/10-second-auto-end-lock-card-removed-confirmed.png)
- [두 번째 재진입 자동 정리](evidence/journey-expiry-auto-end-20261006/11-second-expired-auto-cleared.png)
- [세 번째 ARMED/provider OFF](evidence/journey-expiry-auto-end-20261006/12-third-new-armed-provider-off.png)
- [최종 STOPPED/큐 0](evidence/journey-expiry-auto-end-20261006/13-final-stop-queue-zero.png)
- [최종 잠금 카드 없음](evidence/journey-expiry-auto-end-20261006/14-final-lock-no-card.png)

중간 캡처 `07-second-gps-active`는 아직 ARMED/TOKEN_WAITING이며, `09-second-auto-end-lock-card-removed`는 만료 전 카드 유지 화면이다. 파일명의 기대값을 실제 결과로 사용하지 않았다. 확정된 제거 증거는 10번이다.

## 자동 검사

- BE automatic/Firebase: 12 suites / **84 tests PASS**. 새 자동 END 검사 7개: 저장 terminal 요구, lane 없음, 모호한 수락·확정 거절의 반복 차단, 인증 회수/잘못된 종료시각, historical 세션과 새 generation 격리, 같은 초 지연. 기존 수동 END/만료/H2 회귀도 통과했다.
- FE 전체 Jest: **295 suites / 2,697 tests PASS**, TypeScript PASS.
- Swift: **269 tests PASS**. Node QA: **15 tests PASS**.
- 메모리 sender 재구성 후 token이 없으면 전송하지 않는 검사는 restart recovery 성공이 아니다. MySQL/process restart 통합 검사도 아니다.
- 기존 Metro 임시 dependency 경로의 알림/Keychain 동적 import warning이 관측됐다. 합성 인증 성공을 실제 로그인·일반 푸시 성공으로 승격하지 않는다.
- 최종 GPS clear, PID와 cwd를 확인한 이번 Metro/loopback 시험 서버만 종료했다. 앱 데이터/다른 기기/미커밋 작업은 보존했고 커밋·푸시하지 않았다.

## 다음 게이트

1. 운영 DB의 Activity token 소유권·login/route/token epoch, 만료 terminal outbox를 영속화하고 프로세스 재시작 후 복원한다. 기존 departure 위젯 sender와 journey 계약을 분리한다.
2. token 회전·확정 무효 token·모호한 provider 수락·worker 경쟁·망 지연 역전의 durable 정책 및 운영 부하를 검증한다. 실패를 앱 재활성화나 무조건 재전송으로 숨기지 않는다.
3. 오프라인 stale fallback, 새 로그인 세대/삭제 일정 회수, 실제 로그인 진입·장시간 안내 수명, 실기기 wake/강제 종료/잠금·VoiceOver를 검사한다.
4. 실제 공급자/지도·탑승 후 버스 완주·한 정류장 전 하차·지하철/환승·음성/무음은 별도 기능 단계다. 현재 첫 도보/정류장 접근·대기만 지원한다.
