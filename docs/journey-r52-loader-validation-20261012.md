# R5-2 로컬 알림 로딩 보강 — 2026-10-12

상태: 최초 실행은 환경 오류로 차단됐고, 아래 승인 후 복구에서 앱 멈춤 두 경로를
수정했다. 최종 빌드의 출발 전 잠금 GPS 완주 2회와 별도 로컬 안내 알림 표시를 확인했다.
검증 범위는 합성 WALK-BUS-WALK이며 실제 API/APNs·R1–R6 전체 완료가 아니다.

## 변경

이전 독립 창 실행에서 Expo listener/handler-only 동적 import가 공유 node_modules의
다른 checkout 상대 경로로 해석되는 경고가 있었다. 로컬 알림 경로를 별도 lazy helper로
분리하고 literal `require`로 같은 번들 안에서 동기 로딩하도록 바꿨다.
helper import 자체로 native 모듈을 로드하지 않으며 실제 기존 설정 흐름에서만 호출한다.

- Expo root index/PushTokenManager를 새로 로드하지 않는다.
- 권한 요청·APNs/FCM 토큰 등록·계정 조회를 새로 추가하지 않는다.
- 기존 foreground/custom alarm handler의 표시·차단·action 정책은 그대로 사용한다.
- native UN delegate, 기존 알람, `node_modules`, 운영 설정은 변경하지 않는다.
- 잘못된 모듈 shape는 고정 코드로 거부하고 raw exception/path를 출력하지 않는다.
- Simulator root token 경로를 건너뛰는 이유와 실제 APNs 지원 여부를 혼동하던 주석을 수정했다.

이 수정은 로컬 모듈 로딩 경고에 대한 조치다. 잠금 알림 미표시의 전체 원인을
확정하거나 실제 배너 표시를 보장하는 수정으로 해석하지 않는다.

## 자동 검사

- 새 helper 4건: import 시 미로딩, 로컬 모듈만 로드, 모듈 cache/중복 listener 방지,
  잘못된 handler 거부.
- 첫 FE 전체 실행은 기존 source-contract 테스트 1건이 helper 이동을 반영하지 못해 실패했다.
  테스트를 새 helper의 literal require/비-root·비-권한/비-token 계약 검사로 수정했다.
  실제 동작 테스트를 삭제하거나 실패를 무시하지 않았다.
- 수정 후 FE 전체 **305 suites / 2,858건 PASS**, 실패·skip 0.
- 관련 loader/native contract 재검증 12건 PASS.
- TypeScript PASS, Node QA/diagnostics 설정 46건 PASS.
- BE/native source 변경 없음. 이전 BE 406건/Swift 342건을 이번 신규 실행 결과로 세지 않는다.

## 독립 창 E2E 시도와 차단

기존 시험 기기 `NoLate R2 Session E2E 20261008` / iOS 26.5 /
`96AF9A48-4721-4335-B7BF-10B9382B7A30`가 Shutdown 상태였다.
이 기기만 boot했고 bootstatus는 완료했다. CUA가 선택한 분리 창은
`deviceWindow-AppWindow-3`이며 툴바 `Show in Device Hub`를 확인했다.
Hub 내장 미리보기를 시험 대상으로 사용하지 않았다.

그러나 앱 launch가 완료되지 않고 홈의 Spotlight 전환도 중간 화면에 머물렀다.
읽기 전용 `simctl list devices booted`와 대상 종료/조회도 지연·응답 없음 상태였다.
같은 시점 다른 시험 기기의 screenshot/spawn 및 help 명령도 대기 상태인 것을 확인했다.
특정 길안내 코드의 실패나 Metro의 원인이라고 단정하지 않는다.

대상만 데이터 삭제 없이 shutdown/boot로 복구하려 했으나 shutdown이 제한 시간 내
완료되지 않아 더 진행하지 않았다. 다른 기기나 전체 CoreSimulator 서비스는 강제 종료하지 않았다.
권한·Live Activity·알림의 새 OS 허용 prompt를 누르지 않았고 실제 사용자 로그인도 하지 않았다.

합성 harness는 준비했지만 최종 확인 시 상태 NONE였고 앱에서 prepare를 실행하지 못했다.
따라서 GPS 출발/탑승/도착 완주, 새 loader의 기기 내 로딩 성공, 알림 실제 표시,
콜드 종료 정리 모두 이번 실행에서는 **미검증**이다. 실제 공급자 API/APNs 호출은 0회다.
E2E 화면 증거는 [앱 진입 전 차단 화면](evidence/journey-r52-lock-20261012/01-simulator-ui-blocked-before-app.png).

읽기 전용 device 목록은 이후 응답했지만 대상 app-container 조회와 앱 UI 전환은
정상화 확인에 실패했다. 목록의 Booted 표식을 기능 E2E 준비 완료로 간주하지 않는다.
이번 Metro/합성 harness는 cwd/PID를 확인해 종료했다. 앱 source Info.plist의 SHA-256은
`7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`로 이전과 동일하다.
초기 합성 위치 설정만 시도했으며 위치 경로 replay나 사용자 위치 추적은 시작하지 않았다.

## 재개 순서

1. 다른 시뮬레이터 작업과 조율해 공유 서비스 복구 범위를 먼저 확정한다.
2. 대상 독립 창에서 앱 진입/기본 UI 반응을 확인한다. 새 loader 경고가 없어졌는지 확인한다.
3. 전경 ARMED 준비 후 **출발 전부터 잠금**한 GPS 완주를 두 번 반복한다.
4. 후보 phase/reason/이동 근거와 독립 차량 동행 근거를 구분해 탑승 실패 시점을 기록한다.
5. 별도 안내 알림의 실제 화면 표시와 만료/취소를 확인한다. 접수 수만으로 합격시키지 않는다.
6. 상세/잠금 위치 마커·최종 도보·자동 도착/카드 제거·종료 큐 0·콜드 OFF를 확인한다.

실제 경로 R4-4b mixed-provider 계약과 R6 지하철·환승은 이번에 진척됐다고 표시하지 않는다.
운영 기본 OFF, simulator-only, `.env` 비변경, 미커밋 변경 보존 조건은 유지한다.

## 승인 후 복구·위치 시작 보강 (같은 날 후속 실행)

사용자의 공유 서비스 재시작 승인 후 시험 기기만 shutdown/boot했다. 앱 진입과
알림 채널 선택, 서버 ARMED/출발 0까지 복구됐고 이전 listener/handler 모듈 로딩
경고는 재현되지 않았다. 그러나 준비 호출에서 앱 UI가 다시 멈췄다.
시험 앱의 2초 샘플에서 main-thread가 `arm → beginInputs →
CLClientIsLocationServicesEnabled → synchronous XPC reply`에서 기다리는 것을 확인했다.
이는 이번 준비 UI 정지 지점의 근거이며 이전 모든 simctl 지연 원인의 확정은 아니다.

자동 runtime의 전역 `CLLocationManager.locationServicesEnabled()` 동기 조회를 제거했다.
초기/변경 authorization delegate 콜백에서 기존 권한에 따라 시작하며, 미요청 상태는
명시적인 준비 이후 한 번만 요청한다. denied/restricted/unknown은 계속 fail-closed다.
manager/token fence, 백그라운드 capability/usage description 검사, GPS·차량 근거와 TTL은
유지했다. 콜백을 기다리는 동안 `CHECKING_PERMISSION`을 표시할 수 있으며 위치를
허용된 것으로 간주하거나 강제로 시작하지 않는다.

Apple은 전역 services 조회가 필수는 아니며 새 manager의 권한을 delegate로 알린다고
설명한다: [locationServicesEnabled](https://developer.apple.com/documentation/corelocation/cllocationmanager/locationservicesenabled()),
[authorization callback](https://developer.apple.com/documentation/corelocation/cllocationmanagerdelegate/locationmanagerdidchangeauthorization(_:)).

대상 위치 서비스만 재시작한 뒤에도 조회 지연이 있어 승인 범위의 공유 CoreSimulator
서비스를 TERM으로 재시작했다. 부팅 기기 연결이 모두 종료됐고 시험 기기만 재부팅했다.
표시 앱도 재실행하고 같은 대상의 독립 창 `deviceWindow-AppWindow-1`을 다시 열었다.
기기 erase/앱 데이터 삭제/실기기 설정 변경은 하지 않았다.

추가 native source-contract 3건 PASS, FE 전체 306 suites / 2,861건 PASS,
Swift 정책 342건 PASS, QA 46건 PASS. 새 테스트의 Node 타입 참조로 첫 TypeScript
검사는 실패했으며 저장소의 기존 `jest.requireActual` 패턴으로 수정 후 통과했다.
Swift 정책 검사는 UIKit runtime 자체를 실행하지 않으므로 수정된 앱 빌드와
독립 창 GPS 재검증을 별도로 수행해야 한다.

첫 수정 iOS 빌드는 성공했지만 준비 화면이 다시 멈췄다. 두 번째 앱 샘플은
`arm → publish → viewState → authorization getter → synchronous XPC reply`였다.
전역 조회 제거만으로 해결됐다고 결론 내리지 않았다. 이제 delegate callback에서만
manager의 권한 값을 받아 token fence 뒤에 메모리 cache로 저장하며, 시작/진단은
그 callback 값만 사용한다. callback 전에는 `CHECKING_PERMISSION`, inputs 해제 시에는
cache도 해제한다. 진단 getter가 새 동기 조회를 발생시키지 않는 회귀 검사도 추가했다.
두 번째 iOS Debug simulator build와 FE 전체 2,861건·TypeScript도 통과했다.

## 최종 빌드 독립 창 GPS 검증

대상은 동일한 iOS 26.5 시험 기기이며 분리 창의 `Show in Device Hub` 툴바를 확인했다.
Hub 내장 미리보기/실기기를 조작하지 않았다. 서버는 loopback 합성 인증·굽은 구간
fixture, 실제 provider=false였다. replay는 승객 CoreLocation과 별도 fixture 차량 시계만
사용하며 출발/탑승/하차/최종 도보/도착 phase를 직접 주입하지 않는다.

중단됐던 준비 기록은 콜드 진입에서 자동 재개되지 않았다. 명시적 종료의 최초 전송은
`STOP_DELIVERY_UNAVAILABLE`/큐 1이었으며 합성 인증 재시도 버튼에서 큐 0으로 정리했다.
전송 실패를 성공으로 취급하거나 저장소를 삭제하지 않았다.

첫 완주: 전경 ARMED/출발 0 → 출발 전에 잠금 → GPS 자동 출발/서버 ACK →
잠금 도보 20m·경로 바 위치 마커 → 정류장 대기 → 탑승 근거 대기 중 마커 숨김 →
확정 버스/목표 정류장 약 90m 전 → 목적지 연속 체류 후 카드 자동 제거를 확인했다.
전 과정에서 잠금을 해제하거나 단계 버튼을 사용하지 않았다. 최종 도보 중간 화면은
캡처하지 못했으므로 해당 화면 증거를 첫 실행 성공 근거로 추가하지 않는다.
해제 후 `STOPPED`, 목적지 도착 종료, 출발 1, 알림 접수 5/음성 큐 0, 오류 없음,
서버 종료 큐 0, 남은 기록 없음을 확인했다. replay도 성공 종료하고 위치 주입을 clear했다.

이번에는 별도의 ‘합성 버스 · 약 2분 후 도착 예정’ **로컬 안내 알림이 잠금 화면에
실제로 표시된 것**을 확인했다. 이후 알림이 제거된 화면도 확인했다. 그 사이 phase도
변경돼 순수 10초 만료와 phase 취소 중 어느 경로가 제거했는지는 화면만으로 구분하지 않는다.
접수 5건 각각의 표시·청취, 실제 APNs 수신으로 확대 해석하지 않는다.

[첫 잠금 대기 카드](evidence/journey-r52-resume-20261012/01-final-build-locked-armed.png),
[GPS 마커·실제 로컬 안내 알림](evidence/journey-r52-resume-20261012/02-early-lock-gps-departure.png),
[알림 제거 후 대기](evidence/journey-r52-resume-20261012/03-locked-notice-expired.png),
[버스 근접 마커](evidence/journey-r52-resume-20261012/05-early-lock-confirmed-near-stop.png),
[자동 도착 카드 제거](evidence/journey-r52-resume-20261012/08-locked-destination-observation.png),
[도착 종료·큐 0](evidence/journey-r52-resume-20261012/09-first-destination-stopped-zero-queue.png).

반복 준비에서는 오래된 합성 인증이 `AUTOMATIC_AUTH_REQUIRED`로 차단됐다. 실제 계정
인증을 요청하거나 토큰 수명을 늘리지 않고 시험 경로 재조회로 새 합성 인증을 받았다.
[만료 인증 차단](evidence/journey-r52-resume-20261012/10-expired-test-auth-blocked.png).

두 번째 완주도 출발 전 잠금부터 도착 카드 제거까지 잠금을 유지했다. 잠금 도보 마커 →
확정 버스 이동 → 다음 정류장 약 200m 전/정류장 근처 → 불확실 구간 마커 숨김 →
최종 도보 60m → 10m/마커 끝 이동 → 자동 도착 카드 제거를 확인했다.
해제 후 목적지 도착 종료/출발 1/접수 5/음성 큐 0/오류 없음/종료 큐 0/남은 기록 없음이었다.
서버 누적 prepare 4/출발 2/activation 2/cancel 2, STOPPED,
rejected/trap/실제 guidance push 각 0이었다. prepare 2건은 앞서 UI가 멈췄던 실행으로,
GPS 완주 횟수에 더하지 않는다. 두 replay 모두 종료 코드 0과 위치 clear를 확인했다.

[두 번째 버스 이동](evidence/journey-r52-resume-20261012/14-second-locked-riding.png),
[한 정류장 전](evidence/journey-r52-resume-20261012/15-second-locked-one-stop-before.png),
[목표 근처](evidence/journey-r52-resume-20261012/16-second-locked-target-approach.png),
[최종 도보 60m](evidence/journey-r52-resume-20261012/18-second-locked-final-walk-distance.png),
[최종 도보 10m](evidence/journey-r52-resume-20261012/19-second-locked-final-walk-progress.png),
[자동 카드 제거](evidence/journey-r52-resume-20261012/20-second-locked-arrival-cleared.png),
[도착 종료·큐 0](evidence/journey-r52-resume-20261012/21-second-stopped-zero-queue.png).

최종 콜드 재진입은 IDLE/OFF/알림·음성 계수 0/종료 큐 0/남은 기록 없음이었다.
[콜드 정리 증거](evidence/journey-r52-resume-20261012/22-final-cold-idle-off-zero-queue.png).
정리 시 대상 GPS를 다시 clear하고 시험 앱을 종료했다. source Info.plist는 임시 시험
capability를 제거해 기존 SHA `7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`와
동일함을 확인했다. 이번 Metro/합성 harness는 cwd/PID를 확인해 종료했다.

남은 조건: 실제 저장 경로 mixed-provider 계약/R6 지하철·환승, 안내 이벤트 각각의
실제 표시·독립 TTL/phase 취소 원인 분리, 제품 설정/실기기 실행 경로와 현장 GPS·무음·
배터리 시험이다. 이번에는 상세 페이지의 활성 위치 마커나 실제 APNs를 새로 검증하지 않았다.
이전 조기 잠금 실패의 모든 원인이 규명됐다고 주장하지 않으며 이번 최종 빌드에서의
두 번 재현 성공으로만 기록한다. `.env`, 운영 기본 OFF, simulator-only는 유지했다.
