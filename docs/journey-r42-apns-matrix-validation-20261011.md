# R4-2 원격 Live Activity 단계별 검증

기준: 2026-10-11 (Asia/Seoul). 운영 완료나 실제 대중교통 현장 GPS 합격 기록이 아니다.

## 변경 범위

- 시험 서버에 v1/v2/v3/v4별 **실제 provider 수락** 계수를 추가했다. 합성 sender, 거절,
  END는 UPDATE schema 계수에 포함하지 않는다. payload·위치·토큰은 계수 응답에 넣지 않는다.
- 읽기 전용 `scripts/qa/journey-apns-matrix-check.mjs`는 고정 loopback에서 계수·소유 시험 조건을
  확인한다. 모든 schema/END/STOPPED와 거절·redirect trap 0을 요구하며, 결과가 통과해도
  `deviceDelivery=UNVERIFIED`를 유지한다. 실제 화면 수신은 아래 시각 증거와 별도 판정한다.
- GPS replay의 기본 실제 APNs 차단은 유지했다. `--allow-real-apns`를 명시한 고정 R2 시뮬레이터의
  separation+final-walk 시험에서만 허용한다. 다른 기기/옵션/불완전 fixture는 거부한다.
- 엔진의 출발/탑승/하차/도착 조건, 운영 기본 OFF, `.env`는 바꾸지 않았다.

## 자동 검사

| 검사 | 결과 |
| --- | --- |
| BE journey/liveactivity/transit 최종 회귀 | 61 suites / 446 PASS |
| FE 전체 Jest | 299 suites / 2,789 PASS |
| Swift | 327 PASS |
| QA Node | 40 PASS |
| TypeScript | PASS |
| iOS simulator Debug build | PASS |
| git diff --check | PASS |

서버 신규 테스트는 v1→v2→v3→v4 수락, v4 뒤 END의 terminal schema 정리, reset,
합성/거절/실패를 실제 schema 수락으로 세지 않는 조건을 검사한다. QA 신규 테스트는 누락 단계,
END/STOPPED 누락, 거절·trap, 계수 위조·민감 필드 제거, 고정 주소·redirect·크기 제한,
실제 APNs replay의 명시 opt-in 및 고정 기기 제한을 검사한다.

## 독립 창·전송 격리

`NoLate R2 Session E2E 20261008` / iOS 26.5 /
`96AF9A48-4721-4335-B7BF-10B9382B7A30`, `deviceWindow-AppWindow-9`의 분리된 독립 창만 조작했다.
툴바의 **Show in Device Hub**를 확인했다. Xcode 27 호스트 앱 명칭이 Device Hub인 것과
통합 Hub 미리보기 조작은 구분한다. 다른 시뮬레이터·실기기는 조작하지 않았다.

실제 외부 통신은 기존 승인된 Firebase `nolate-cbdf2`/APNs 시험뿐이다. 서버 자격 증명은 서버에서만
사용하고 허용된 시험 설치 한 대의 FCM SHA-256으로 제한했다. JWT/FCM/APNs 원문을 출력하거나
문서에 저장하지 않았다. 합성 인증은 메모리의 test issuer이며 실제 로그인 저장소/운영 DB와 분리한다.
Metro dotenv는 비활성화했다. 여정·차량·승객 GPS는 합성이며 실제 교통 API를 호출하지 않았다.

## 실행 1: 전체 schema 수락·최종 도보·앱 종료 중 원격 END

1. 실제 APNs 설치 등록 후 provider 연결→저장 경로 검사→10분 한정 시험 동의→준비.
   ARMED는 출발이 아니다. 승객 CoreLocation GPS만 재생하고 서버 차량은 별도 합성 시계로 이동한다.
2. 이동으로 ACTIVE/출발 1회/ACKNOWLEDGED. 출발·탑승·하차·최종 도보 phase를 직접 입력하지 않았다.
3. 잠금 화면에서 v3 **합성 정류장 3 / 정류장 근처 · 하차 준비**와 버스 구간 현재 위치 마커를 확인했다.
   실제 provider 시험이 요청된 동안 최초 Activity 생성 이후 로컬 `Activity.update`는 차단된다.
   따라서 최초 카드 생성 자체와 원격 변경 수신을 구분한다.
4. 근거가 불확실해지면 **위치 확인 중**, 현재 위치 마커 숨김을 확인했다.
5. 같은 잠금 화면에서 v4 **목적지까지 / 도보 약 70m→50m** 및 마지막 도보 구간 마커를 확인했다.
6. 목적지 도착 전에 replay를 중단하고 앱을 종료했다. GPS를 해제했으며 앱 종료 뒤에도
   최종 도보 카드가 남은 것을 촬영했다. 이 실행은 자동 도착 완주 시험이 아니라 원격 END 격리 시험이다.
7. 앱을 다시 열기 **전에** 고정 시험 lane의 서버 END를 보냈다. provider 수락 후 잠금 카드가 제거됐다.
   로컬 종료 동작으로 원격 END 성공을 대신하지 않았다. 중복 END는 `duplicate=true`, 추가 전송 0이다.
8. 콜드 시작은 IDLE/출발 0/차량·분리·최종 도보 근거 0/서버 종료 큐 0,
   **종료 확인 · 자동 정리 완료**다. 자동 재활성은 없다.

실행 1 수락: UPDATE v1 **9**, v2 **4**, v3 **15**, v4 **7**, END **1**.
attempts/accepted **36/36**, rejected **0**, trap **0**, authorization trap **false**,
prepare/departure/activation/cancel 각 **1**, lastState **STOPPED**.
[Provider 계수](evidence/journey-r42-apns-matrix-20261011/provider-run-1.json)는 화면 수신을 스스로 증명하지 않는다.
v1/v2 잠금 화면은 보충 실행과 별도 기록한다.

## 실행 2: 초기 단계 잠금 화면 보충

실행 1 종료·콜드 정리 확인 후 loopback fixture만 reset하고 같은 설치에서 새 동의/준비를 수행했다.
실행 간 계수를 섞거나 실행 2를 두 번째 완주로 집계하지 않는다.
CUA 잠금 화면에서 v1 **합성 정류장 1 / 버스 대기 · 도착하면 탑승 준비**,
승차 지점 마커와 합성 버스 도착정보를 확인했다. 파일 캡처 시점에는 이미 불확실 위치로
바뀌었으므로 해당 파일을 대기 화면 증거로 사용하지 않는다.
이 실행에서 reset이 ride opt-in을 유지하면서도 저장 계획을 기본 매핑으로 바꾸는 harness 오류를 발견했다.
버스 binding을 검증할 수 없어 엔진은 잘못 탑승하지 않고 안내를 제한했다.
UPDATE v1 10회/다른 schema 0회, 원격 END 1회 후 시험 앱·GPS를 종료했다. 성공 완주가 아니다.
reset에 활성 ride 계획 선택과 차량 시계/모드/조회 계수 초기화를 연결했다.
계획 보존/기본 계획 분리 회귀 2건을 추가하고 최종 관련 446건을 통과했다.
수정 서버에서 POST reset 후 저장 경로와 navigationEvidence의 synthetic route ID 보존도 확인했다.

### 보충 재개 시의 별도 차단

실행 2의 원격 END 수락 후 시험 harness JVM을 재시작해 메모리 전용 세션 기록이 사라졌다.
앱은 이전 checkpoint를 서버에서 확인할 수 없어 **IDLE / 종료 큐 0 / AUTOMATIC_SERVER_REJECTED /
확인 불가 · 기록 보존**으로 차단했다. 준비를 우회하지 않았고 위치 추적/Activity 재활성도 없다.
이는 실행 1의 같은 서버에서 확인한 콜드 정리 성공과 구분한다.
해당 시험 기록만 백업/초기화할 사용자 승인을 받았고, 아래 실행 3/4로 보충했다.
메모리 fixture 초기화를 운영 서버의 durable 종료 동기화 검증으로 해석하지 않는다.

## 승인된 시험 기록 정리·실행 3/4 보충 결과

시험 앱을 종료하고 AsyncStorage manifest와 해당 native checkpoint를
`/private/tmp/nolate-r42-approved-reset.40frr1`에 백업했다. 시험 여정 binding만 비우고
해당 checkpoint만 백업 위치로 이동했다. 종료 outbox는 원래 비어 있었다.
다른 저장 값의 key 수와 값이 모두 동일한 것을 비교했다. 로그인·일정·다른 기기 데이터는
삭제하지 않았다. 백업은 저장 정보가 포함될 수 있어 저장소/문서 첨부로 복사하지 않는다.
이 수동 시험 격리를 제품의 자동 복구 합격으로 계산하지 않는다.

- 실행 3: 수정 서버 reset 뒤 버스 매핑 유지, 새 동의/준비, GPS 출발을 확인했다.
  v1 대기 화면은 CUA로 관찰했으나 파일 캡처는 이미 불확실 위치 상태였다.
  해당 파일은 대기/탑승 증거로 사용하지 않는다. 수락은 v1 9/v2 2/v3 16/v4 2/END 1,
  attempts/accepted 30/30, 거절·trap 0, STOPPED다. 앱 종료 중 END 후 같은 서버를 유지한
  콜드 시작에서 **종료 확인·자동 정리 완료 / IDLE / 종료 큐 0 / 오류 없음**을 확인했다.
- 실행 4: 콜드 정리를 확인한 후 fixture reset, 동일 설치 등록·provider 연결·검사/동의/준비.
  출발은 GPS 이동으로 1회 감지됐다. 독립 창에서 잠근 뒤 읽기 전용 계수 관측에 맞춰
  캡처를 저장했다. phase 전환 API나 `simctl push`는 사용하지 않았다.
  v1 **합성 정류장 1 / 버스 대기 · 도착하면 탑승 준비**, 승차 지점 마커와
  v2 **합성 버스 / 버스로 이동 중**, 버스 구간 중간 마커를 파일·독립 창으로 확인했다.
  도착정보가 확인되지 않은 화면에 임의의 대기 시간을 만들지 않았다.
  최초 Activity 생성 이후 로컬 UPDATE 차단 조건은 그대로 유지했다.
- 실행 4 수락은 v1 7/v2 4/v3 3/v4 0/END 1, attempts/accepted 15/15,
  거절·trap 0, authorization trap false, STOPPED다. v2 보충 목적의 단축 시험이므로
  matrix 도구의 `INCOMPLETE`가 정상이며 두 번째 전체 완주라고 주장하지 않는다.
- 실행 4에서도 GPS replay 중단→앱 종료→GPS 해제 후 카드 잔존을 촬영했다.
  앱을 다시 열기 전에 원격 END로 카드가 사라졌다. 중복 END는 duplicate=true이며
  전송 계수가 증가하지 않았다. 같은 서버가 살아 있는 동안 콜드 시작해
  **종료 확인·자동 정리 완료 / IDLE / 출발 0 / 종료 큐 0 / 오류 없음**을 확인했다.

이번 승인 후 QA Node **40 PASS**, TypeScript **PASS**를 재실행했다.
서버 APNs pilot 26건과 harness reset 2건도 재실행해 **28 PASS / 실패·오류·skip 0**을 확인했다.
위 표의 FE 전체/Swift/iOS 빌드/BE 전체 결과는 앞선 같은 변경 세트의 회귀 결과이며
이번 기록 정리만으로 전체 테스트를 다시 실행했다고 계산하지 않는다.
중복 캡처 프레임은 위 임시 백업 위치로 옮겨 복구 가능하게 보존했다.

## 실패·복구 이력

- 새 시험 빌드에서 `APNS_TEST_TOKEN_NOT_READY`가 반복됐다. 시험 기기만 재시작한 뒤 실제 등록이
  정상화됐다. 원인을 확정하지 않았으며 임의 APNs 토큰이나 `simctl push`로 대체하지 않았다.
- simulator의 `*-Simulated.xcent`에는 `aps-environment=development`가 있었다.
  이를 일반 codesign entitlement로 직접 적용한 실험은 앱 launch 거절로 실패했다.
  일반 ad-hoc 재서명으로 되돌린 뒤 재시작·등록·실제 수신을 검증했다. 이 우회 실험을 제품 설정에 반영하지 않았다.
- 잠금 메뉴 AX 인덱스 무효/잘못 반영(Siri), 자동화 pipe 오류가 있었다. 독립 창 Raise 후
  잠금 단축키를 사용했고 실제 iOS 잠금 화면과 카드의 변경을 화면으로 확인했다.
  AX의 이전 앱 텍스트만으로 잠금 성공을 판정하지 않았다.
- Metro에 기존 split-module/개발 Keychain 경고가 관측됐다. 이번 합성 인증은 authStorage를
  사용하지 않는다. 실제 로그인·Keychain·배포 빌드의 합격으로 확대 해석하지 않는다.

## 증거

[준비/provider](evidence/journey-r42-apns-matrix-20261011/01-armed-provider.png),
[원격 하차 준비](evidence/journey-r42-apns-matrix-20261011/02-remote-v3-locked.png),
[불확실 위치 숨김](evidence/journey-r42-apns-matrix-20261011/03-remote-unreliable-locked.png),
[원격 최종 도보](evidence/journey-r42-apns-matrix-20261011/04-remote-v4-locked.png),
[앱 종료 후 END 전 카드](evidence/journey-r42-apns-matrix-20261011/05-terminated-card-before-end.png),
[앱 종료 중 END 후 제거](evidence/journey-r42-apns-matrix-20261011/06-remote-end-app-terminated.png),
[콜드 정리·큐 0](evidence/journey-r42-apns-matrix-20261011/07-cold-idle-zero-queue.png),
[보충 불확실 위치](evidence/journey-r42-apns-matrix-20261011/08-supplement-remote-unreliable.png),
[reset 매핑 실패](evidence/journey-r42-apns-matrix-20261011/09-reset-mapping-failure-unreliable.png),
[재시작 fixture 기록 확인 차단](evidence/journey-r42-apns-matrix-20261011/10-restarted-fixture-checkpoint-blocked.png),
[실행 3 불확실 위치](evidence/journey-r42-apns-matrix-20261011/11-approved-run3-unreliable-locked.png),
[실행 3 콜드 정리](evidence/journey-r42-apns-matrix-20261011/12-approved-run3-cold-cleared.png),
[실행 4 v1 버스 대기](evidence/journey-r42-apns-matrix-20261011/15-run4-v1-waiting-locked.png),
[실행 4 v2 버스 이동](evidence/journey-r42-apns-matrix-20261011/14-run4-v2-riding-locked.png),
[실행 4 앱 종료 후 END 전](evidence/journey-r42-apns-matrix-20261011/16-run4-terminated-before-end.png),
[실행 4 원격 END 제거](evidence/journey-r42-apns-matrix-20261011/17-run4-remote-end-removed.png),
[실행 4 콜드 IDLE·큐 0](evidence/journey-r42-apns-matrix-20261011/18-run4-cold-idle-zero-queue.png),
[실행 3/4 분리 계수](evidence/journey-r42-apns-matrix-20261011/provider-supplement-runs.json).

## 남은 게이트

R4 전체 완료가 아니다. 실제 로그인·공급자 경로의 상세 진입, 실제 도보 geometry/지도 타일,
실제 계정 Keychain·서명/프로비저닝·APNs 환경, 실기기 배터리·무음·백그라운드 현장 GPS는 별도다.
R5 음성/안내 알림과 R6 지하철/환승도 미완료다. 이번 schema별 계수는 test harness에만 존재하며
운영 원격 전송 시스템/장애 복구 전체 구현을 뜻하지 않는다.

마무리: 대상 GPS 주입을 해제하고 cwd를 확인한 이번 harness/Metro만 종료했다.
승인된 이전 시험 checkpoint는 백업 후 격리했고, 새 실행 3/4 checkpoint는 서버 종료 확인으로
자동 정리됐다. 다른 기기·로그인·일정 데이터는 삭제하지 않았다.
시험 빌드용 Info.plist opt-in/배경 모드 임시 변경은 원복했고 원래 SHA-256
`7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`와 일치한다.
`.env` 변경·운영 배포·커밋·push는 하지 않았다.
