# R4-4b-4 — 서버 도보 snapshot → 저장 경로 → GPS 안내

기준: 2026-10-12. 전체 내비게이션 완료 보고가 아니다. 운영 기본 OFF·Debug simulator-only를 유지한다.

## 구현

- 저장 ODsay WALK–BUS–WALK 원본을 변경하지 않고 별도 서버 도보 계약을 FE/native 입력에 결합한다.
  지도 표시용 연결선을 실제 보행 형상으로 재분류하지 않는다. 두 보행 형상은 TMAP 계약으로 검사한다.
- 준비·출발·관측·주기 재검증은 동일 소유자/login/revision/fingerprint/snapshot ID/TTL을 검증한다.
  준비의 유효기간도 300초 snapshot보다 길지 않다. GET/재시도는 TTL을 연장하지 않는다.
- 취소·교체·만료·로그인/원본 변경 시 안내를 종료하고 로컬 Activity를 제거한다.
  종료 뒤 화면의 이전 ‘도보 연결됨’도 제거하며 재연결 없이 재준비할 수 없다.
- 상세 카드와 Activity는 같은 보행 형상 projection을 사용한다. 단계 전환 버튼은 없다.
- 실제 제품 상세 화면의 공용 카드/준비 UI에 연결했으며, 별도 DEV 페이지는 이 공용 UI를
  H2·인증 fixture·loopback 합성 공급자로 호출한다. 실제 로그인/지도/API 완주와 같지 않다.

## 자동 검사

| 범위 | 결과 |
| --- | --- |
| BE journey/transit/Activity + schedule unit/schema guard/탈퇴 통합 | 69 suites / 515 PASS, 실패·오류·skip 0 |
| FE 전체 | 311 suites / 2,953 PASS |
| Swift 전체 | 349 PASS |
| Node QA/diagnostics/compat/metrics | 60 PASS |
| BE maintenance helper 안전 거부 | 3 PASS, DB/컨테이너 미접속 |
| TypeScript / iOS Debug simulator build | PASS |
| 네트워크 격리 MySQL 8.4 | 선행 5개 migration 순서 적용·부분/중복 거부·기존 row 보존 PASS. 합성 백업의 데이터/뷰/프로시저/트리거/이벤트 복원 PASS |

BE 무제한 전체 시도는 PASS가 아니다. 기본 512MiB JVM/context cache에서 heap 부족으로
중단됐고 일부 별도 DB fixture 연결도 실패했다. 범위를 명시한 위 69 suites는 테스트 JVM
2GiB/context cache 4로 재검증했다. FE 초기 정규화/mock 및 ISO 날짜 fixture 오류도 수정 후
전체를 다시 실행했다. 실패 이력을 최종 합격 수치로 숨기지 않는다.

## 독립 시뮬레이터 E2E

기기: `NoLate R2 Session E2E 20261008`, iOS 26.5. 분리 창의 `Show in Device Hub`
도구가 보이는 상태에서만 조작했다. embedded Device Hub 미사용, 실기기 미사용.

1. 원본 도보 형상 부족 → 준비 차단: [01](evidence/journey-r44b4-mixed-20261012/01-missing-walking-blocked.png).
2. 서버 계약 연결·검사·동의·준비 → ARMED, 이동 전 출발 아님: [02](evidence/journey-r44b4-mixed-20261012/02-armed-no-departure.png).
3. CoreLocation 합성 이동 → ACTIVE, 첫 정류장까지 도보 약 60m/마커:
   [03](evidence/journey-r44b4-mixed-20261012/03-gps-active-walk60m.png).
4. 독립 창을 잠금 → 같은 60m/마커의 로컬 Activity:
   [04](evidence/journey-r44b4-mixed-20261012/04-lock-walk60m-local-activity.png).
5. 잠금 중 인증된 fixture snapshot 취소 → 카드 제거:
   [05](evidence/journey-r44b4-mixed-20261012/05-lock-cancel-activity-removed.png).
6. 새 ARMED 세션 잠금 뒤 소유한 fixture 서버만 45초 일시 중지 → lease 만료/카드 제거:
   [06](evidence/journey-r44b4-mixed-20261012/06-lock-offline-activity-removed.png).
7. 통신 복원·잠금 해제 뒤 `STOPPED / SAVED_SESSION_VALIDATION_EXPIRED`, 이전 연결/안내 카드
   제거·재연결 없는 준비 차단: [07](evidence/journey-r44b4-mixed-20261012/07-offline-stopped-cleared.png).

8. 콜드 재시작 IDLE·이전 경로 없음: [08](evidence/journey-r44b4-mixed-20261012/08-cold-idle-no-stale-route.png).

후속 전체 이동 시험용으로 별도 시계의 합성 차량 관측 API를 harness에 연결했다. 첫 전체
시험은 도보 자동 출발·탑승·하차 100m 안내까지 진행했으나 자동 도착하지 못하고 300초
계약이 만료됐다. 실패를 유지한다:
[09](evidence/journey-r44b4-mixed-20261012/09-mixed-full-walk-active.png),
[10](evidence/journey-r44b4-mixed-20261012/10-mixed-full-alighting100m.png),
[11](evidence/journey-r44b4-mixed-20261012/11-mixed-lock-alighting.png),
[12](evidence/journey-r44b4-mixed-20261012/12-first-full-replay-expired-failure.png).
재시험 기기는 새 독립 창 `NoLate Mixed Journey E2E 20261012`다. native 안전 기준은
유지하고 시험 차량의 다음 정류장 경계·정지 위치를 보정했다. 화면에 제한된
이유 코드/증거 개수만 추가했고 좌표·토큰·실제 식별자는 표시하지 않는다. 만료 시 이전
도보 연결 표시도 제거한다. H2 준비 기록을 영속화하고 fixture 재시작 뒤 취소·종료
동기화 회귀 검사를 추가했다. 메모리 준비 기록을 잃었던 이전 시험의 미처리 종료 큐는
지우거나 성공으로 위조하지 않았다.

두 번째 전체 시험은 자동 탑승·차량 분리·최종 도보까지 진행했으나 도착 dwell을 마치기
전 300초 계약이 만료됐다. [14](evidence/journey-r44b4-mixed-20261012/14-mixed-retest-lock-final-walk.png),
[15](evidence/journey-r44b4-mixed-20261012/15-mixed-retest-lock-stale-after-replay.png),
[16](evidence/journey-r44b4-mixed-20261012/16-mixed-retest-native-expired.png).
13번 이미지는 캡처가 이전 ARMED 화면을 반환했으므로 RIDING의 시각 증거에서 제외한다.
메인 스레드 샘플은 idle run loop였으며 두 실패의 모든 원인을 확정했다고 주장하지 않는다.

세 번째 전체 시험은 합성 차량의 정차 시간을 줄이고 최종 보행 입력 시작을 당겨
기존 300초 계약 안에서 완료했다. 차량 시계와 승객 GPS는 독립이며 단계 API를 호출하지 않는다.
자동 출발 → RIDING → 하차 준비 → 차량 분리 → 최종 도보 10m →
`DESTINATION_ARRIVED / STOPPED`, 종료 대기 0, 도착 후 잠금 카드 제거를 확인했다:
[17](evidence/journey-r44b4-mixed-20261012/17-mixed-third-final-walk10m.png),
[18](evidence/journey-r44b4-mixed-20261012/18-mixed-third-destination-arrived.png),
[19](evidence/journey-r44b4-mixed-20261012/19-mixed-third-lock-activity-removed.png).
이는 전경 중심 완주다. 네 번째 시험은 준비 직후부터 도착까지 독립 창을 계속 잠그고
같은 GPS 입력 경로를 수행했다. 자동 출발/탑승/하차 준비/차량 분리/최종 도보 60m/
자동 도착 종료·카드 제거·종료 대기 0을 확인했다. 정상 종료 후 이전 연결 문구가
제거됐고 검증 실패로 잘못 표시되지 않았다:
[20](evidence/journey-r44b4-mixed-20261012/20-locked-before-departure-active.png),
[22](evidence/journey-r44b4-mixed-20261012/22-locked-alighting-marker.png),
[23](evidence/journey-r44b4-mixed-20261012/23-locked-final-walk60m.png),
[24](evidence/journey-r44b4-mixed-20261012/24-locked-arrival-activity-removed.png),
[25](evidence/journey-r44b4-mixed-20261012/25-locked-run-destination-arrived-cleared.png).
21번은 승차 후보/위치 확인 중 화면이므로 확정 탑승의 시각 증거로 쓰지 않는다.
도착 시 계약 잔여 시간이 약 3초였으므로 수십 분 여정이나 넓은 timing margin 검증은 아니다.
콜드 재시작 후 새 경로 불러오기에서 AX는 IDLE/NOT_ARMED·출발 0·종료 대기 0을
반환했다. 26번 이미지는 이전 STOPPED 프레임이므로 콜드 IDLE의 시각 증거에서 제외한다.
이 독립 창의 AX/표시 프레임 불일치를 기능 성공으로 덮어 해석하지 않는다.

누락된 native 이벤트로 화면이 ACTIVE에 남는 경우를 위해 전경에서만 2초 간격의
읽기 전용 snapshot 동기화를 추가했다. 중첩 읽기와 새로운 이벤트 덮어쓰기를 차단하고
백그라운드 JS polling은 하지 않는다. 정상 도착/취소를 포함한 모든 terminal 상태에서
이전 도보 연결 표시를 제거하며 정상 종료를 검증 실패로 표시하지 않는다.
최대 5분 계약에 준비 대기 시간이 포함됨을 UI에 명시했다. Swift 서울 좌표 최종 보행
회귀 검사도 5개 고유 fix·20초 도착 dwell·오차 기준을 그대로 유지한다.

이 E2E의 버스 형상·authority·issuer·보행 공급자는 합성이다. 실제 외부 API/키/APNs 전송은 0회다.
잠금 Activity는 로컬 생성/종료이며 실제 APNs 전달 증거가 아니다.

## DB 적용 및 남은 게이트

`2026-10-12-mixed-walking-binding.sql`은 preparations에 nullable snapshot ID를 추가한다.
새 production marker를 요구하므로 flag OFF라도 migration 전에 새 서버를 배포하지 않는다.
공유 `late_project`는 사용자 확인 대상이다. API·worker **중지 완료 확인 대기** 중이며 아직
공유 DB DDL은 실행하지 않았다. operator helper는 0개 잔여 연결·전체 backup/fsync/hash·
격리 DB 백업 복원·순서 적용·기존 row/marker 보존을 검사하도록 준비했다. 실제 대상에서
아직 실행하지 않았으므로 백업/복원/적용 성공을 주장하지 않는다.

실제 공급자 HTTPS/할당량, 저장 ODsay 원본과 공식 버스/차량 연결, R6 지하철·환승,
제품 설정/접근성/실기기 현장 GPS·무음·배터리 검증은 남아 있다. 300초 pilot 계약을
수십 분 실제 여정의 무중단 실행으로 확대해서 해석하지 않는다. `.env`/운영 ON/배포 없음.
