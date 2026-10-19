# P2-2b 저장 경로 매핑 검증 — 2026-10-04

## 결과와 범위

저장 경로의 도착 조회 ID를 서버가 결정하고, 앱의 선택 메타데이터와 대조하는 읽기 전용 binding API를 구현했다.
서울 ODsay 버스 중 명시적 BIS route/stop ID, ARS, 원본 순번과 방면이 있는 첫 WALK → BUS만 지원한다.
미지원 공급자/누락/반복 승차 정류장/선택-저장 불일치/저장 경로 변경은 공급자 조회 전에 차단한다.
도착 예정 차량은 사용자 탑승 차량이 아니다. 탑승 확정, 하차 정류장 수, 음성/푸시/Live Activity는 추가하지 않았다.

실제 선택 경로의 개발 카드에는 매핑 검사 결과를 추가했지만 LOCAL_ONLY이며 서버를 조회하지 않는다.
운영 자동 안내는 default-off 그대로다. 실제 일정 상세와 공통 native 상태의 연결은 P2-3 작업이다.
ODsay WALK connector 형상은 여전히 geometryInputComplete=false이며, 매핑 통과로 형상 차단을 해제하지 않는다.

## 구현

1. ODsay production parser가 raw stop ID/ARS/도시/BIS namespace와 busIdentifiers를 별도 evidence에 보존한다.
   표시용 passStops의 중복 제거/재번호, 숫자만 추출한 display code, 노선명/목적지로 이 근거를 복원하지 않는다.
2. FE 매핑 preview와 BE 독립 resolver가 같은 제한을 적용한다. ODsay busID가 아닌 지역 BIS localRouteId를 사용한다.
   sourceIndex, 엄격히 증가하는 providerSequence, 전 행 ID/namespace/좌표, count, 첫 승차 ID와 30m 좌표 일치를 검사한다.
   반복 승차 ID, 여러 저장 경로 배열, wrapper 출처 충돌은 보완 조회 전까지 차단한다.
3. `POST .../bus-arrivals/binding`은 조회 query 없이 session generation/revision/owner/digest만 받는다.
   서버가 현재 actor/소유 일정/최신 세션/TTL/저장 경로 fingerprint와 플래그를 검사하고 canonical query/occurrence를 반환한다.
4. FE는 이 응답을 선택 메타데이터 및 현재 session/revision/digest와 대조한 다음에만 도착 API를 호출한다.
   도착 API도 요청 query를 저장 경로와 독립적으로 대조하고 fetch 후에 다시 전체 fence를 검사한다.
5. `SAVED_ROUTE_METADATA`는 저장 JSON의 명시적 메타데이터 대조를 뜻한다. 실제 공급자 payload의 진위/운행
   일치나 특정 사용자의 탑승을 인증한 증거가 아니다. 순수 arrival matcher는 여전히 REQUEST_IDENTIFIERS_ONLY다.

원본 ID namespace/필드는 [ODsay 공식 참조](https://lab.odsay.com/guide/releaseReference?platform=web)를 확인했다.
지원 코드/필드가 있다는 사실과 실제 운영 경로 매핑 성공을 구별한다. 실제 공급자 API는 이번에 호출하지 않았다.

## 자동 검사

- FE 전체: **278 suites / 2,418 tests PASS**.
- BE 매핑/도착·신선도/서울·TAGO·자동 준비 관련 회귀: **102 tests PASS**. Kotlin compile 포함.
- TypeScript PASS. 변경한 journey/UI/테스트 파일 lint: errors/warnings 0.
- 기존 map parser 파일 lint `--quiet`: errors 0. 기존 warning 전체를 없앴다는 의미는 아니다.
- CoreLocation replay 6개 + diagnostic config 7개 = 13개 PASS.
- native Swift source/schema와 iOS 생성 파일 3개는 이번 단계에서 변경하지 않았다. 기존 진단 바이너리를 사용했다.

검사 중 발견·수정한 사항:

- 전체 FE 첫 실행: 기존 selected-BUS UI의 P2-1 문자열 기대값 1개가 실패했다. 실제 변경된 P2-2 카드 단계에 맞춰 수정 후 전체 재검사 통과.
- 신규 방향 control-character regex의 lint warning 1개를 문자 코드 검사로 고친 뒤 lint 재검사 통과.
- 전 행 지역 stop ID가 없으면 반복 승차 ID 여부를 확정할 수 없으므로, 최종 resolver를 전 행 필수 검사로 강화하고 FE/BE 전체 관련 검사를 다시 실행했다.

## 독립 시뮬레이터 E2E

기기: NoLate Journey P0 Isolated 20261004, iOS 26.5,
UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, detached window `deviceWindow-AppWindow-4`.
computer-use로 이 독립 창의 버튼/스크롤만 조작했다. Device Hub 관리 창과 다른 시뮬레이터/실기기는 조작하지 않았다.
Xcode 27에서 창을 소유하는 process/menu 이름은 Device Hub지만, 매번 독립 창 제목과 Show in Device Hub 상태를 검사했다.

입력은 `simctl location set`으로 CoreSimulator → 실제 CoreLocation callback에 공급한 합성 GPS trace다.
native bridge로 phase를 설정하거나 출발·접근·대기 버튼을 눌러 단계를 만들지 않았다. 준비/종료 버튼만 사용했다.
도보 약 132m trace에서 자동 출발 1회, 이후 승차 좌표 ±0.5m를 4초 간격으로 유지해 WAITING을 관측했다.
최근 수평 위치 오차는 5.0m였고, 화면 상태는 GOOD였다. 이는 실제 환경의 GPS 정확도 검증이 아니다.

도착 피드는 loopback 15543의 test-only MockMvc/메모리 repository/합성 인증 서버만 사용했다.
새 ODsay-shaped **매핑 전용 fixture**는 production ODsay parser를 통과하지만 GPS 형상은 기존 TMAP 합성 경로를 그대로 사용한다.
화면에 이 조합을 표시했다. 합성 ID를 기존 TMAP/native v1 입력에 끼워 넣어 실제 지원 경로처럼 만들지 않았다.
이 E2E는 실제 ODsay 도보 형상과 저장 native route digest 전체 일치를 인증하지 않는다.

| 사례 | 확인 결과 | 증거 |
| --- | --- | --- |
| GPS 이동 → 자동 출발 → 대기 + canonical mapping | SUPPORTED, 원본 승차 순번 10, WAITING_INFORMATION, 합성 ETA/도착 예정 차량 표시 | [01](evidence/journey-p2-2b-20261004/01-mapped-waiting.png) |
| 공급자 방면 불일치 | IDENTITY_MISMATCH, ETA와 차량 숨김 | [02](evidence/journey-p2-2b-20261004/02-wrong-direction.png) |
| 오래된 원천 시각 | STALE, GPS는 GOOD여도 ETA/차량 숨김 | [03](evidence/journey-p2-2b-20261004/03-stale-source.png) |
| 신선한 신규 원천 관측 | 새 원천 시각으로만 ETA 복구 | [04](evidence/journey-p2-2b-20261004/04-fresh-recovery.png) |
| 활성 세션 중 저장 경로 교체 | fingerprint 불일치로 ARRIVAL_UNAVAILABLE. source call count **17 → 17** | [05](evidence/journey-p2-2b-20261004/05-saved-route-replaced.png) |
| 독립 화면에서 종료 | STOPPED, 대기/차량 숨김 | [06](evidence/journey-p2-2b-20261004/06-stop.png) |
| 최종 코드의 미지원 저장 경로 | GPS WAITING/GOOD여도 SAVED_ROUTE_MAPPING_UNAVAILABLE. prepare/departure/activation 각 1, arrivalRequests **0** | [07](evidence/journey-p2-2b-20261004/07-unsupported-saved-mapping.png) |
| 최종 FE/BE 재시작 후 정상 경로 | 자동 출발 1회, WAITING/GOOD, SUPPORTED, ETA **116초**, 탑승 미확정 | [08](evidence/journey-p2-2b-20261004/08-final-mapped-waiting.png) |
| 최종 코드 방면 불일치 재검사 | IDENTITY_MISMATCH, 대기시간/차량 없음 | [09](evidence/journey-p2-2b-20261004/09-final-wrong-direction.png) |
| 최종 코드 원천 시각 만료 재검사 | STALE, GPS WAITING/GOOD 유지 | [10](evidence/journey-p2-2b-20261004/10-final-stale-source.png) |
| 최종 코드 저장 경로 교체 재검사 | ARRIVAL_UNAVAILABLE, source call count **22 → 22** | [11](evidence/journey-p2-2b-20261004/11-final-saved-route-replaced.png) |
| 최종 종료 | STOPPED, checkpoint 없음, pending departure 없음, 대기정보 제거 | [12](evidence/journey-p2-2b-20261004/12-final-stop.png) |

GPS 샘플 종료와 waiting-monitor 시작 사이에 위치가 stale되어 숨겨지는 상태도 관측했다.
GOOD/WAITING/ETA를 assertion한 캡처만 정상 표시 증거로 저장했고 stale 화면을 성공 캡처로 취급하지 않았다.
GET/__fixture/* 제어와 mock 인증은 test-source 서버 전용이며 운영 endpoint가 아니다.

종료 후 GPS replay process가 없는 것을 확인하고 simulator 위치 입력을 clear했다.
fixture reset 후 prepare/departure/activation/cancel/arrivalRequests 모두 0, lastState=NONE,
transitMode=FRESH, mappingMode=MAPPED임을 확인했다. 앱 native 상태는 STOPPED/위치 NOT_COLLECTING이다.
loopback harness와 Metro는 후속 개발을 위해 유지했으며 실제 서버와 연결하지 않았다.
도착 요청은 최대 10초 간격이다. native 품질 저하/종료는 즉시 숨기지만 화면 밖 저장 경로 변경은 다음 poll에서 차단된다.

## 남은 게이트 / 다음

P2-3에서 실제 본인의 저장 일정과 native route input/digest를 일치시키고, 화면 수명 밖 공통 snapshot에
GPS/도착 상태를 결합한 뒤 실제 경로 상세와 ActivityKit에 연결한다. 이번 시험의 companion fixture 조합을 운영 경로에 사용하지 않는다.

TMAP/타 지역/불완전·혼합 namespace/방면 미제공/반복 정류장은 별도 공급자 ID/occurrence 조회 또는 증거 확보가 필요하다.
버스 완주, 차량 추적/탑승 확정, 한 정류장 전 하차, 지하철/환승, 음성·무음 전환은 아직 미완료다.
ActivityKit 로컬 표시·갱신은 P2-3 시뮬레이터 테스트 대상으로 남겨 두고, 실제 APNs/잠금·종료/무음 모드와
운행 정확도는 별도 외부/실기기 검증이다. 현재 simulator-only 요청으로 검증 완료 처리하지 않는다.

`.env`/실제 provider/사용자 DB/push 발송/실기기/운영 플래그 변경/커밋·푸시는 수행하지 않았다.
