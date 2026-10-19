# R4-3 공급자 저장 경로 사전 검사

기준: 2026-10-11 (Asia/Seoul). 실제 공급자 경로 연결 완료/현장 GPS 합격 기록이 아니다.

## 구현 범위

제품 상세의 기존 Debug opt-in 진입에 읽기 전용 사전 검사를 연결했다.
이전 geometry/topology 검사만으로는 서버가 지원하지 않는 TMAP 버스 경로나 원본 식별자가
없는 경로에도 준비 버튼이 노출될 수 있었다. 서버/native의 차단 자체를 우회할 수 있던 것은 아니다.

- 단일 WALK-BUS-WALK, 저장 ODsay API 형식, 첫·마지막 도보와 버스의 원본 형상 입력을 검사한다.
- 표시 입력과 raw 저장 경로를 같은 bounded builder/context로 비교한다. 별개 경로의 ID를 빌리지 않는다.
  출발/도착은 독립 선택 입력이므로 raw leg 끝점과의 연결도 별도 검사한다.
- 기존 서울 버스 raw namespace/ID/방면/정류장 occurrence 검증기를 재사용한다.
  실제 ride adapter의 9자리 local route ID 조건도 맞춘다. 노선명/표시용 정류장 fallback은 없다.
- 형상 양 끝과 구간 연결을 75m 이내에서 사전 검사한다. 이는 보수적 UI 필터이며 모든 segment,
  형상 모호성·공식 정류장 매핑·실시간 차량·하차 후 도보 admission 검증을 대신하지 않는다.
- 누락 항목별 한국어 설명을 표시하고 검사/동의/준비 버튼을 숨긴다. 이미 진행 중인 소유 안내는
  종료할 수 있으며 다른 일정/회원/입력/세션의 안내는 종료하지 않는다.
- `입력 있음`은 저장된 주장/형식의 존재일 뿐 실제 provider 인증이 아니다.
  항상 서버 소유권·공식 형상·차량·기기 재검증이 필요함을 함께 표시한다.
- 결과에는 좌표/노선·정류장 ID/키/토큰/예외 원문을 넣지 않는다. 네트워크 호출·위치 시작·푸시 기능이 없다.

제품 엔진/BE/native 코드, 운영 기본 OFF, `.env`를 바꾸지 않았다. 기존 미커밋 변경은 보존했다.
ODsay WALK connector는 아직 `geometryInputComplete=false`다. 이 값을 true로 바꾸거나
정류장 직선으로 도보를 만들어 실제 경로를 통과시키지 않았다.

## 자동 검사

| 검사 | 이번 실행 결과 |
| --- | --- |
| FE 전체 Jest | 300 suites / 2,805 PASS |
| Swift | 327 PASS |
| QA Node | 40 PASS |
| TypeScript | PASS |
| git diff --check | PASS |

새 사전 검사 14건, 컴포넌트 차단 2건을 포함한다. 공급자 불일치·missing raw ID·방면·순서·namespace,
불완전 도보·버스 형상·연결 불일치·다른 표시 입력·중복 wrapper·크기 제한·원문 비노출을 검사했다.
hook이 준비 가능이라고 응답해도 사전 검사 실패 시 준비 UI가 생기지 않는 것도 검사한다.
BE 제품 변경이 없어 BE 전체 회귀는 이번 턴에 재실행하지 않았다. Swift는 기존 소스 회귀이며
새 iOS 빌드를 만든 것은 아니다. R4-2에서 설치한 Debug 앱에 새 Metro JS를 로드했다.

초기 검사에서 test helper의 Expo env mock 누락, 독립 endpoint를 raw route 자체 값으로
비교하려던 테스트 전제, React Native composite/host 중복 노드 개수 assertion이 실패했다.
fixture/mock/assertion을 수정하고 최종 전체 회귀를 재실행했다. 실패 실행을 통과 수에 합산하지 않았다.

## 독립 시뮬레이터 E2E

기기: `NoLate R2 Session E2E 20261008` / iOS 26.5 /
`96AF9A48-4721-4335-B7BF-10B9382B7A30`.
`deviceWindow-AppWindow-9`의 분리 창을 직접 조작했다. 툴바의 **Show in Device Hub**로
통합 Hub 미리보기가 아닌 독립 창임을 확인했다. 다른 기기/실기기는 조작하지 않았다.

서버는 test-source loopback harness, 합성 issuer/회원/일정/차량이며 실제 로그인 저장소·DB와 분리했다.
Metro dotenv를 끄고 기본 API를 비동작 loopback으로 설정했다. 실제 APNs provider=false다.
내부 preview는 실제 ScheduleDetail 컴포넌트지만 오프라인 지도이며 실제 타일 시험이 아니다.

1. 지원 형식의 **전체 합성** 저장 경로 상세에서 7개 입력 확인과 서버/native 재검증 필요를 확인했다.
   서버/기기 검사 후 동의·준비→ARMED, 출발 0이었다.
2. 기존 final-walk replay로 승객 CoreLocation GPS만 주입했다. 준비 버튼을 출발 버튼으로 쓰지 않았고
   출발/탑승/하차 phase를 직접 호출하지 않았다. ACTIVE·출발 1/서버 activation 1,
   버스 대기 문구·승차 지점 경로 바 마커·상세 현재 행을 확인했다.
3. 이 slice는 준비/출발 진입 시험이다. replay를 조기 중단하고 GPS 해제 후 상세의 소유 안내를
   정상 종료했다. STOPPED/오류 없음/종료 큐 0/남은 기록 없음을 확인했다. 새 완주 시험으로 집계하지 않는다.
4. 여정 종료를 확인한 후 test fixture만 7016 공개 자료 preview로 변경했다.
   자료는 2026-10-07 공개 관측을 보존한 fixture이며 이번 실제 API 재조회가 아니다.
   상세에서 형식/공급자·도보·버스 형상·원본 식별자·연결 미확보 설명, 준비/동의/검사 버튼 없음을 확인했다.
5. 7016 출발 정류장 부근의 합성 GPS 3점을 주입한 후 해제했다. 새로운 준비/출발/activation이 없고
   STOPPED를 유지했다. 잠금 화면에 Live Activity가 없었다.
6. 같은 서버를 유지한 채 콜드 앱 재진입에서 **IDLE/출발 0/종료 큐 0/오류 없음/남은 기록 없음**을
   확인했다. 개발 클라이언트는 cold launch마다
   8088 Metro 연결을 UI로 선택해야 했다. 이를 제품 배포 빌드의 자동 deep link 복구 합격으로 보지 않는다.

서버 집계: prepare/departure/activation/cancel 각 1, lastState STOPPED,
실제 provider attempts 0, rejected 0, redirect trap 0. 음성/실제 교통 API/실제 APNs 호출은 0이다.
마지막 콜드 확인 후 시험 앱·대상 GPS 주입과 cwd를 확인한 이번 harness/Metro만 종료했다.
실기기·다른 시뮬레이터·기존 8081 서버는 건드리지 않았다. 시험용 native Info.plist는 기존
SHA-256 `7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`와 동일하다.
커밋·push·배포·운영 토글 변경은 하지 않았다.

## 증거

[지원 입력 사전 검사](evidence/journey-r43-provider-preflight-20261011/01-supported-input-preflight.png),
[GPS 전 ARMED](evidence/journey-r43-provider-preflight-20261011/02-armed-before-gps.png),
[GPS ACTIVE·대기·위치 마커](evidence/journey-r43-provider-preflight-20261011/03-gps-active-waiting-detail.png),
[정상 종료·큐 0](evidence/journey-r43-provider-preflight-20261011/04-stopped-zero-queue.png),
[공개 7016 자료 차단](evidence/journey-r43-provider-preflight-20261011/05-public-7016-blocked.png),
[미지원 잠금 카드 없음](evidence/journey-r43-provider-preflight-20261011/06-unsupported-lock-no-activity.png),
[콜드 IDLE·종료 큐 0](evidence/journey-r43-provider-preflight-20261011/07-cold-idle-zero-queue.png).

## 다음 연결 조건

R4 전체 완료가 아니다. 실제 ODsay 저장 경로의 원본 보행 geometry를 별도 adapter로
확보·검증하는 작업과 7016 공식 정류장 occurrence/형상의 유일 매핑 확보가 다음 선행 조건이다.
지금의 공개 정류장 preview나 합성 경로를 실제 지원 경로로 승격하지 않는다.
실제 API를 재검증할 때는 대상/횟수/HTTPS 가능 여부와 키 전송 범위를 확인해야 한다.
기존 평문 HTTP 일회 승인을 자동 재사용하지 않는다. 실제 로그인/지도 타일/현장 GPS,
R5 음성·안내 알림/R6 지하철·환승/배터리/무음 실기기 검증은 남아 있다.
