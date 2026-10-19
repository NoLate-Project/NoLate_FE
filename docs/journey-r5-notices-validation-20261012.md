# R5 안내 이벤트·채널 검증

기준: 2026-10-12 (Asia/Seoul). 단일 합성 WALK-BUS-WALK의 Debug 시뮬레이터 구현이다.
전체 대중교통 내비게이션/R5 전체/실기기/지하철·환승 완료 보고가 아니다.

## 승인 후 보강 결과 (같은 날 후속 실행)

이 절은 아래 최초 실행의 권한 판정과 시험 개수를 보정한다. 최초 실행의
`VOICE_QUEUED_NOTIFICATION_DENIED`는 **OS 거부를 증명하지 않는다**. 실제 시스템 요청에서
미요청 상태가 확인됐고, 기존 코드가 미요청/거부를 혼동한 것이었다. 시험 기기 한정 승인 후
명시적 요청 버튼에서 시스템 ‘허용’을 눌렀고 `PERMISSION_GRANTED`를 확인했다.
자동 요청/실기기 권한 변경은 없었다. 이후 native는 미요청을
`VOICE_QUEUED_PERMISSION_REQUIRED`로 별도 표시한다.

- `JourneyNoticeControls`는 실행 전 명시적 권한 요청·자체 앱 설정·안내 채널 선택을 제공한다.
  렌더링 중 요청/토큰 등록/로그인 저장소 조회는 하지 않고 중복 탭과 실행 중 변경을 막는다.
- OS 권한과 잠금/alert 설정을 고정 코드로만 진단한다. 승인만으로 실제 표시를 합격 처리하지 않는다.
- 합성 ride harness의 도착정보가 다른 노선 ID를 반환하는 오류를 수정했다. 소유 경로와
  동일한 합성 providerRouteId를 사용하되 도착 차량은 탑승 판정 차량과 계속 분리한다.
- 출발 전에 잠그면 Activity가 생성되지 않는 E2E 실패를 발견했다. 이제 **로컬 모드만**
  전경 준비 시 `출발 대기` 카드를 만든다. 준비는 ARMED/출발 0이며 GPS 마커·안내 이벤트가 없다.
  대기 카드 수명은 서버 lease이고, 실제 ACTIVE 위치 TTL 15초를 늘리지 않는다.
  원격 APNs pilot는 ACTIVE/신선한 위치 시작 조건을 유지하고 로컬 UPDATE도 계속 차단한다.
- 준비의 schema/상태/미확정/관측 없음/전체 topology/lease를 검사하고, 만료·stale·조작된
  준비 입력·백그라운드 생성·remote pilot 준비 생성은 거절한다. 콜드 종료 정리도 유지한다.

최종 자동 검사: FE **304 suites / 2,854 PASS**, Swift **342 PASS**, QA Node **46 PASS**,
TypeScript PASS, iOS Debug simulator build PASS. BE는 journey/transit/Live Activity 관련
**55 suites / 396 PASS, 실패·오류·skip 0**이며 BE 전체 테스트라고 집계하지 않는다.
QA 46건은 `scripts/qa/*.test.mjs` 38건과 `scripts/journey-diagnostics-config.test.mjs` 8건의 합이다.

승인 후 첫 잠금 GPS 완주에서는 알림 접수 5/음성 큐 0, 목적지 자동 종료/서버 종료 대기 0을
확인했지만, 출발 전에 잠가 Activity 시작 실패가 있었다. 수정 후 두 번째 완주에서는
출발 전 잠금 READY→GPS 도보/위치 마커→버스/위치 불확실 시 마커 숨김→최종 도보 80m→
자동 도착 카드 제거, STOPPED/출발 1/알림 접수 5/음성 큐 0/종료 큐 0/남은 기록 없음을 확인했다.
별도 안내 알림의 잠금 화면 표시는 캡처에서 확인되지 않았다. **접수 5건을 표시 합격으로
승격하지 않는다.** 최종 진단 빌드에서 `AUTHORIZED_LOCK_ON_ALERT_ON`을 확인해 권한 미요청과
표시 미검증을 구분했다. 실제 APNs는 이번 실행 0건(provider=false)이며 이전 R4-2 결과와 별개다.
최종 진단 빌드/Metro 캐시 초기화 후 세 번째 잠금 GPS 완주에서도 출발 1/알림 접수 5/
음성 큐 0/자동 도착/오류 없음/종료 대기 0/남은 기록 없음을 확인했다. 서버 누적
prepare/departure/activation/cancel 각 3건, rejected/trap/실제 provider 전송 각 0건이다.
최종 화면의 OS 설정도 `AUTHORIZED_LOCK_ON_ALERT_ON`이었다. 별도 알림 표시 문제를
단순 권한 OFF로 돌리지 않으며 알림 센터/요약·집중/foreground delegate 등 원인은 아직 미확정이다.

[출발 전 대기 카드](evidence/journey-r5-notices-20261012/09-prepared-before-departure.png),
[잠금 출발 후 도보 마커](evidence/journey-r5-notices-20261012/10-locked-before-departure-walk-marker.png),
[잠금 정류장 대기·ETA](evidence/journey-r5-notices-20261012/11-locked-waiting-arrival-information.png),
[최종 빌드 한 정류장 전](evidence/journey-r5-notices-20261012/12-locked-one-stop-before.png),
[최종 도보](evidence/journey-r5-notices-20261012/13-locked-final-walk.png),
[자동 도착 카드 제거](evidence/journey-r5-notices-20261012/14-locked-auto-arrival-cleared.png),
[최종 빌드 OS 허용·자동 종료·큐 0](evidence/journey-r5-notices-20261012/15-final-build-stopped-authorized-zero-queue.png).

최종 콜드 진입에서 IDLE/OFF/알림·음성 계수 0/종료 큐 0/남은 기록 없음을 확인했다.
[콜드 재시작 정리 증거](evidence/journey-r5-notices-20261012/16-final-cold-off-zero-queue.png).
대상 GPS 주입과 시험 앱을 종료하고 cwd/PID 확인 후 이번 8088 Metro/15544 harness만 종료했다.
캡처 프로세스도 정상 종료했으며 Info.plist는 아래 기존 SHA와 동일하다.

알림 권한/표시 설정의 구분은 Apple의
[알림 권한 요청 문서](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications?language=objc)와
[알림 설정 안내](https://support.apple.com/guide/iphone/iph7c3d96bab/ios)도 참고한다.

실제 7016 공식 목록/형상 승인된 HTTP 각 1회(총 2회)는 성공했다. 정류장 106개,
shape 1,693점/선택 44–48번 5개를 받았으나 `STOP_SHAPE_AMBIGUOUS / OCCURRENCE_SPAN`,
진단 순서 98/후보 passage 1이었다. 전체 목록 공개 번호 오류 1개(선택 구간 0개)도 진단했다.
`navigationReady=false`, 정류장/section crosswalk 미검증을 유지한다. 임계치를 늘리거나
해당 정류장을 버려 실제 안내로 승격하지 않았다. 원문/키/좌표는 출력·파일 보존하지 않았고
리다이렉트·재시도는 없었다. **이번 2회 승인은 소모됐으며 추가 평문 요청에 재사용하지 않는다.**

남은 작업은 잠금 안내 알림 실제 표시 원인/만료·취소 검증, 실제 매핑의 유일성,
서버 소유 mixed-provider 도보 계약, R6 지하철·환승 구현, 제품 설정/실기기 실행 경로와
현장 GPS·오디오/배터리 시험이다. 따라서 기능 전체 완료 또는 R1–R6 완료 보고가 아니다.

## 구현

- 상세와 Live Activity가 쓰는 동일한 신선한 확정 위치 projection으로 이벤트를 추출한다.
  출발, 2분 이내 도착 예상, 탑승 확정, 한 정류장 전, 목표 정류장 근접, 최종 도보를 구분한다.
  GPS 속도나 클릭만으로 탑승·하차를 확정하지 않는다. 도착 예상은 탑승 증거가 아니다.
- session/generation/revision/digest별 이벤트를 한 번만 안내한다. 시계·sequence·원본 관측
  역행과 단계 퇴행을 거절하며 근접 안내 후 이전 단계 음성을 대기열에서 재생하지 않는다.
  만료는 원래 GPS TTL과 10초 중 이른 시각이다. 서버 소유권 검증/출발 ACK 전에는 안내하지 않는다.
- 시험 채널은 OFF/NOTIFICATIONS/VOICE_AND_NOTIFICATIONS. 콜드 시작은 항상 OFF이고
  실행 중 채널 변경은 차단한다. 설정은 메모리 전용이며 제품 기본값을 켜지 않는다.
- 기존 알림 권한을 조회할 뿐 요청하지 않는다. 거부 상태는 명시적인 진단으로 반환한다.
  알림 ID는 binding+kind 해시이며 자체 안내 알림만 취소한다. 다른 일정 알람은 삭제하지 않는다.
- 전경 음성은 기존 AVSpeechSynthesizer·audio lease를 재사용하며 ambient로 무음을 존중한다.
  다른 오디오/통화 성격의 세션은 점유하지 않고, 음성 큐 생성 시 같은 알림의 소리는 생략한다.
  잠금/백그라운드에서는 음성을 새로 시작하지 않고 알림을 사용한다. 무음 스위치를
  secondaryAudioShouldBeSilencedHint로 추정하지 않는다.
- 단계/소유 binding 변경, 위치 근거 소실, 종료, 10초 만료에 자신의 알림·음성만 취소한다.
  비동기 notification settings/add 콜백도 epoch·binding·만료 fence를 다시 검사한다.
- UI 접수/음성 큐 계수는 제한된 정수로 정규화한다. 알림 접수는 실제 표시/청취 증명이 아니다.
  좌표·토큰·원문 알림 본문·예외는 진단 출력에 추가하지 않는다.

음성/안내 채널의 native 연결은 기존 자동 runtime과 마찬가지로 Debug simulator-only다.
제품 상세의 사용자 설정 연결, 실제 공급자 경로 연결, 잠금 음성, 지하철·환승·현장 시험은 남는다.
도착 시 현재 구현은 안내를 종료/정리하며 별도 도착 음성 이벤트를 재생하지 않는다.

## 자동 검사

| 검사 | 결과 |
| --- | --- |
| FE 전체 Jest | 303 suites / 2,844 PASS |
| Swift 전체 | 338 PASS (안내 정책 11건 포함) |
| QA Node | 46 PASS (실제 pedestrian probe의 오프라인 계약 6건 포함) |
| TypeScript | PASS |
| iOS Debug simulator build | PASS |

새 정책은 중복·불확실/만료/미확정 상태·도착 ETA·확정 탑승·안내 우선순위·단계 퇴행·
시각/sequence/관측 역행·세션 교체·이름 정제·지원 topology·10초/GPS TTL 경계를 검사했다.
이번 BE 제품 코드는 바꾸지 않았으며 BE 전체 회귀는 재실행하지 않았다.

## 독립 창 E2E

대상은 `NoLate R2 Session E2E 20261008` / iOS 26.5 /
`96AF9A48-4721-4335-B7BF-10B9382B7A30`, `deviceWindow-AppWindow-9`이다.
툴바 **Show in Device Hub**를 확인한 분리 창만 직접 조작했다. 다른 시뮬레이터/실기기는 건드리지 않았다.
loopback 인증 harness의 합성 회원/차량과 CoreLocation 승객 좌표만 사용했으며 단계 전환 호출은 없다.
실제 APNs provider=false이며 운영 DB/로그인 저장소와 분리돼 있다.

첫 실행에서 안내 채널 선택→서버 검사/위치 동의→ARMED(출발 0)→GPS ACTIVE(출발 1/ACK)를 확인했다.
합성 차량 동행으로 RIDING, 한 정류장 전/근접 안내, 차량 분리+연속 도보로 FINAL_WALK,
목적지 연속 체류로 STOPPED/DESTINATION_ARRIVED·서버 종료 대기 0건·남은 checkpoint 없음이었다.
음성 큐 4건, 알림 접수 0건이었다. OS 알림 권한이 거부된 상태여서
`VOICE_QUEUED_NOTIFICATION_DENIED`를 확인했다. 실제 알림 표시/음성 청취 합격으로 집계하지 않는다.
새 빌드 콜드 진입에서 IDLE·OFF·알림/음성 계수 0·종료 큐 0건도 확인했다.

단계 전환/만료 fence 보강 빌드로 두 번째 GPS 완주를 재실행했다. 출발 ACK→확정 버스 이동→
한 정류장 전에서 음성 큐 2건/`NOTICE_EXPIRED`를 확인했다. 근접 안내 후 음성 큐 3건에서
독립 창을 잠갔다. 잠금 카드가 버스 근접→최종 도보 70m→10m로 갱신됐고 자동 도착 후 제거됐다.
잠금 해제 후 STOPPED/목적지 도착·오류 없음/종료 큐 0/남은 checkpoint 없음을 확인했다.
음성 큐는 3건을 유지해 잠금 중 최종 도보 음성이나 해제 후 과거 음성을 추가 재생하지 않았다.
알림 접수는 0건으로 유지됐다. 실제 청취/알림 표시 및 실제 알림 만료 제거는 여전히 미검증이다.
서버 누적 prepare/departure/activation/cancel 각 2건, 마지막 STOPPED,
provider attempts/rejected/trap 각 0건이다. 실제 APNs가 아닌 로컬 Activity의 잠금 표시다.
최종 콜드 재진입에서도 IDLE/OFF/알림·음성 계수 0/서버 종료 큐 0/남은 기록 없음을 확인했다.
읽기 전용 readiness 검사도 `OBSERVED_EXPECTATION_MET`, APNs/제품 내비게이션은 UNVERIFIED였다.
권한 거부 상태를 임의로 변경하지 않고 시험 시뮬레이터에 한정한 허용 여부를 요청했다.

[첫 실행 권한 거부·음성 큐](evidence/journey-r5-notices-20261012/01-voice-queued-permission-denied.png),
[첫 실행 도착 종료](evidence/journey-r5-notices-20261012/02-first-replay-arrival-cleanup.png),
[수정 빌드 안내 만료](evidence/journey-r5-notices-20261012/03-final-build-notice-expired.png),
[잠금 버스 근접 카드](evidence/journey-r5-notices-20261012/04-final-build-lock-near-stop.png),
[잠금 최종 도보 카드](evidence/journey-r5-notices-20261012/05-final-build-lock-final-walk.png),
[도착 후 잠금 카드 제거](evidence/journey-r5-notices-20261012/06-final-build-lock-arrival-cleared.png),
[해제 후 종료·음성 큐 3 유지](evidence/journey-r5-notices-20261012/07-final-build-stopped-zero-queue.png),
[최종 콜드 OFF·큐 0](evidence/journey-r5-notices-20261012/08-final-cold-off-zero-queue.png).

## 실제 도보 공급자 제한 검증

`journey-pedestrian-provider-probe.mjs --allow-provider-tmap`로 공개 서울시청 주변 고정 출발/도착의
HTTPS 요청 1회만 수행했다. 키는 원래 FE `.env`에서 프로세스 내부로만 읽었다.
리다이렉트/재시도 없음, 12초 제한/1MiB 제한이며 원본 응답/좌표/키는 파일로 보존하거나 출력하지 않았다.
원본 parser 결과는 `RAW_GEOMETRY_CANDIDATE`, LineString 2개/원본 점 6개/경계 중복 축약 후 5개였다.
`navigationReady=false`를 유지한다. 이 실제 응답은 합성 여정 E2E의 형상으로 사용하지 않았다.
서버 소유의 mixed-provider provenance/revision/TTL 계약이 없으므로 저장 ODsay 경로에 붙여
실제 안내 가능으로 승격하지 않았다.

공식 `ws.bus.go.kr` HTTPS에는 자격 증명 없는 제한 조회 1회를 수행했으나 연결 실패했다.
평문 HTTP로 자동 전환하지 않았다. 이전 평문 키 전송 승인은 소모됐으므로 공식 정류장/형상
각 1회, 총 최대 2회의 새 승인 요청을 남겼다. 실제 버스 유일 매핑 게이트는 해소되지 않았다.

## 남은 완료 조건

1. OS 알림 허용 후 잠금 표시·만료/단계 전환·종료 취소 E2E. 현재 거부 분기만 확인했다.
2. 실제 버스 매핑 유일성, 서버 소유 혼합 공급자 도보 계약, 실제 로그인/지도 타일 연결.
3. R6 열차/방면/역·탑승 근거·터널 불확실성·환승 도보/다음 구간 구현 및 E2E.
4. 사용자 음성 선택 UI/제품 설정, 기존 알람과 실제 오디오 충돌, 무음/잠금/배터리·현장 GPS 시험.

Apple의 [오디오 세션 범주](https://developer.apple.com/library/archive/documentation/Audio/Conceptual/AudioSessionProgrammingGuide/AudioSessionCategoriesandModes/AudioSessionCategoriesandModes.html)는
ambient가 무음/잠금 시 묵음임을 설명한다. [secondary audio hint](https://developer.apple.com/documentation/avfaudio/avaudiosession/silencesecondaryaudiohintnotification?language=objc)는
다른 앱의 주요 오디오에 관한 신호이지 무음 스위치 값이 아니다. 이 제한을 시뮬레이터 시험으로 대체하지 않는다.

`.env` 수정/커밋·push·배포·운영 토글 변경은 하지 않았다. 시험 빌드를 위해 일시적으로 변경한
Info.plist는 기존 SHA-256 `7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`로 복구했다.
종료 상태 확인 뒤 대상 GPS 주입과 시험 앱을 종료하고, cwd/PID가 이번 실행과 일치하는
8088 Metro와 15544 harness만 정리했다. 다른 실행 서버/시뮬레이터/실기기 데이터는 보존했다.
