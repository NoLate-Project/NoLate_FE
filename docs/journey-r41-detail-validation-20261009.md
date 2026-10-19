# R4-1 상세 진입·지원 범위 연결 검증

날짜: 2026-10-09 (Asia/Seoul). R4 전체 완료나 실제 대중교통 현장 합격이 아니다.

## 구현 범위

- 기존 제품 상세의 iOS Debug 인증 opt-in 진입을 보강했다. 운영 기본 OFF, `.env`·네이티브 기본 설정 변경 없음.
- 진입 사전 검사에서 도보→버스 1회→도보 외의 지하철/환승, 좌표 누락, 공급자/운행 상태 불명,
  불완전 geometry에 대해 한국어 차단 사유를 보여준다. 검사·동의·준비 동작을 숨긴다.
  이 사전 검사는 길이/연결성/정류장 매핑/실시간 차량을 검증하는 서버/native의 권한을 대체하지 않는다.
- 준비는 ARMED일 뿐 출발이 아니다. 출발/탑승/하차/단계 전환 버튼을 추가하지 않았다.
- 열린 상세와 카드/현재 행이 binding 변경을 구독한다. 첫 GPS 이벤트 전에도 준비 표시가 갱신된다.
- 종료 버튼은 동일 경로 입력·일정·세션·scope·인증 회원에만 제공하고 누를 때 다시 검사한다.
  다른 경로가 진행 중이면 이를 설명하며 현재 화면에서 변경/종료하지 않는다.
- 명시적인 내부 preview에만 합성 인증 source를 주입한다. 실제 로그인 저장소에 시험 JWT를 넣지 않는다.
- 미리보기는 저장 경로의 권위 있는 변경이 아니다. 미리보기 진입으로 기존 안내를 무효화하지 않는다.
  실제 일정 저장 변경에 대한 기존 revalidation은 유지한다.

## 자동 검사

| 검사 | 결과 |
| --- | --- |
| FE 전체 Jest | 299 suites / 2,789 PASS |
| TypeScript | PASS |
| Swift 회귀 | 327 PASS |
| QA Node tests | 34 PASS |
| git diff --check | PASS |

명령: `npm test -- --runInBand --no-watchman`, `npm run typecheck`,
`swift test` (`modules/nolate-live-activity`),
`node --test scripts/qa/*.test.mjs scripts/journey-diagnostics-config.test.mjs`.
신규 검사는 지원 전제/차단 사유, 열린 카드의 binding 생성/정리, 타 일정/입력/세션/scope/회원 종료 차단,
클릭 직전 소유권 변경, preview의 authoritative-update 제외를 포함한다.
네이티브 소스 변경이 없어 R3-4에서 빌드·설치한 Debug 앱에 이번 Metro JS를 로드했다.
이번 turn에 새 Xcode 빌드를 수행한 것으로 집계하지 않는다.

## 독립 창 E2E

기기: `NoLate R2 Session E2E 20261008` / iOS 26.5 /
`96AF9A48-4721-4335-B7BF-10B9382B7A30`.
UI: `deviceWindow-AppWindow-9`, 툴바에 **Show in Device Hub**가 있는 분리된 창에서만 조작했다.
새 Xcode의 앱 이름은 Device Hub지만 통합 Hub의 기기 미리보기는 조작하지 않았다.

합성 인증 harness `127.0.0.1:15544`, 실제 push provider=false.
Metro는 dotenv를 비활성화하고 실제 API 기본 주소 대신 비동작 로컬 주소를 사용했다.
내부 진입 URL: `nolate:///internal/journey-guidance?authenticated=1&renewToken=1&showDetail=1`.
preview는 **실제 ScheduleDetail 컴포넌트**를 사용하지만 실제 로그인/운영 일정/지도 타일은 아니다.

수정 후 검증:

1. 상세 화면 자체에서 경로 검사→시험 동의→위치 안내 준비. 출발 대기/ARMED가 즉시 표시된다.
2. 기존 `journey-final-walk-location-replay.mjs --device …`로 CoreLocation 승객 GPS만 주입한다.
   서버 차량은 별도 합성 시계로 움직인다. 출발/탑승/최종 도보/도착 phase를 강제로 입력하지 않는다.
3. 미지원 지하철 상세로 이동: 미지원 사유·다른 경로 안내 중 표시, 준비/종료 버튼 없음.
   원래 상세로 복귀하면 ACTIVE 안내가 유지된다. 새 prepare 없이 같은 여정을 계속한다.
4. 첫 도보의 승차 지점 접근, 버스 구간 마커·현재 행·다음 정류장 잔여 거리·하차 준비 표시 확인.
5. 축소 상세의 오프라인 지도 위치 점을 CUA 화면에서 확인했다. 이후 파일 캡처 시점에는 위치가
   불확실해 점이 숨겨져 있어 `map-position-unavailable.png`로 기록했다. 실제 지도 타일 합격이 아니다.
6. 분리+연속 최종 도보 이후 마지막 구간 마커·현재 행, 목적지 도보 약 90m→30m 확인.
   저장된 최종 도보 스크린샷은 촬영 시점의 **50m**를 표시한다.
7. 종료 버튼 없이 목적지 체류→STOPPED / DESTINATION_ARRIVED, 오류 없음·서버 종료 대기 0건.
   일정 완료 처리는 하지 않는다. 상세의 진행 카드/현재 위치 표시가 사라진다.
8. 창 활성화 후 잠금 메뉴를 다시 조작해 종료 후 잠금 화면에 카드가 남지 않은 것을 확인했다.
9. 콜드 재시작→IDLE / 출발 0 / 탑승·분리·최종 도보·목적지 체류 근거 0 / 종료 큐 0.

최종 harness 집계는 prepare 2 / departure 2 / activation 2 / cancel 2 / lastState STOPPED,
rejected 0 / redirect trap 0 / 실제 push provider attempt 0이다.
첫 실패 실행과 재시험의 누적값이므로 두 번의 정상 완주로 해석하지 않는다.
재시험 replay는 완료 후 GPS 주입을 해제했다. 이 turn의 실제 교통 공급자/APNs 호출은 없다.

## 실패·재시험 이력

- 초기 단위검사의 배열 `it.each` 형식이 done callback으로 잘못 해석되고, 비동기 UI 테스트의
  잔여 one-shot timer assertion이 실패했다. 테스트 구조를 수정하고 최종 전체 회귀 2,789건을 통과했다.
- 첫 E2E에서 미지원 preview를 열자 controller가 이를 동일 저장 일정의 경로 수정으로 오인해
  정상 안내를 종료했다. preview를 authoritative revalidation에서 제외했다. 해당 replay는 중단하고
  GPS를 해제했으며 성공으로 집계하지 않았다. 수정 JS를 캐시 초기화해 로드한 뒤 새 세션으로 완주했다.
- 최종 도보 중 잠금 메뉴의 AX ID가 무효화돼 활성 잠금 카드 재확인은 이번 실행에서 실패했다.
  메뉴 취소·창 Raise 후 **종료 후 잠금 화면**은 재확인했다. 활성 카드/잠금 상태 완주의 이전
  R3-4 성공 결과와 이번 결과를 합쳐 새 성공으로 주장하지 않는다.

## 증거·후속 게이트

[준비 상세](evidence/journey-r41-detail-20261009/prepared-detail.png),
[첫 도보](evidence/journey-r41-detail-20261009/first-walk-detail.png)는 초기 실행의 표시 증거다.
수정 후 [미지원/다른 세션 차단](evidence/journey-r41-detail-20261009/unsupported-other-session.png),
[버스 하차 준비](evidence/journey-r41-detail-20261009/bus-detail.png),
[불확실 위치 숨김](evidence/journey-r41-detail-20261009/map-position-unavailable.png),
[최종 도보 50m](evidence/journey-r41-detail-20261009/final-walk-detail.png),
[도착·큐 0](evidence/journey-r41-detail-20261009/arrived-queue-empty.png),
[종료 후 잠금 화면](evidence/journey-r41-detail-20261009/lock-after-arrival.png),
[콜드 IDLE](evidence/journey-r41-detail-20261009/cold-idle.png).

R4 후속 게이트는 실제 로그인/지원 가능한 공급자 경로의 상세 진입, 실제 지도 타일과 geometry,
schema v2/v3/v4 원격 APNs update/end 및 활성 잠금 카드 재검증이다.
실제 도보 geometry가 없는 경로를 표시용 연결선으로 통과시키지 않는다.
R5 음성/알림·R6 지하철/환승과 실기기 현장 GPS는 여전히 미완료다.
