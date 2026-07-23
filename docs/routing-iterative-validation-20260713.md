# 지도 3사 순차 비교 검증

검증 기기: iPhone 17 Pro 시뮬레이터, iOS 26.2

검증 원칙: 한 수정사항을 독립적으로 반영한 뒤 동일 경로의 전체 화면과 상세 배율을 캡처하고, 네이버지도 첨부 영상·카카오맵 공식 개편 자료·TMAP 공식 서비스 및 SDK 동작과 비교한다.

## 1. 배율별 마커 계층

- 수정: 출발·도착 핀은 z12 이하에서 상세 크기의 84%로 표시하고 z16.5까지 연속 확대한다. 승차·환승 노드도 최초 노출 배율부터 상세 배율까지 1px 단위로 커지게 변경했다.
- 좌표 불변: 크기만 바꾸고 TMAP Marker position과 offset anchor는 같은 경로 좌표에 유지했다.
- 네이버지도 비교: 전체 경로에서는 출발·도착 의미가 보이되 본선보다 먼저 튀지 않고, 상세 확대에서는 큰 행동 마커를 유지한다.
- 카카오맵 비교: 겹치는 마커를 줄이고 핵심 이동 흐름을 우선한다는 2026년 대중교통 지도 개편 원칙과 일치한다.
- TMAP 비교: native Marker를 유지해 확대·축소 중 지도 좌표와 함께 움직이며, 별도 screen-space 마커를 만들지 않았다.
- 판정: **통과**. 전체 화면의 핀 비중은 낮아졌고 z17 환승 노드·노선 태그·WALK/TRANSFER 연결은 그대로 유지됐다.

검증 캡처:

- `screenshots/reference-parity/20260713-iterative-v2/01-marker-hierarchy/before-overview-fixture.png`
- `screenshots/reference-parity/20260713-iterative-v2/01-marker-hierarchy/after-overview-settled.png`
- `screenshots/reference-parity/20260713-iterative-v2/01-marker-hierarchy/after-transfer-z17.png`

자동 검증:

- `routeMarkerPresentation.test.ts`
- `transitMarkerPresentation.test.ts`
- `transitMarkerHierarchy.test.ts`
- TypeScript `--noEmit`

## 2. 첫 진입 상단 정보 위계와 경로 가시 영역

- 수정: 뒤로가기는 40pt 단독 아이콘으로 축소하고, 가운데에는 선택 경로 요약만 남겼다. 우측 보조 칩은 선택 경로를 반복하지 않고 실제 다음 대안이 있을 때만 해당 대안으로 전환한다.
- 카메라 안전영역: 상단 예약 공간을 축소한 값으로 전체 경로 카메라를 다시 계산해 출발·도착 핀과 본선이 헤더나 하단 액션 바에 잘리지 않도록 했다.
- 네이버지도 비교: 첨부 영상처럼 선택 경로를 중심 정보로 두고 다른 경로는 실제 선택 가능한 대안일 때만 보조 정보로 노출한다.
- 카카오맵 비교: 지도와 핵심 이동 정보를 동시에 읽게 하고 중복 마커·정보를 줄이는 2026 대중교통 지도 개편 원칙에 맞췄다.
- TMAP 비교: 대중교통 경로 비교 동작처럼 보조 칩을 장식이 아닌 실제 대안 전환 동작에 연결했다.
- 판정: **통과**. iPhone 17 Pro 첫 진입에서 출발·도착과 전체 노선이 한 화면에 들어오며, 단일 경로 fixture에서는 불필요한 우측 노선 칩이 표시되지 않는다.

검증 캡처:

- `screenshots/reference-parity/20260713-iterative-v2/02-composition-before.png`
- `screenshots/reference-parity/20260713-iterative-v2/02-header-composition/after-first-entry.png`

자동 검증:

- `routeAlternativeRanking.test.ts`
- TypeScript `--noEmit`

## 3. 경로 모드 기본지도 정보 밀도

- 수정: 경로 상세 화면에서만 TMAP 기본 타일의 채도·명도·대비를 낮춘다. 앱의 data URI Marker와 TMAP native Polyline은 타일 판별에서 제외했다.
- 다크 테마: TMAP SDK가 실제 dark mapType 적용을 증명하면 약한 보정만 사용하고, 지원하지 않는 현재 런타임에서는 기본 타일에만 dark fallback을 적용한다. 지도 전체를 덮는 dim overlay는 사용하지 않는다.
- 네이버지도 비교: 첨부 영상의 다크 경로 지도처럼 배경 지명·도로보다 선택 노선과 승하차 지점이 먼저 읽힌다.
- 카카오맵 비교: 주변 정보 중첩을 줄이고 핵심 이동 흐름을 강조하는 2026 대중교통 지도 개편 방향과 일치한다.
- TMAP 비교: SDK Marker와 Polyline을 다시 그리지 않고 native overlay로 유지해 좌표, stroke, dash, direction 표현은 타일 보정의 영향을 받지 않는다.
- 판정: **통과**. iPhone 17 Pro 콜드 스타트 전체 경로와 z17 환승 상세에서 타일만 후퇴하고 출발·도착 핀, 노선색, WALK 점선, 환승 마커는 원래 밝기와 색을 유지했다.

검증 캡처:

- 수정 전: `screenshots/reference-parity/20260713-iterative-v2/02-header-composition/after-first-entry.png`
- 콜드 스타트 전체 경로: `screenshots/reference-parity/20260713-iterative-v2/03-route-focus-map/after-cold-entry.png`
- z17 환승 상세: `screenshots/reference-parity/20260713-iterative-v2/03-route-focus-map/after-transfer-z17.png`

자동 검증:

- `routeMapPresentation.test.ts`
- TypeScript `--noEmit`

## 4. 줌별 안내선 비율과 TMAP native direction

- 수정: 대중교통 본선 10.4px와 WALK/TRANSFER 5.2px, 각 casing 비율을 z6~18에서 고정한다. 줌 변경으로 native Polyline을 재생성하지 않아 선과 화살표 위상을 함께 유지한다.
- native direction: BUS/SUBWAY의 동일 TMAP Polyline에서만 `direction`을 사용한다. 장거리 전체 화면도 방향을 읽도록 z6부터 opacity 0.40을 유지한다.
- WALK/TRANSFER: 파란 `strokeStyle: dash`와 solid casing을 유지하고 모드 판정 및 TMAP solid-line 조건 양쪽에서 direction을 차단했다.
- TMAP 공식 제약: Web V2에서 공개된 방향표 스타일 제어는 `directionColor`와 `directionOpacity`다. SDK가 공개하지 않은 화살표 간격·개수 추정값은 QA 로그에서 제거했다.
- 네이버지도 비교: 첨부 영상처럼 확대해도 본선과 casing 비율이 갑자기 변하지 않으며, 방향표가 노선색과 환승 마커보다 먼저 튀지 않는다.
- 카카오맵 비교: 노선색과 이동 구간 구분을 우선하고 방향 정보는 보조 대비로 유지했다.
- 판정: **통과**. z6~18의 solid 본선에서 낮은 대비의 native direction을 확인했다. z18 환승 점선에는 방향표가 없고, runtime 진단에서도 WALK/TRANSFER `directionRenderer`가 `none`이었다.

검증 캡처:

- 수정 전 z17: `screenshots/reference-parity/20260713-iterative-v2/03-route-focus-map/after-transfer-z17.png`
- z12: `screenshots/reference-parity/20260713-iterative-v2/04-zoom-native-direction/z12.png`
- z15: `screenshots/reference-parity/20260713-iterative-v2/04-zoom-native-direction/z15.png`
- z17: `screenshots/reference-parity/20260713-iterative-v2/04-zoom-native-direction/z17-after.png`
- z18 환승 최종 재검증: `screenshots/reference-parity/20260713-iterative-v2/05-final-regression/transfer-z18-final.png`

자동 검증:

- `transitRoutePresentation.test.ts`
- `routeZoomStyle.test.ts`
- TypeScript `--noEmit`

참조:

- TMAP Web V2 Polyline direction 공식 답변: https://openapi.sk.com/qnaCommunity/423

## 5. 경로 후보 품질 게이트와 공급자 선택

- 단위 수정: TMAP 공식 문서상 `totalTime`과 `sectionTime`은 항상 초 단위다. 1,000 미만 값을 분으로 오인하던 휴리스틱을 제거해 `873초 → 15분`, `700초 → 12분`으로 고정했다.
- 응답 검증: HTTP 성공 여부만 보지 않고 실제 `metaData.plan.itineraries`의 시간과 대중교통 leg를 검사한다. 빈 후보, WALK-only 후보, 물리적으로 불가능하게 짧은 후보는 채택·캐시하지 않는다.
- 다중 공급자 선택: 설정된 공급자를 모두 평가하고 유효 후보군 중 최단 소요시간, 후보 수, 공급자 순서로 결정한다. 선택 공급자와 후보 수, 최단 시간, 공급자별 `usable/rejected/failed` 상태를 `_noLateRouting`에 남긴다.
- 네이버지도 비교: 동일 잠실역→홍대입구역 참조 경로는 약 39분이다.
- 카카오맵 비교: 동일 좌표 참조 경로는 약 38분이다.
- TMAP 재호출: 2026-07-13 21:00 기준 10개 후보 중 최단은 58분·29.0km였고, 그다음 후보도 59~74분이었다. 소비자용 지도 앱 후보와 같은 38~39분 경로는 API 응답에 없었다.
- 판정 1: **통과** — 시간 단위, 빈/깨진 후보 거절, 공급자별 품질 비교, 선택 진단은 자동 테스트로 검증했다.
- 판정 2: **미통과** — 현재 실행 환경에는 TMAP 외 서버용 대중교통 공급자가 없어 실제 잠실→홍대 후보는 여전히 58분이다. 이 차이는 선·마커 렌더링이나 정렬로 복원할 수 없다.
- 다음 연결 조건: ODsay 같은 서버용 대중교통 공급자 키를 추가하고, 선택 후보의 BUS/SUBWAY 정밀 shape와 WALK 경로까지 현재 canonical itinerary 형식으로 정규화해야 한다. 좌표가 없는 후보를 시간만 보고 노출하지 않는다.

자동 검증:

- 백엔드 `TransitRouteServiceTest` 6개 통과
- 프런트 `tmapApiParsing.test.ts`, `routingService.test.ts` 11개 통과
- TypeScript `--noEmit`

참조:

- TMAP 대중교통 API 응답 단위와 shape: https://transit.tmapmobility.com/docs/routes
- ODsay 대중교통 길찾기 및 노선 그래픽 API: https://lab.odsay.com/guide/releaseReference?platform=web

## 6. iPhone 17 Pro 최종 재검증

- 전체 경로 첫 진입: 서울역→강남역 출발·도착 핀과 4호선·2호선 전체가 상단 헤더 및 하단 액션 바 사이에 들어온다. 카메라가 정지한 뒤 헤더와 경로 요약도 정상 표시된다.
- 줌 12: 본선 10.4pt, casing 12.272pt, 보행 5.2pt, native direction opacity 0.40을 확인했다.
- 줌 15: 같은 본선·보행 폭과 direction 위상을 유지하고, 경로에 스냅된 중간 정류장 이중 링 3개를 확인했다.
- 줌 17: 같은 폭과 opacity를 유지하며 WALK/TRANSFER는 파란 SDK 점선이고 direction은 없다.
- 줌 18: 본선 10.4pt, casing 12.272pt, 보행 5.2pt, casing 6.552pt를 유지하며 환승 dash에 direction이 없음을 확인했다.
- 앵커: 서울역 승차, 사당 하차·환승·재승차, 강남 하차가 fixture 경로와 모두 0m 차이로 연결된다. 환승 모드로 재분류한 보행 leg도 원천 진단을 `WALK_STEPS_LINESTRING`으로 유지한다.
- 화면 상태 전환: 같은 버스 경로에서 `middle → collapsed`, `z17 → z15`로 바꿀 때 초기 동기화가 선택 경로를 비우던 문제를 분리했다. 전환 후에도 N64 경로, 정류장, 헤더와 ETA가 유지된다.
- 마커 비교: 전체 화면은 큰 출발·도착 핀, 상세 화면은 승차·환승 행동 마커와 노선 태그, 중간 정류장은 작은 점으로 계층을 나눴다. 네이버지도 첨부 영상의 전체/상세 위계 및 카카오맵의 중복 정보 축소 원칙과 같은 구조다.
- 렌더러 판정: WALK/TRANSFER는 `directionRenderer: none`, BUS/SUBWAY만 `tmap-native-polyline-direction`이다. screen-space 방향 화살표 fallback은 전 구간 `false`다.
- 최종 판정: **표현 계층·줌 비율·점선·네이티브 방향·승하차 스냅은 통과**. 실제 후보 경로 동등성은 5절의 공급자 한계 때문에 미통과 상태를 유지한다.

최종 캡처:

- 전체 경로: `screenshots/reference-parity/20260713-iterative-v2/05-final-regression/route-overview-final-settled.png`
- 환승 z18: `screenshots/reference-parity/20260713-iterative-v2/05-final-regression/transfer-z18-final.png`
- 버스 승차 z17: `screenshots/reference-parity/20260713-iterative-v2/05-final-regression/bus-z17-before-sheet-switch-fixed.png`
- 버스 정류장 z15 및 시트 전환: `screenshots/reference-parity/20260713-iterative-v2/05-final-regression/bus-stops-z15-after-sheet-switch-settled.png`

최종 자동 검증:

- 프런트 지도·카메라·마커·파서·화면 집중 회귀 15 suites, 78 tests 통과
- 프런트 TypeScript `--noEmit` 통과
- 백엔드 `TransitRouteServiceTest` 통과
