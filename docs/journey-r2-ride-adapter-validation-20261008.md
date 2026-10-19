# R2-2 인증 경로·차량 관측 Runtime 연결

날짜: 2026-10-08 (Asia/Seoul). FE/BE `feature/transit-guidance-v1`.

## 구현 범위

- 서버가 보관한 경로와 공식 정류장·형상을 교차 검증한 뒤에만 짧은 수명의 ride binding을 발급한다. 클라이언트가 임의 노선·차량 좌표를 제출하는 API가 아니다.
- ODsay 정류장 순번, 공식 정류장 순번, 도로 구간 순번을 동일시하지 않는다. 전체 정류장 순서·BIS/ARS ID·좌표와 저장 버스 형상의 내부 지점까지 확인한다.
- 정류장 주변 허용 반경을 연속으로 통과하는 한 passage를 잘못 두 occurrence로 나누던 형상 매칭을 수정했다. 반경을 벗어나 다시 방문하는 경우는 여전히 별도 occurrence다. 기존 7016 실응답의 모호성 해소는 재조회 전까지 미확인이다.
- 인증된 세션·로그인 세대·소유자·revision·digest를 공급자 조회 전후에 검사한다. 정적 자료는 최대 32개/300초, 차량 요청은 노선별 최소 10초 간격으로 제한한다.
- 차량 원본 시각·수신 시각·15초 이내 TTL을 보존한다. 같은 관측 재수신으로 탑승 근거를 늘리지 않는다. `lastStnId`를 마지막 통과 정류장으로, `sectOrd`를 정류장 순번으로 간주하지 않는다.
- 네이티브 인증 transport가 binding과 차량 관측을 자동 안내 Runtime에 전달한다. 원래 CLLocation 관측을 사용하는 동행 reducer가 판단하며, lease 만료·종료·재시작 때 근거를 재사용하지 않는다. 차량 ID/좌표는 로그·세션 영속 데이터에 저장하지 않는다.

서버 `journey.bus-ride.enabled` 기본값은 false다. 이번 시험은 별도 합성 harness에서만 true다. 새 네이티브 transport는 DEBUG 시뮬레이터 범위이며 운영 기능 ON이나 실기기 지원 완료가 아니다.

## 검증

- BE 여정·교통·Live Activity 관련 최종 회귀: 53 suites / 383 tests PASS, 실패·오류·skip 0. `./gradlew test --tests 'com.noLate.journey.*' --tests 'com.noLate.transit.*' --tests 'com.noLate.notification.liveactivity.*' --no-daemon`. 이 중 격리 MySQL Testcontainers 1건 포함. 운영 DB 변경 없음.
- Swift 298건, FE Jest 295 suites / 2,706건, 타입 검사 PASS.
- 기존 QA 23건 + 신규 독립 차량 replay QA 4건 PASS.
- iOS Debug 시뮬레이터 빌드 PASS. 임시 Info.plist 시험 플래그는 소스에서 원복했다.
- 공급자 상태와 관측 목록이 모순될 때도 차단하는 추가 방어 테스트를 포함한 mapper/matcher 28건 PASS. 위 최종 관련 회귀에도 이 방어 코드와 테스트가 포함됐다.
- 추가적인 무필터 BE 전체 테스트는 합격하지 않았다. Spring/JPA 초기화 중 JVM heap 1,048,576K 중 1,047,079K 사용과 높은 CPU 점유를 확인해 실행을 중단했다. 관련 회귀와 프로젝트 전체 합격을 혼동하지 않는다. 전체 실행은 별도 heap/컨텍스트 격리 조정 후 재검증할 항목이다.

### 독립 시뮬레이터

대상: `NoLate R2 Session E2E 20261008`, iOS 26.5,
`96AF9A48-4721-4335-B7BF-10B9382B7A30`.
분리된 창의 `Show in Device Hub` 툴바를 확인하고 해당 창만 조작했다. 내장 Device Hub 미리보기나 실기기는 조작하지 않았다.

입력은 모두 합성이다. 서버의 차량 흐름은 독립적인 인공 시계 기반이며 사용자 GPS를 읽지 않는다. replay는 승객 GPS만 주입한다. 탑승/단계 전환 버튼 또는 엔진 상태 강제 변경은 사용하지 않는다.

확인한 상태: 준비 ARMED/출발 0 → GPS ACTIVE/출발 1/ACK → 차량 없는 대기 근거 0 → 차량 관측 후 BOARDING_CANDIDATE/근거 2 → RIDING/근거 3~4 → 관측 중단 후 UNAVAILABLE/RIDING_EVIDENCE_STALE/근거 0. 차량 관측 중단 뒤에도 승객 GPS를 1초 간격으로 30초 유지했다. 정상 종료 STOPPED/종료 큐 0/transport NOT_REQUESTED도 확인했다. 첫 실행에서 놓친 양성 확정 순간은 새 세션으로 replay를 반복하여 독립 창 AX와 스크린샷에서 직접 확인했다.

정상 종료 후 앱을 terminate하고 같은 개발 서버와 내부 시험 화면으로 콜드 재진입했다. IDLE/출발 0/차량 근거 0/transport NOT_REQUESTED/종료 큐 0/이전 기록 없음/동의 해제를 확인했다. 활성 탑승 중 강제 종료·복구의 전체 E2E를 뜻하지 않는다. 시험 종료 후 해당 기기의 GPS 주입을 해제하고 앱·이번 Metro/합성 서버를 종료했다. 기존 다른 시뮬레이터·앱 데이터는 삭제하지 않았다.

## 남은 게이트

1. 실제 7016 공식 자료를 수정 matcher로 다시 검증하고, 실제 차량 관측의 경로·방면 유일성과 최신성을 확인해야 한다. 이번 실제 서울 API 호출은 0회다. 공식 HTTP 엔드포인트로 키를 전송하는 새 조회 예산의 승인 대기 상태이며, 이전에 소진된 조회 허가를 재사용하지 않았다. 이번 합성 성공으로 실제 매핑 통과를 주장하지 않는다.
2. 제품 RIDING projection을 상세 경로 바·지도·목록·Live Activity에 연결해야 한다. 현재 제품 안내는 첫 도보/정류장 접근·대기 범위이며 진단 reducer가 RIDING이어도 제품 화면은 위치 확인 중일 수 있다.
3. 이후 R3 하차/최종 도보, R5 음성·알림, R6 지하철·환승 및 실기기 GPS 검증이 남는다.
4. 이번 APNs 실제 발송은 0건이다. 기존 APNs 검증 이력은 별도 문서이며 이번 탑승 화면의 APNs/잠금 화면 합격으로 전용하지 않는다.

공식 계약 참고: [정류장 목록](http://api.bus.go.kr/contents/sub02/getStaionByRoute.html), [차량 위치](http://api.bus.go.kr/contents/sub02/getBusPosByRouteSt.html).

API 키·토큰·실제 공급자 원문·차량 좌표는 이 문서에 포함하지 않는다. `.env` 변경·커밋·푸시·배포는 수행하지 않았다.
