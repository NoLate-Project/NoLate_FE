# 서버 자동 안내 TTL 검증

기준: 2026-10-06, FE·BE `feature/transit-guidance-v1` 미커밋 작업. [종료 기록 자동 정리](journey-checkpoint-reconciliation-validation-20261006.md)의 다음 slice다. 운영 전체 내비게이션 완료 기록이 아니다.

## 시험 ON과 운영 기본 OFF

테스트 대상에서는 ON이어야 한다. 기존/이번 E2E의 설치 바이너리는 diagnostics/authenticated opt-in이 true이고, loopback 서버도 필요한 gate를 명시적으로 켠다. 운영 source의 기본 OFF는 배포한 모든 사용자에게 자동으로 활성화하지 않는다는 의미다. `.env`·운영 서버 설정·콘솔을 바꾸지 않았다.

| 경계 | 시험 범위 | 일반 배포 상태 |
| --- | --- | --- |
| FE | `__DEV__` + iOS | Release는 이 시험 bridge 진입 불가 |
| native | 기존 signed simulator 바이너리의 diagnostics/authenticated true 확인 | source Info.plist는 기존 default-off, DEBUG/simulator 경계 유지 |
| 서버 | 합성 인증 loopback harness, guidance/automatic/expiry 명시 true | `journey.guidance.enabled`, `journey.automatic.enabled`, `journey.automatic.expiry-enabled` 기본 false |
| 짧은 TTL | `NOLATE_JOURNEY_TEST_SHORT_TTL=1` 시험 harness → 격리 SIMULATOR 60초 | 기본 600초. DEVICE에는 짧은 TTL 적용 안 됨 |

플래그만 켜도 실기기/운영 로그인/실제 대중교통 전체 지원이 되는 구조는 아니다. 현재 10분은 자동 출발 파일럿 수명이며, 장시간 실제 안내를 위한 세션 연장/종료 정책은 별도 확정이 필요하다.

## 구현

- 서버 `AutomaticJourneyExpiry`가 기본 10초 간격으로 시간이 지난 ARMED/ACTIVE만 EXPIRED로 바꾼다. 세 gate가 모두 true일 때만 실행한다. JS·GPS·refresh·상태 조회 요청에 의존하지 않는다.
- 현재 수명을 늘리지 않는다. `expiresAt <= now` 경계에서 endedAt을 기록하고 accepted departure event/sequence/발생시각은 보존한다. STOPPED/EXPIRED의 기존 종료시각은 worker가 덮어쓰지 않는다.
- 하나의 조건부 DB UPDATE에 version 증가를 포함한다. 만료 전 객체를 가진 stale writer의 save가 거절돼 EXPIRED를 ACTIVE로 되돌리지 못한다. 출발 부작용은 기존 transaction과 optimistic conflict로 함께 보호한다.
- 기존 domain `expire()`도 ACTIVE 만료를 지원해 새 준비/current의 lazy expiry와 정책을 맞췄다. `/reconcile`는 여전히 조회만 수행한다. 별도 worker/쓰기 없이 클라이언트 시계로 종료를 추정하지 않는다.
- 합성 APNs lane의 명시 END는 정확한 기존 binding의 EXPIRED도 정리할 수 있다. UPDATE는 만료 이후 차단한다. 회귀에서 나온 expired END 거절을 수정했다.
- 짧은 수명 설정 `journey.automatic.isolated-ttl-seconds`는 기존 requireExecution의 격리 SIMULATOR gate를 통과한 경우에만 60~600초를 허용한다. DEVICE 수명은 항상 기존 600초다. prod/production 혼합 profile의 SIMULATOR는 계속 차단된다.
- **worker 자체는 원격 END를 발송하지 않는다.** 운영 durable Activity token 소유권/terminal outbox는 다음 단계다. 앱 미실행 원격 카드 자동 제거까지 구현했다고 표현하지 않는다.

## 독립 시뮬레이터 E2E

대상은 `NoLate Journey P0 Isolated 20261004`, iOS 26.5, `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`의 detached 독립 창이다. `deviceWindow-AppWindow-8`/`Show in Device Hub`를 확인해 조작했다. embedded Device Hub/실기기/다른 시뮬레이터는 조작하지 않았다.

합성 JWT/일정/경로/도착정보, 메모리 repository harness를 사용했다. production DB/실제 로그인/교통 공급자는 사용하지 않았다. 이번 외부 APNs 호출은 0회다. 기존 단일 시험 설치의 실제 APNs 검증은 [이전 END 기록](journey-apns-end-validation-20261006.md)과 구분한다.

1. 60초 격리 세션을 준비한다. ARMED 출발 0회→CoreSimulator 위치 replay가 실제 CoreLocation으로 들어가 ACTIVE/ACK·출발 1회가 된다. 이동 단계 강제 입력 없음.
2. 잠금 뒤 앱 terminate·GPS clear, 앱 service 미실행을 확인했다. 종료 시 서버 ACTIVE/expiryCount=0/인증 요청=14였다.
3. 실제 시간을 기다린 뒤 앱을 다시 열기 **전에** EXPIRED/expiryCount=1을 확인했다. 인증 요청=14·reconciliation=0으로 불변, 출발/활성화/알림 취소 각각 1회였다. HTTP read는 상태만 읽었다. 고정 시간 점프나 강제 phase/expire endpoint는 사용하지 않았다.
4. cold 재진입 뒤 자동 상태 조회 1회로 `종료 확인 · 자동 정리 완료`, native IDLE·오류 없음·큐 0을 확인했다. 복구 버튼 미사용·GPS 재개/추가 출발 없음.
5. 새 두 번째 세션이 ARMED/출발 0회로 준비됐다. GPS를 clear한 상태라 `LOCATION_TEMPORARILY_UNAVAILABLE`이 표시됐고 출발로 추정하지 않았다. 앱 종료 후 실제 시간 경과로 서버 EXPIRED/expiryCount=2를 확인했다. 인증 요청은 18→18, 추가 출발 없음.
6. 두 번째 cold 진입도 버튼 없이 자동 정리됐다. GPS를 원점에 설정하고 세 번째 새 ARMED 준비→즉시 UI 종료를 수행했다. STOPPED·오류 없음·종료 큐 0·최종 독립 잠금 카드 없음으로 마무리했다.

최종 안전 계수는 `prepare=3/departure=1/activation=1/cancel=1/expiryCount=2/reconciliationRequests=2/authenticatedRequests=23`이다. provider 시도=0·trap=0·trap Authorization=false. 출발 1회는 첫 GPS 세션이고 나머지 두 세션은 출발하지 않았다. fixture/server reset 없음. `--expect-stopped`는 OBSERVED_EXPECTATION_MET이며 apnsDelivery/productionNavigation은 UNVERIFIED로 유지했다. 대상 GPS를 clear하고 PID/작업 디렉터리를 확인한 이번 Metro·시험 서버만 종료했다. 커밋/푸시 없음.

이번 잠금 화면에 활성 카드가 표시된 증거는 확보하지 않았다. 최종 카드 없음이 worker의 원격 END/OS stale 전환 성공 증거는 아니다.

### 화면 증거

- [초기 기록 없음](evidence/journey-server-expiry-20261006/01-initial-no-checkpoint.png)
- [ARMED 출발 0회](evidence/journey-server-expiry-20261006/02-armed-zero-departure.png)
- [GPS ACTIVE/ACK](evidence/journey-server-expiry-20261006/03-gps-active-ack.png)
- [cold 진입 자동 정리](evidence/journey-server-expiry-20261006/06-restart-expired-auto-cleared.png)
- [새 세션 준비·GPS 없음](evidence/journey-server-expiry-20261006/07-new-armed-after-expired-cleanup.png)
- [ARMED 만료 뒤 cold 자동 정리](evidence/journey-server-expiry-20261006/08-armed-expiry-restart-auto-cleared.png)
- [세 번째 새 세션 준비](evidence/journey-server-expiry-20261006/09-third-new-prepare.png)
- [최종 종료·큐 0](evidence/journey-server-expiry-20261006/10-final-stop-queue-zero.png)
- [최종 독립 잠금 카드 없음](evidence/journey-server-expiry-20261006/11-final-lock-no-card.png)

## 자동 검사

- BE: automatic 및 Firebase client 12 suites / 77 tests PASS. 새 unit 5개·실제 H2 repository 검사 2개 포함. 기존 expired END 회귀 수정 후 최종 통과.
- H2에서 실제 UPDATE 구문·정확한 만료 경계·accepted receipt 보존·terminal 보존·stale 객체 optimistic save 거절·worker 객체 재구성 후 중복 변경 없음을 검사했다. 실제 MySQL/process restart 시험과는 구분한다.
- FE 전체 Jest 295 suites / 2,697 tests PASS, TypeScript PASS.
- Swift 269 tests PASS. Node QA 15 tests PASS.
- 이번 변경은 BE가 중심이며 FE/native 소스 변경이나 재빌드 없이 기존 signed opt-in 시험 바이너리로 E2E를 수행했다. 설치 Info.plist 두 플래그의 true를 직접 확인했다.
- Metro에서 기존 임시 dependency 경로의 동적 알림/Keychain import warning이 관측됐다. 합성 인증 화면의 성공을 실제 로그인·일반 알림 검증으로 승격하지 않는다. 실계정 시험 전에 import 경로/서명을 구분해 확인해야 한다.

## 후속 게이트

후속 [P2-3d3c 자동 END 검증](journey-expiry-auto-end-validation-20261006.md)에서 **test-source 메모리 sender**의 timer→실제 APNs END·독립 잠금 카드 제거를 확인했다. 이 문서의 외부 APNs 0회/운영 worker 미연결 기록은 당시 결과이며, 운영 durable 전달 완료로 바꾸지 않는다.

- 운영 DB/process restart 후 sender/소유권/terminal outbox 복원, Activity token 회전과 중복/모호한 provider 수락 정책.
- server TTL→durable remote END 전달·앱 미실행 잠금 카드 제거, 오프라인 stale fallback. 이번 worker는 세션 만료만 수행한다.
- 새 로그인 세대/삭제 일정/없는 서버 row의 안전한 회수, 실제 로그인 root 진입, 10분을 넘는 실제 안내 수명 정책.
- MySQL 동시 departure/expiry/stop 경쟁·대량 due row에서 query duration/lock 대기·scheduler 실패 후 재시도 관측. 현재 conditional bulk update의 운영 부하 한계는 아직 측정하지 않았다.
- 실제 일정/지도/공급자, 탑승 후 버스 완주·하차 한 정류장 전·지하철/환승·음성/무음·VoiceOver·실기기/배터리.
