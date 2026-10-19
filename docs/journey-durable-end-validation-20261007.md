# Activity 소유권 영속화·서버 재시작 후 자동 END 검증

기준: 2026-10-07, FE/BE `feature/transit-guidance-v1`의 미커밋 작업. P2-3d3d 첫 slice다. 이전 [메모리 자동 END 시험](journey-expiry-auto-end-validation-20261006.md)을 대체해 과거 결과를 수정하는 문서가 아니라, **영속 저장과 실제 프로세스 재시작**을 추가한 후속 증거다. P2 전체/운영 배포/실제 버스 완주 완료가 아니다.

## 구현 경계

- BE main-source에 `JourneyActivityLane`, 암호화 자격증명, 인증 UPDATE/END controller, terminal dispatcher/보존 기한 정리를 추가했다. `journey.activity.enabled` 기본 OFF. 운영 DB/서버에 migration이나 플래그를 적용하지 않았다.
- 기존 departure Activity wire format과 별도다. API principal, 로그인 세대, 일정/자동 세션/binding/저장 경로를 재검증한다. 첫 WALK→BUS 관측 계약 밖의 탑승·하차 상태를 허용하지 않는다.
- 실제 등록된 iOS FCM의 계정·기기 지문·소유권 version을 고정하고 기존 FCM dispatch lease를 공유한다. UPDATE와 END 모두 provider 호출 직전에 검증한다. 무효 Activity로 일반 FCM을 임의 폐기하지 않는다. GUI fixture의 FCM 소유권은 합성 proof이며 실제 등록 DB 통합 성공과 구분한다.
- FCM/Activity token은 AES-256-GCM으로 session AAD와 함께 암호화한다. 키는 외부 주입 필수이며 Git/default key가 없다. lane에는 원시 GPS를 저장하지 않는다. 7일 보존 기한은 UPDATE로 연장하지 않으며 계정/일정 삭제에도 정리한다.
- terminal의 원래 EXPIRED/STOPPED와 endedAt을 보존한다. 같은 초는 다음 tick으로 지연한다. READY→IN_FLIGHT 예약을 DB commit한 뒤 provider를 호출하며 ACCEPTED는 재전송하지 않는다. 중단된 IN_FLIGHT/수락 불명은 UNKNOWN으로 격리한다. 이 정책은 exactly-once 전달 보장이 아니며 모호한 결과를 무조건 재전송하지 않는다.
- immutable Activity/token lane이다. **token 회전은 아직 미지원**이고 거절한다. 전체 로그인 전환/장시간 수명/기기 필드 검증을 구현한 것으로 확대 해석하지 않는다.

## 단계별 자동 검사

| 검사 | 결과 |
| --- | --- |
| BE 전체 journey/Activity/Firebase/schema/FCM ownership·lease 회귀 | 25 suites / 214 tests PASS, failure/error/skip 0 |
| 새 영속화 계약 | 15개: file DB 재연결, READY 복구, IN_FLIGHT crash→UNKNOWN, 모호한 수락/무효 token 반복 금지, 같은 초 지연, 암호화/AAD/키 실패, revoked actor/FCM, worker 경쟁, historical 세션 격리, API principal/개인 필드 차단, 보존 정리 |
| 실제 등록 FCM 소유권 어댑터 | 2개: 계정·기기·epoch·retirement·플랫폼 검증 및 기존 공유 lease 획득/해제 |
| 실제 MySQL 8.4 격리 통합 | 1개 PASS, skip 0. 두 reviewed migration 적용, 25컬럼/marker·재적용 차단, Hibernate `validate`, manager 재생성 후 만료·동시 worker END 단일 claim·ACCEPTED 재시작 후 재전송 0 |
| FE 전체 Jest | 295 suites / 2,697 tests PASS |
| TypeScript | `tsc --noEmit` PASS |
| Swift 순수 정책 | 269 tests PASS |
| Node QA | 15 tests PASS |

MySQL은 UUID 이름의 disposable Docker 컨테이너와 합성 자격증명만 사용하고 종료 후 삭제했다. 사용자 MySQL/운영 설정·`.env`를 읽거나 수정하지 않았다. MySQL provider는 합성이며 아래 실제 APNs E2E의 저장소는 격리 H2 file DB다. 두 검사의 범위를 합쳐 운영 MySQL→실제 APNs 통합 성공이라고 주장하지 않는다.

## 독립 시뮬레이터 E2E

대상 `NoLate Journey P0 Isolated 20261004`, iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`. detached `deviceWindow-AppWindow-8` / `Show in Device Hub`를 확인한 독립 창만 조작했다. embedded Device Hub/실기기/다른 simulator는 조작하지 않았다.

기존 signed DEBUG 바이너리의 설치 opt-in을 사용했고 FE/native 코드는 이번 slice에서 변경·재빌드하지 않았다. 합성 JWT·일정·전체 경로·도착정보/등록 proof, 실제 CoreLocation GPS replay를 사용했다. 외부 전송만 승인된 단일 Firebase 시험 설치 allowlist로 실제 발송했다. 로컬 UPDATE는 provider 시험에서 차단된다.

| 순서 | 관측·판정 |
| --- | --- |
| 새 서버 A | 격리 file DB/랜덤 시험 암호화 키로 시작. 초기 lane 0. cold 앱 진입/설치 지문/명시 provider 선택/검사·동의·준비 |
| GPS replay | ARMED 출발 0→ACTIVE 출발 1/ACK. phase/출발 버튼 없이 9개 CoreLocation 샘플. lane 1 저장, 실제 provider UPDATE 수락 확인 |
| 앱 종료 | 독립 잠금 카드 `합성 정류장 1까지 · 도보 약 60m` 존재. 앱 terminate/GPS clear 뒤 app service 부재 확인. 수동 END/UI stop/시계 변경/fixture reset 없음 |
| 서버 A 종료→B | listener PID 57997의 BE cwd를 확인 후 TERM, port 부재 확인. 같은 file DB/키로 별도 PID 60175 시작. 사용자 앱 재진입 없음 |
| B 만료→END | DB 준비 1/lane 1 복원, EXPIRED, durable END ACCEPTED 1. B provider attempts=1/accepted=1/rejected=0. authenticatedRequests=0/reconciliationRequests=0/departureCount=0. 독립 잠금 카드 제거 확인 |
| 후속 tick | EXPIRED/END ACCEPTED 1/attempts 1 유지, 추가 provider 전송 없음 |
| B 종료→C | 같은 DB/키로 다시 실제 process restart. EXPIRED/lane 1/END ACCEPTED 1 유지. C provider attempts=0/accepted=0/rejected=0, auth/reconcile 0. 잠금 카드 미재생성 |
| cold 재진입 | 버튼 없이 `종료 확인 · 자동 정리 완료`, native IDLE/provider OFF/종료 큐 0, 추적 자동 재개 없음 |
| 새 준비·종료 | 새 ARMED/출발 0 후 UI 종료. 최종 STOPPED/종료 큐 0. DB 준비 2/lane 1/이전 END ACCEPTED 1, C provider attempts=0. GPS clear 상태의 `LOCATION_TEMPORARILY_UNAVAILABLE`가 종료 후 마지막 오류로 남는 UI 잔여 문제 관측 |

서버 A의 처음 UPDATE 2건 수락을 관측했지만 종료 직전의 총 계수를 따로 고정하지 않았으므로 A/B/C 통합 총 전송 수는 주장하지 않는다. B와 C 카운터는 **프로세스별**이며 C의 0은 B 수락 기록 유실이 아니다. DB의 `durableEndAcceptedCount=1`이 유지됨을 함께 확인했다. B에서 END 뒤 새 앱 PID 60268이 관측됐다. 사용자 재진입과 HTTP 요청은 없었으나 OS가 앱 프로세스를 생성하지 않았다는 보장은 하지 않는다.

초기 실패: 오래 열린 내부 화면의 만료된 시험 인증으로 준비가 `AUTOMATIC_SERVER_REJECTED`였다. DB 준비/lane/provider 시도 0을 확인했고, 앱 cold 진입으로 새 시험 인증을 받은 뒤 다시 진행했다. DB reset이나 실패를 숨기는 기록 삭제는 하지 않았다.

### 화면 증거

- [GPS ACTIVE](evidence/journey-durable-end-20261007/01-gps-active.png)
- [앱 terminate 뒤 잠금 카드 유지](evidence/journey-durable-end-20261007/03-app-terminated-lock.png)
- [서버 B 자동 END 뒤 카드 제거](evidence/journey-durable-end-20261007/04-restarted-server-auto-end-removed.png)
- [서버 C 재시작 뒤 미재생성](evidence/journey-durable-end-20261007/05-second-server-restart-no-replay.png)
- [cold terminal 자동 정리](evidence/journey-durable-end-20261007/06-cold-terminal-auto-cleared.png)
- [새 ARMED/provider OFF](evidence/journey-durable-end-20261007/07-new-armed-after-recovery.png)
- [STOPPED/종료 대기 0](evidence/journey-durable-end-20261007/08-final-stopped-empty-queue.png)
- [최종 잠금 카드 없음](evidence/journey-durable-end-20261007/09-final-lock-no-card.png)

`02-locked-before-restart`는 메뉴 동작 직후 아직 앱 화면인 중간 캡처다. 잠금/카드 유지 확정은 03번만 사용한다. 파일 이름을 성공 증거로 대체하지 않는다. read-only readiness 성공도 실제 APNs/운영 내비게이션 전체 PASS가 아니다.

최종 GPS clear, 이번 BE/Metro PID·cwd 확인 뒤 종료, listener/file handle 부재를 확인했다. 실제 token을 포함했던 이번 임시 encrypted DB와 시험 키만 정확한 경로로 삭제하고 빈 전용 디렉터리도 제거했다. 복구 불가한 시험 자료이며 사용자 DB/앱 데이터/서버 인증 JSON은 삭제하지 않았다. 증거 PNG·safe 계수/검사 로그는 보존했다. disposable MySQL 컨테이너 잔류 없음도 확인했다. 커밋·푸시는 하지 않았다.

## E2E 발견 오류 후속 수정·재시험

위 새 ARMED/종료 시험에서 관측한 일시 위치 오류 잔류도 수정했다. `NoLateJourneyAutomaticLocationErrorPolicy.afterExplicitStop`은 `LOCATION_TEMPORARILY_UNAVAILABLE`만 지운다. permission/checkpoint/ACK/revocation 실패는 지우지 않으며, native `stop()`의 durable revoke가 실패하면 `AUTOMATIC_REVOCATION_FAILED`가 계속 표시된다. 위치 샘플/이동 단계를 강제로 성공시키는 변경이 아니다.

- Swift **270 tests PASS**(일시 오류만 정리/영구 오류 보존 검사 추가), signed DEBUG 앱/확장 build PASS, diagnostics config 8 tests PASS, Node QA 재검사 15 PASS. 앞의 269는 최초 영속화 E2E 시점 결과다.
- 새 바이너리를 같은 시험 simulator에 설치하되 앱 데이터는 보존했다. 생성된 QA build product의 Info.plist에만 기존 diagnostics/auth/APNs opt-in 및 location/audio mode를 적용해 재서명했다. source/운영 default-off는 변경하지 않았다.
- 실제 provider OFF인 별도 loopback harness에서 GPS clear→새 ARMED/출발 0→실제 CoreLocation `LOCATION_TEMPORARILY_UNAVAILABLE` 발생을 확인했다. UI stop 뒤 **STOPPED/오류 없음/서버 종료 대기 0건·오류 없음**을 확인했다. server prepare 1/departure 0/provider 0/trap 0. 실제 APNs 재전송 성공으로 해석하지 않는다.
- [후속 ARMED 위치 오류](evidence/journey-durable-end-20261007/10-followup-armed-location-error.png), [수정 뒤 STOPPED/오류 없음](evidence/journey-durable-end-20261007/11-followup-stopped-no-error.png).
- 장시간 앱 재시작/APNs 수신은 위 최초 E2E의 증거를 보존하고, 이 native 후속 수정 뒤 모든 APNs 시나리오를 재실행했다고 주장하지 않는다. 이번 후속 시험의 서버/Metro도 PID/cwd 확인 후 종료하고 listener 부재/GPS clear를 확인했다.

## 운영 적용 전에 남은 게이트

1. migration은 검토 후 별도 적용한다. schema guard marker `2026-10-06-journey-activity-lanes-v1`이 필요하다. 운영 플래그 기본 OFF와 외부 암호화 키/키 교체/보존·삭제·지표·부하를 함께 검증한다. 기존 DB에 `ddl-auto=update`로 우회하지 않는다.
2. token 회전/새 Activity epoch, 실제 등록 DB와 실제 로그인 진입, 새 로그인 세대·삭제된 일정 회수 정책, 공급자 timeout/실제 지연 역전·모호한 수락 처리의 운영 재현이 필요하다.
3. 오프라인 stale·전체 VoiceOver·실기기 wake/무음/오디오·배터리는 미검증이다. 현재 simulator-only 결정을 유지한다.
4. 첫 버스 확정 승차·남은 하차 정류장·한 정류장 전 알림·최종 도착, P3 지하철/환승, P4 재탐색은 별도 미완료 기능이다. 이름/타이머/도착 예정 버스의 남은 정류소를 사용자의 탑승 근거로 바꾸지 않는다.
