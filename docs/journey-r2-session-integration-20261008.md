# R2-1 자동 안내 세션 ↔ 차량 동행 엔진 연결

실행일: 2026-10-08 (Asia/Seoul). FE/BE `feature/transit-guidance-v1`.

## 이번 범위

- `NoLateJourneyAutomaticSession`에 별도 탑승·주행 reducer를 연결했다. 검증된 native route binding을 받았을 때만 생성하며 일반 Runtime은 아직 nil을 전달한다.
- 출발 감지 후 같은 원본 GPS 관측과 같은 세션의 정류장 접근/대기 이력, 독립 차량 관측 배열을 함께 전달한다. JS 단계 버튼/속도만으로 RIDING을 만들지 않는다.
- session/generation/revision/epoch 및 준비된 접근·버스 형상이 다르면 binding을 거부한다. LOCAL_ONLY는 주행 admission을 받지 않는다.
- 만료·종료·sequence 소진 시 주행도 함께 종료한다. 명시적 종료는 반복 호출해도 주행 sequence를 증가시키지 않는다.
- 차량 ID·동행 이력·탑승 확정은 checkpoint/outbox에 저장하지 않는다. 복구 후 binding과 차량 증거를 다시 확보해야 한다.
- Runtime/개발 화면에 `ridePhase/rideQuality/rideReason/rideEvidenceCount`를 추가했다. 현재의 `VERIFIED_RIDE_BINDING_UNAVAILABLE`을 확인할 수 있다.
- **제품 상세·Live Activity의 RIDING contract는 아직 열지 않았다.** 기존 첫 도보/접근/대기 계약을 그대로 유지한다. 이 변경은 실제 자동 탑승 ON이나 R2 전체 완료가 아니다.

## R1 매핑 보완 및 실제 자료

전체 정류장 순서의 앞·뒤 도달 가능성을 함께 계산한다. 모든 가능한 전체 경로에서 선택 구간의 각 occurrence가 하나로 동일하면, 선택 구간 밖의 중복 때문에 거부하지 않는다. 선택 구간 자체의 중복은 여전히 차단한다. 최근접 후보 강제 선택·endpoint 강제 고정·임의 정류장 생략은 없다.

진단에는 고정 enum, 검증된 정류장 순번, 후보 개수만 추가했다. 좌표/정류장 ID/키/원문은 출력하지 않는다.

이 실행에서 공식 서울 7016 고정 노선 정류장·형상을 **각 1회, 총 2회 HTTP 조회**했다. 이전 평문 전송 승인 범위의 동일 시험이며 재시도·리다이렉트·차량/지하철 조회는 없다.

- 정류장 106개 / 형상점 1,693개.
- 공개 번호 오류 1행. 선택 44~48의 오류 0행.
- `STOP_SHAPE_AMBIGUOUS / SELECTED_MULTIPLE`.
- 검증된 순번 44에 전체 순서와 양립하는 후보 **2개**. 성공 투영 0개.
- `navigationReady=false`. 메타데이터 조회 성공을 차량 동행/자동 탑승 허가로 전용하지 않는다.
- probe의 partial 결과 때문에 Gradle exit 1; 회귀 테스트 실패가 아니다.

## 코드 검증

| 검사 | 결과 |
| --- | --- |
| BE transit/journey/liveactivity, MySQL-tag 제외 | 51 suites / 369건 PASS, 실패·오류·skip 0 |
| Swift 전체 | 291건 PASS, 실패 0 |
| FE Jest 전체 | 295 suites / 2,706건 PASS |
| TypeScript | PASS |
| Node END/replay/readiness QA | 15건 PASS |
| 일반/진단 Expo 설정 QA | 8건 PASS |
| git diff --check | FE/BE PASS |

새 Swift 통합 검사는 합성 GPS+합성 차량으로 세션 RIDING, 차량 없음, 다른 binding/형상, 비영속성, 복구, TTL/종료를 확인한다. **실제 차량/GPS E2E가 아니다.**

## 독립 시뮬레이터 E2E

기존 대상: `NoLate Journey P0 Isolated 20261004`, iOS 26.5,
`2847D4CF-88EA-4DA1-87E9-FD1948F58E01`. 새 일반 빌드의 default-off/준비 버튼 비활성화,
진단 빌드의 R2 차단 사유 표시는 확인했다. 이전 JS binding을 새 메모리 시험 서버가
모르므로 종료 요청 1건이 `STOP_DELIVERY_UNAVAILABLE`로 남는다. 이를 임의 삭제하거나
전달 완료로 처리하지 않았다. 기존 앱은 종료했고 기록은 보존했다.

새 격리 대상: `NoLate R2 Session E2E 20261008`, iOS 26.5,
`96AF9A48-4721-4335-B7BF-10B9382B7A30`. 기존 사용자/QA 데이터를 덮어쓰지 않고 생성했다.
Device Hub의 임베디드 화면이 아니라 `Show in Device Hub` 툴바가 있는 독립 창만 조작한다.

새 native 진단 빌드와 로컬 합성 인증 서버로 아래를 확인했다. UI 클릭은 이 독립 창에서만 수행했고, 이동은 해당 UDID에 CoreLocation 좌표를 주입했다. 단계 전환/탑승 버튼이나 차량 관측 주입은 사용하지 않았다.

| 시나리오 | 결과 |
| --- | --- |
| 깨끗한 시작 → 경로 검사·동의·준비 | IDLE → ARMED, 출발 0회, 종료 대기 0건 |
| 첫 도보 8개 관측 → 정류장 부근 5개 체류 관측 | ACTIVE, 출발 1회 / ACKNOWLEDGED |
| 실제 경로 상세 컴포넌트 | 현재 도보 행·경로 바 마커, 잔여 도보 60→40m, 이후 합성 정류장 1 / 버스 대기 표시 확인 |
| 차량 증거 없이 버스 방향으로 41개 GPS 관측 | 자동 탑승 UNAVAILABLE / VERIFIED_RIDE_BINDING_UNAVAILABLE / 차량 근거 0. RIDING 확정 없음 |
| GPS 주입 해제·오래된 관측 | 위치 확인 중 / 위치 정보 업데이트 필요. native checkpoint는 BUS_LOCATION_STALE, boardingConfirmed=false, 차량 이력 저장 없음 |
| 명시적 안내 종료 | STOPPED / 동기화 IDLE / 종료 대기 0 / 오류 없음, 앱 내 안내 카드 제거 |
| 앱 terminate → 콜드 재진입 | IDLE / 출발 0 / 종료 대기 0 / 이전 기록 없음. 종료된 안내 자동 복구 없음 |
| 콜드 재진입 후 다시 준비·이동 없이 종료 | ARMED / 출발 0, GPS 없음 오류를 정직하게 표시. STOPPED / 오류 없음 / 종료 대기 0 |

종료 후 native store의 `revoked=true / value=null`도 확인했다. 로컬 서버 최종 집계는
prepare 2 / departure 1 / activation 1 / cancel 1 / lastState STOPPED,
인증 요청 47 / 거절 0 / 경로 검증 27 / 합성 도착 조회 7이다. 두 번째 세션은 이동 없이 종료했으므로
출발/activation이 추가되지 않았다. trap 요청 0 / trap Authorization 노출 false.

이는 **합성 경로의 첫 도보·대기와 탑승 차단 E2E**다. UI에서 양성 RIDING은 검증하지 못했고
제품 RIDING contract도 아직 미지원이다. 상세 지도 타일은 시험 환경의 오프라인 표시를 보였다.
새 기기의 OS 잠금 Live Activity 표시/제거는 이번에 육안 검증하지 않았다.
실제 APNs provider OFF / provider 시도 0이며 과거 APNs 합격을 이번 결과로 재사용하지 않는다.

첫 빌드는 삭제된 `/private/tmp/nolate-journey-e2e-dependencies-20261003/node_modules`를 참조해 실패했다. `pod install --no-repo-update`로 현재 의존성 경로와 새 Swift source 목록을 재생성한 뒤 일반/진단 빌드 모두 성공했다. 시험용 Info.plist의 진단/인증/background 설정은 빌드에만 적용한 뒤 원래 소스로 복원했고 파일 diff 0을 확인했다. APNs pilot은 OFF다. `.env`와 사용자 데이터는 수정하지 않았다.

## 다음 게이트

1. 공식 구간/방면 근거로 선택 정류장의 두 형상 occurrence를 구별하고, 실제 도보 연결을 확보한다.
2. 그 검증 결과에만 native ride binding을 발급하고, 차량 관측의 원본 시각·TTL을 보존하는 입력 adapter를 연결한다. 사용자 GPS로 차량 좌표를 합성하지 않는다.
3. 검증된 RIDING snapshot을 상세/Live Activity contract에 연결하고, 독립 시뮬레이터에서 두 개의 독립 입력 기록으로 긍정·부정 E2E를 수행한다.
4. 그 후 R3 하차·R5 안내 채널·R6 지하철/환승으로 진행한다. 현재 시험 통과를 후속 단계 완료로 표시하지 않는다.

시험 종료 시 새 기기의 GPS 주입을 해제하고 앱과 로컬 Metro/인증 서버를 종료했다.
8088/15544/15545 listener가 남지 않았고 Info.plist 원복·FE/BE diff check 통과를 재확인했다.
새 시뮬레이터와 기존 P0의 미전달 종료 기록은 삭제하지 않는다. 기존 사용자 데이터·다른 시뮬레이터는 건드리지 않는다.

로그: `/private/tmp/nolate-r2-session-{be,swift,jest,types,qa,config,pods,build-retry,build-optin,harness,metro}-20261008.log`.
