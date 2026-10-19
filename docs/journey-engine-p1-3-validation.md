# P1-3 선택 경로 자동 출발 준비·동기화 검증

검증일: 2026-10-04 (Asia/Seoul). FE·BE `feature/transit-guidance-v1`.

## 구현 범위

새로 검색한 선택 경로의 첫 도보 형상을 검사하고, 동의 후 네이티브 Runtime을 ARMED로 준비한다.
출발 버튼·단계 전환 버튼으로 ACTIVE를 만드는 기능이 아니다. 위치 증거가 기준을 만족하면
자동 출발 사건이 발생한다. 탑승·하차·환승·도착 판단 및 음성/Live Activity 연결은 아직 없다.

- `RouteSelectResultsScreen`의 개발용 선택 경로 진입점: `ROUTING_RESPONSE`, LOCAL_ONLY.
  실제 경로 형상으로 로컬 감지를 준비하지만 일정 저장이나 사용자 서버 출발 처리는 하지 않는다.
- `/internal/journey-automatic`: 합성 예시, SANDBOX. `SYNTHETIC_FIXTURE` 출처를 유지한다.
  격리된 `127.0.0.1:15543` HTTP 시험 서버의 일정 9001만 사용한다.
- Debug iOS simulator + 진단 opt-in을 모두 요구한다. 실기기·Release는 네이티브 시작을 거부한다.
  기존 수동 파일럿과 새 Runtime은 서로 동시에 실행되지 않는다. 운영 기능 플래그는 기본 OFF다.
- 화면 종료는 감지를 종료하지 않는다. 명시적 종료·로그아웃·10분 TTL은 감지 수명을 제한한다.
  앱 재실행 시 자동 복구하지 않고, 같은 입력/digest/binding에 대한 명시 복구를 요구한다.

## 저장·서버 계약

네이티브는 경로·엔진 상태·출발 outbox·ACK를 하나의 atomic envelope로 저장한 뒤 상태를 발행한다.
좌표는 기기 내 파일에만 남으며 JS 저장소에는 식별자·digest·유효기간만 저장한다.
업로드 allow-list는 session/generation/revision/owner/digest, 사건 키·발생 시각·SIMULATOR 표시뿐이다.
첫 도보 출발 이후의 지속 위치 관측을 서버로 업로드하는 API는 이번 범위가 아니다.

서버는 별도 preparation의 ARMED와 ACTIVE를 구분한다. ARMED에서는 출발·알람 취소·Live Activity
부작용이 없다. departure를 수락한 트랜잭션에서 기존 출발 처리와 알람 취소를 한 번 적용하고,
같은 사건 재전송에는 저장된 ACK를 반환한다. 수동 여정 행이나 이동 중 Live Activity는 만들지 않는다.
digest는 클라이언트 입력의 일관성 식별자이며 서버가 그 형상의 정확도를 인증한다는 뜻이 아니다.

수신 실패 시 같은 사건을 재시도하며 성공 응답 검증 후에만 네이티브 ACK를 저장한다.
화면 이탈 후에도 동기화 수명은 유지된다. 정지/로그아웃 중 늦게 도착한 응답은 새 세션에 적용하지 않는다.
네트워크 재시도는 전경 JS 실행에 의존한다. JS가 중단된 백그라운드 전송까지 보장하지 않는다.
위치 감지와 outbox 저장은 네이티브가 담당하고, 전경 재개/명시 복구 후 동기화한다.

저장 실패는 위치 수집을 중지하고 영속 revoke를 시도한다. 파일시스템이 tombstone 저장과 삭제를
모두 거부하면 프로세스 재실행까지 revoke를 보장할 수 없으며 `AUTOMATIC_REVOCATION_FAILED`로 표시한다.

## 검증 구분

- Swift package: 176개 PASS (이번 Session/Store/경계 조건 40개 포함), iOS Swift 6 strict typecheck PASS.
- FE 자동 출발 bridge/transport 35개, coordinator 31개, UI/hook 30개 PASS.
- FE 전체 272 suites / 2,251 tests, TypeScript 검사, 신규 소유 파일 lint(경고/오류 0), 진단 설정 7개 PASS.
- Debug iOS 통합 빌드 및 수정 후 재빌드 exit 0. 외부 라이브러리 경고와 Xcode의
  `failed with exit code 0` 진단 문구가 존재하지만 실제 빌드 종료값과 새 앱 설치로 성공을 확인했다.
- BE 신규 23개 + 기존 journey 28개 + schema guard 23개 = 74개 PASS.
  실제 H2 repository를 사용하는 동시성·rollback 회귀를 포함한다.
- 서버 계약/하네스: [BE 검증 기록](../../NoLate_BE/docs/schedule/journey-engine-p1-3-automatic-departure.md).

### 독립 시뮬레이터 E2E 결과

Computer Use로 아래 독립 기기 창의 실제 앱 컨트롤을 조작했다. 위치만 `simctl location`으로
주입하고, 상태 전환/출발 이벤트/ACK를 직접 주입하지 않았다. 합성 첫 도보는 약 132m이며
출발점 근처 0~2.6m 흔들림과 20m 간격/4초의 0→120m 이동 입력을 사용했다.

| 시나리오 | 앱 관측 | 격리 서버 관측 | 결과 |
| --- | --- | --- | --- |
| 역방향·중간 오류 좌표 | 준비 불가·준비 버튼 disabled | prepare/출발/취소 모두 0 | PASS |
| 검사·동의 후 준비 + 정지 흔들림 | ARMED, 자동 출발 0, STATIONARY | ARMED, prepare 1, 나머지 0 | PASS |
| 위치 이동, 동기화 보류 | ACTIVE, 자동 출발 1, 120.0m, pending 있음 | 계속 ARMED, 나머지 0 | PASS |
| 화면 닫기·재진입 | ACTIVE/pending 유지, 별도 출발 없음 | 변화 없음 | PASS |
| 프로세스 종료·재실행 | IDLE/NOT_COLLECTING, 저장 기록 있음, 자동 복구 없음 | 변화 없음 | PASS |
| 저장 기록을 새 준비로 교체 시도 | CHECKPOINT_RESTORE_OR_STOP_REQUIRED, 기록 유지 | 새 prepare 없음 | PASS |
| 같은 경로 명시 복구, 발생 후 2분 넘은 사건 | 기존 ACTIVE/출발 1 복원, pending 유지 | 최초 출발 승인 | PASS |
| commit 후 성공 응답 대신 503 | RETRY_WAIT → 자동 재시도 → ACKNOWLEDGED, pending 없음 | departure/activation/cancel 각각 1 유지 | PASS |
| 동기화 재시도 추가 입력 | 출발 1, 확인 완료 유지 | 카운터 각 1 유지 | PASS |
| 종료 후 새로운 위치 | STOPPED/NOT_COLLECTING, pending 없음, 거리/출발 횟수 변화 없음 | STOPPED, 카운터 각 1 유지 | PASS |

별도 HTTP smoke도 실행해 처리 전 503, commit 후 503, duplicate ACK, 같은 키의 변경 payload 409,
stop 후 과거 receipt 재전송이 상태를 되살리지 않는 것까지 PASS했다. 시험 종료 후 해당 스크립트가
자신의 합성 메모리 데이터를 초기화했고 모든 counter 0/NONE을 확인했다. 사용자 데이터 삭제가 아니다.
위치 주입은 clear했고 앱은 STOPPED로 남겼다. 임시 iOS 빌드 설정 세 파일은 작업 전 상태로 복원했다.

주요 증거:

- [오류 복구 후 정지 상태](evidence/journey-p1-3-20261004/11-final-armed-stationary.png)
- [최종 위치 출발·보류](evidence/journey-p1-3-20261004/12-final-active-pending.png)
- [재실행 후 자동 수집 없음](evidence/journey-p1-3-20261004/13-final-relaunch-idle.png)
- [503 뒤 재시도 대기](evidence/journey-p1-3-20261004/14-final-restored-retry.png)
- [중복 없는 확인 완료](evidence/journey-p1-3-20261004/16-final-acknowledged-top.png)
- [종료 후 위치 수집 없음](evidence/journey-p1-3-20261004/17-final-stopped-late-location-ignored.png)

전체 10분 만료·권한 철회·로그아웃 GUI·P1-3 잠금 상태 전송은 이번 화면 E2E에서 수행하지 않았다.
각 관련 단위 테스트와 과거 P1-1 잠금 실험을 이번 Runtime의 화면 검증으로 바꿔 적지 않는다.

### 통합 검증에서 발견해 수정한 문제

1. CoreLocation의 일시 오류 뒤 유효 위치가 다시 들어와도 이전 오류 문구가 남았다.
   새 유효 관측을 수락하고 atomic 저장까지 성공한 경우에만 해당 일시 오류를 지우도록 수정했다.
   오래된·중복·낮은 정확도·경로 밖 입력이나 저장/권한 오류를 정상으로 숨기지 않는다.
2. 출발 사건 복구 시 기기의 600초 TTL과 서버의 120초 과거 사건 cutoff가 충돌했다.
   실제 E2E에서 출발 미확인 상태와 서버 거부를 확인했다. 준비~만료 범위의 사건은
   세션 만료 전까지 재전송할 수 있게 맞췄고, 121/180/599초 지연 승인 및 600초 이후
   신규 거부 테스트를 추가했다. 미래 30초 초과·준비 전·만료 이후 발생 시각은 계속 거절한다.
3. 재실행 후 저장 기록이 있는 상태에서 새 준비 시도로 기존 outbox를 지우지 않도록,
   coordinator에서 먼저 `CHECKPOINT_RESTORE_OR_STOP_REQUIRED`를 반환한다.
4. native ingest 중 만료 경계를 넘는 경우에도 위치 입력을 해제하고 기록을 revoke한다.

증거 파일 01~10은 첫 시험과 수정 전 문제 발견 기록을 포함한다. 최종 결과는 11번 이후
화면과 아래 관측을 기준으로 한다. 수정 전 실패 화면을 성공 증거로 사용하지 않는다.

## 검증 환경과 한계

기기는 `NoLate Journey P0 Isolated 20261004` / iOS 26.5,
UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01` 하나만 사용한다.
GUI는 `deviceWindow-AppWindow-4` 독립 창에서 조작한다. Xcode 27에서 창 소유 앱 이름은
Device Hub이지만, 관리 패널·다른 기기 창을 E2E 조작 대상으로 사용하지 않는다.

E2E 하네스는 실제 새 controller/service/domain을 호출하지만 인증 사용자는 fixture이고 repository와
출발/알람 side effect는 테스트 대역/카운터다. 운영 인증·DB·APNs·실제 알람 취소를 검증하지 않는다.
응답 손실 시험은 서버 commit 후 HTTP 503을 반환하는 실패 주입이며 실제 네트워크 단절과 다르다.
동기화 중단 체크박스 또한 시험용 전송 보류이지 기기 비행기 모드 시험이 아니다.

실제 공급자 API 검색, 실제 경로 정확도, 실기기 백그라운드/무음 동작, 실제 APNs 및 잠금 화면
Live Activity 전달은 미검증이다. 네이버 지도 수준 대중교통 내비게이션 완료를 의미하지 않는다.
다음 단계에는 실제 일정 연결과 오프라인 로컬 출발 알람 조정, 지원 버스의 관측/차량 식별·최신성,
정류장 접근·대기·탑승 자동 판정을 검증해야 한다.

`.env`는 열거나 변경하지 않았다. 커밋·푸시는 이 단계에서 수행하지 않았다.
