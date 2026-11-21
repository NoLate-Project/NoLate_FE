# 저장 ODsay 경로의 제품 Live Activity 원격 연결

2026-11-20, **일반 iOS Release 제품 화면**에서 격리 계정의 저장된 ODsay
`WALK → BUS 1711 → WALK` 경로를 사용했다. 독립 시뮬레이터 창에서 잠금을
조작했고, Device Hub의 내장 기기 화면이나 길안내 시험 화면은 사용하지 않았다.
Figma는 앞서 확인한 도구 사용 한도로 변경하지 못했다. 화면 디자인은
[앞선 네이버 참고 반영](../journey-navigation-entry-design-20261119/README.md)을 유지했다.

일반 로그인/부트스트랩에서 서버가 수락한 같은 계정·API·등록 세대의 FCM 토큰만
길안내에 연결한다. 원문 토큰은 메모리에만 두며, 늦게 끝난 푸시 등록도 같은 안내
바인딩에 연결한다. ActivityKit 토큰 요청 실패나 원격 설정 부재가 로컬 안내를
막지 않도록 했다. 실제 기기의 일반 등록 동작을 유지하면서, 지원되는 ARM64
시뮬레이터는 Sandbox APNs를 시도한다. 이 Mac의 `arm64e` 이름을 누락하던 조건도 수정했다.

## 최종 검증

`NoLateJourneyProductEnabled=true`, `NoLateJourneyAuthenticatedEnabled=true`이고
`NoLateJourneyAPNsPilotEnabled`가 없는 빌드를 설치했다. 토큰 수동 주입 없이
일반 앱 등록을 확인한 후 자동 출발·대기·탑승·현재 위치 화면을 통과했다.
승객 GPS는 CoreSimulator 주입이며, 차량은 **30초 늦고 28초마다 갱신되는 독립
시험 시계**다. 실제 공식 차량의 전 구간 운행을 관찰한 시험은 아니다.

| 장면 | 확인 |
| --- | --- |
| [이동 중 제품 지도](01-product-riding-map.png) | 지도 점, 현재 하차 정류장, 접힌 경로 막대의 위치 마커가 함께 표시됨 |
| [프로세스 종료 전 잠금 카드](02-lock-before-process-exit.png) | 첫 허용을 처리한 실제 카드. GPS 주입을 멈췄으므로 현재 위치 마커를 숨기고 마지막 확인 상태를 표시함 |
| [앱 종료 후 카드](03-lock-after-process-exit.png) | 종료 직후와 3초 뒤 모두 앱 프로세스가 없고 카드가 유지됨. 서버 END 요청 직전에도 부재를 다시 검사함 |
| [서버 END 후](04-lock-after-server-end.png) | 서버의 실제 Firebase/APNs END 이후 카드 제거 |

최종 XCUITest **1건 통과, 실패 0건**. 실제 Firebase가 **UPDATE 31건, END 1건**을
수락했고 이 실행의 UPDATE 거절은 0건이었다. END 뒤 iOS가 앱을 백그라운드로
깨웠으므로, 앱이 계속 종료 상태여야 한다는 조건을 합격 근거로 쓰지 않았다.
대신 서버 요청 직전 프로세스 부재·카드 유지, 실제 END 수락, 카드 제거,
그 뒤 `liveactivitiesd`가 발생시킨 `Activity ended` assertion을 함께 확인했다.
이는 이 iOS 27 시뮬레이터에서 관찰한 동작이며 모든 OS에서의 재실행 보장은 아니다.

관련 FE Jest **114건 통과**, TypeScript 통과, ESLint **오류 0/경고 1**,
iOS Release 빌드 성공. 서버의 버스/열차 대기 문구 계약도 실제 저장 구간 종류와
대조하도록 수정했고, 첫/환승 지하철의 도착 정보 유무를 포함한 서버 검사
**40건 통과·MySQL 1건 건너뜀**을 확인했다. 건너뜀은 MySQL 검증 성공이 아니며,
지하철 대기 수정 자체의 제품 열차 E2E도 이번 버스 실행 범위 밖이다.

결과 번들: `/private/tmp/nolate-product-remote-activity-causal-e2e-20261120/result.xcresult`.
[기계 판독 결과와 선행 실패](../../qa/2026-11-20-product-remote-activity-validation.json).
실행 후 주입 GPS·시험 차량 시계를 정리하고 이 회차의 격리 APNs 서버도 중지했다.
시험용 앱 화면은 추가하지 않았다. 기존 Live Activity 미리보기 라우트 제거도 유지한다.

## 남은 경계

로컬·원격이 함께 갱신하는 제품 모드이므로, UPDATE 수락 건수를 원격 UPDATE만으로
모든 중간 화면이 바뀌었다는 증거로 해석하지 않는다. 이번 시각적 원격 증거는
**앱 종료 후 서버 END**다. 토큰 회전의 원자적 재바인딩, 교체·재시작·다중 구간의
원격 조합, 실제 열차 연속 탑승·복합 환승, 실기기 GPS·음성·무음은 별도다.
운영 배포나 `main` 병합을 수행한 회차도 아니다. 자차 참고 화면의 회전·차선·
카메라 안내를 새로 구현한 것으로 보지 않는다.
