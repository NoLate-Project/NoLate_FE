# 길찾기 품질 재검증

최종 검증일: 2026-07-13

## 검증 범위

- 포함: 장소 검색, 자동차/대중교통/도보/자전거 경로 탐색, 대안 경로, 경로 상세, 교통·요금·실시간 정보, 저장 흐름
- 제외: 턴바이턴 주행 내비게이션, 음성 안내, 운전 점수. 현재 제품 목표가 길찾기이므로 별도 범위로 둔다.
- 비교 기준: 네이버지도, TMAP, 카카오맵의 소비자 앱 기능과 공개된 공식 API/서비스 설명

## 공식 레퍼런스

- [네이버지도 iOS](https://apps.apple.com/kr/app/id311867728): 실시간 교통 기반 자동차 경로, 다양한 대중교통 경로, 실시간 도착정보, 승하차 안내
- [TMAP 경로안내 소개](https://www.tmapmobility.com/support/data/path/about): 실시간 교통, CCH 경로 탐색, 미래 출발/도착 예측, 교통 돌발정보
- [TMAP API](https://tmapapi.tmapmobility.com/main.html): 자동차·보행자·대중교통 경로, 상세 안내, 교통정보, 지오코딩
- [TMAP V2 Polyline 옵션 공식 샘플](https://tmapapi.tmapmobility.com/webv2/sample/webSample89.html): SDK `Polyline`의 `strokeStyle`로 solid·dash·dot 선을 구분
- [SK open API 공식 Q&A - Polyline direction 설정](https://openapi.sk.com/qnaCommunity/423): `direction`, `directionColor`, `directionOpacity` 지원 범위
- [카카오맵 서비스](https://www.kakaocorp.com/page/service/service/KakaoMap?lang=ko): 자동차·대중교통·도보·자전거 길찾기와 최신 장소·교통정보
- [카카오맵 URL Scheme](https://apis.map.kakao.com/ios_v2/docs/getting-started/urlscheme/): 네 가지 이동수단과 경유지 지원 범위
- [카카오내비 API](https://developers.kakao.com/docs/ko/kakaonavi/common): 대안 경로, 우선순위, 제한도로, 차량·유종·하이패스 옵션
- [NAVER Cloud Directions 5](https://api.ncloud-docs.com/en/ai-naver-mapsdirections-driving): 실시간 교통, 경유지, 경로 옵션, 통행료·유류비, 상세 안내
- [카카오맵 대중교통 상세 개선 사례](https://kakaomap.tistory.com/439): 복수 도착예측, 진행 방향, 하차문·출구, 상세 도보 안내
- [카카오맵 대중교통 지도·목록 듀얼뷰](https://kakaomap.tistory.com/446): 출발부터 환승·도착까지 핵심 이동 흐름, 선택 가능한 정류장·역 라벨, 지도 마커 과밀 제거
- [TMAP 대중교통 API](https://transit.tmapmobility.com/docs/routes): `passStopList.stationList`의 정류장 순서·이름·ID·좌표와 전체 보행자 이동 경로
- [TMAP V2 Marker 이벤트 공식 샘플](https://tmapapi.tmapmobility.com/webv2/sample/webSample19.html): 모바일을 포함해 `click`과 `touchend`를 분리 등록
- [네이버지도 대중교통 길안내](https://blog.naver.com/PostView.naver?blogId=naver_map&logNo=223289066322): 실시간 위치 기반 승하차 정보, 알림·음성 안내, 열차 선택

## 차이점과 처리 상태

| 순서 | 항목 | 지도 3사 기준 | 기존 NoLate | 현재 상태 |
|---|---|---|---|---|
| P0-1 | 정보 신뢰성 | 실제 도착정보와 시간표를 출처에 맞게 구분 | API가 없을 때 3분·7분 값을 만들어 `실시간`으로 표시 | **해결**: 임의 도착시간·혼잡·빠른 하차 문구 제거. 실제 응답이 있을 때만 실시간 표시 |
| P0-2 | 상세 화면 일관성 | 교통수단이 달라도 지도·요약·단계·행동 구조가 일관됨 | 대중교통만 최신 상세 화면, 나머지는 구형 패널 | **해결**: 대중교통 상세 셸을 네 모드 공통 화면으로 사용 |
| P0-3 | 도로 상세 안내 | 회전, 도로명, 구간 거리·시간을 단계별 제공 | 자동차·도보 API의 상세 feature를 버리고 전체 선만 표시 | **해결**: TMAP Point/LineString 안내를 공통 타임라인과 지도 구간으로 연결 |
| P0-4 | 교통·비용 | 혼잡 구간, 통행료, 예상 택시비 등 의사결정 정보 제공 | 총 시간·거리만 사용 | **해결**: TMAP 교통 구간 색상, 통행료, 예상 택시비 파싱 및 표시 |
| P0-5 | 대안 경로 응답성 | 복수 경로를 빠르게 비교하고 중복은 제거 | 자동차·도보 옵션을 순차 호출, 점 개수로 중복 판정 | **해결**: 공급자 옵션 병렬 호출, 경로 형상 샘플 기반 중복 판정 |
| P0-6 | 장소 검색 문맥 | 현재 지도/출발지 주변 결과 우선, 동명 장소 거리 제공 | 전국 단위 키워드 결과만 사용 | **해결**: 반대편 경로 지점을 검색 중심으로 전달하고 기준점 거리를 표시 |
| P0-7 | 경로상 정류장 | 전체 지도에서는 핵심 승하차점, 확대 시 중간 정류장과 선택 상세를 제공 | 모든 정류장이 15.6 이상에서만 나타나고 iOS 터치가 동작하지 않음 | **해결**: 버스는 13.8부터 단계 노출, 구간별 균등 샘플링, 실제 노선색, 선택 정류장 유지, iOS `touchend` 상세 연동 |
| P1-1 | 대중교통 실시간 범위 | 전국 노선·정류장 식별자 매핑, 도착예측과 경로 시간표 결합 | 서울 백엔드 일부 지원. TMAP 정류장 ID와 서울 ARS ID가 다를 수 있음 | **부분**: 거짓 fallback은 제거. 전국 정류장 ID 매핑과 시간표 공급자는 추가 필요 |
| P1-2 | 출발/도착 시각 탐색 | 미래 출발·도착 시각, 막차와 운행 캘린더 반영 | 현재 시각 + 총 소요시간 계산 | **부분**: TMAP 요청에 현재 `searchDttm`을 전달하고 `service=0` 승차 구간은 제외. 미래 시각 선택 UI와 Time Machine API는 추가 필요 |
| P1-3 | 경유지·경로 옵션 | 경유지, 무료도로, 최소시간, 계단·휠체어 등 조건 | 공급자 옵션 코드는 일부 호출하지만 사용자 설정 없음 | **미해결** |
| P1-4 | 자전거 운영 품질 | 상용 SLA, 자전거도로·경사·통행 제한 반영 | FOSSGIS 공개 OSRM 자전거 서버 사용 | **부분**: 단계 안내 추가. 공개 서버는 운영 트래픽용이 아니므로 자체 호스팅/상용 공급자 필요 |
| P1-5 | 운영 아키텍처 | 키 보호, 할당량, 재시도, 관측성, 공급자 장애 대응 | 모바일 앱에서 TMAP 키로 직접 호출 | **부분 해결**: 인증된 `/api/routes/transit` 프록시, 서버 키, 45초 캐시와 provider fallback 추가. 두 번째 상용 공급자와 운영 지표는 추가 필요 |
| P2-1 | 승하차 보조 | 정확한 출구, 하차문, 정류장 승차 위치 | 노선·정거장·방향만 표시 | **부분 해결**: 노선·승하차 상태·정류장명과 공급자 응답의 승강장 번호를 고배율 배지로 표시. 출구·하차문·실내 동선은 별도 데이터 필요 |
| P2-2 | 지도 콘텐츠 | 실내지도, 항공뷰, 거리뷰, 최신 POI 편집 체계 | TMAP 기본 지도와 POI 검색 중심 | **미해결**: 길찾기 UI 수정만으로 해결할 수 없는 지도 데이터 영역 |

## 경로상 버스 정류장 재검증

TMAP 대중교통 응답의 `passStopList.stationList`를 선택한 경로의 정류장 레이어로 사용한다. 좌표마다 Circle을 찍어 선처럼 보이게 하는 구현은 사용하지 않으며, 정류장마다 하나의 native Marker만 둔다.

| 지도 배율 | 버스 정류장 정책 | 지하철역 정책 | 목적 |
|---|---|---|---|
| 6~14.3 | 중간 정류장 숨김 | 중간역 숨김 | 출발·승차·환승·도착 흐름 우선 |
| 14.4~15.4 | 구간당 최대 3개, 전체 6개, 13px | 중간역 숨김 | 본선 주변 여백을 지키며 버스 정류장 발견 |
| 15.5~16.7 | 구간당 최대 6개, 전체 12개, 14px | 중간역 숨김 | 경로와 정류장 순서 확인 |
| 16.8~18 | 구간당 최대 14개, 전체 24개, 15px | 선택한 역만 유지 | 정류장 선택과 상세 확인 |

긴 노선은 단순히 앞에서부터 자르지 않는다. 각 승차 구간에 최소 한 개를 배정한 뒤 경로의 처음부터 끝까지 균등 샘플링하며, 사용자가 선택한 정류장은 배율을 낮춰도 유지한다. 13~15px 이중 링은 중립 외곽선과 노선색 안쪽 링을 함께 사용한다. 통과 정류장 노드는 공급자 오차 범위인 80m 안에서 본선에 붙이되, 실제 보행 접근 좌표는 20m 안에서만 본선과 합친다. 지하철 중간역은 TMAP 기본 POI와 중복되므로 사용자가 선택한 역 외에는 새 마커를 쌓지 않는다. 승차·하차점은 기존 이벤트 마커가 담당하므로 중간 정류장과 중복 생성하지 않는다.

iPhone 17 Pro, iOS 26.2에서 확인한 결과:

- `z12`: 중간 정류장 없음, 핵심 출발·도착 흐름 유지
- `z14`: 402번 경로의 중간 버스 정류장 노출, 본선 가림 없음
- `z15`: 경로 전체에 균등 샘플된 정류장 확인, 승하차 마커보다 작은 크기 유지
- `z17`: 선택 정류장명 배지와 상세 시트 표시
- iOS WebView: TMAP 공식 방식대로 `click`과 `touchend`를 함께 등록하고 420ms 중복 호출 방지

검증 캡처는 `screenshots/route-stop-audit/20260711`에 있다.

- `bus-z12-overview.png`
- `bus-z14-progressive.png`
- `bus-z15-stops.png`
- `bus-z17-detail.png`
- `bus-stop-touchend-selected.png`

이번 범위는 **선택한 경로가 실제로 통과하는 정류장**이다. 현재 화면 주변의 모든 비경로 정류장을 별도로 검색하는 레이어와 전국 실시간 도착정보는 정류장 조회 API 및 TMAP station ID↔지역 ARS ID 매핑이 추가로 필요하다.

## 출발·승차·도착 안내선 재검증

검증 기기: iPhone 17 Pro 시뮬레이터, iOS 26.2

실제 공급자 경로: 서울역 → 남산서울타워(자동차·버스 402·도보·자전거), 서울역 → 홍대입구(1호선 환승 대안)

| 항목 | 수정 전 | 수정 후 |
|---|---|---|
| 지원 배율 | 앱은 5를 허용하지만 TMAP SDK가 적용하지 않아 이전 카메라가 남음 | SDK 실지원 범위와 같은 **6~18**로 통일하고 전 배율 캡처 검증 |
| 보행 끝점 보정 | 실제 geometry가 없어도 최대 60m를 직선으로 연결 | 16m 이내 스냅, **24m 초과 직선 연결 금지** |
| 정류장/역 좌표 | 정류장 POI가 운행 선형에서 80m 이내면 선형 좌표로 이동 | 20m 이내만 합침. 그 이상은 실제 POI를 유지 |
| 역사 내부 연결 | 보행 점선이 54m 떨어진 철도 선형까지 연장됨 | 보행선은 역 POI에서 종료하고, POI↔선로는 파란 native dash로 역할 분리 |
| 버스 승차 안내 | 상세 배지 임계값 18.8, 지도 최대 18이라 표시 불가 | 17~18에서 `402 · 승차 · 6번승강장`처럼 노선·행동·승강장 표시 |
| 마커 중복 | 승하차 이벤트와 버스 정류장 마커를 같은 좌표에 이중 생성 | 이벤트 마커 하나로 통합하고 18m 이내 연속 환승 이벤트를 공간 병합 |
| 자동차 끝점 | 선택 POI와 자동차 도로망 사이 출발 73m·도착 426m가 고배율에서 끊김 | 24m 초과 구간은 TMAP 보행 경로를 조회해 파란 점선으로 연결 |
| 자전거 끝점 | 선택 POI와 OSM 자전거망 사이 출발 45m·도착 179m가 끊김 | 실제 보행 경로를 연결하고, TMAP·OSM 망 사이 109m는 파란 도식 dash로 분리 |
| 긴 보행선 렌더링 | 화면 밖에서 120개 점 제한을 먼저 소진해 도착부 점선이 사라짐 | 화면 안쪽 점만 제한 개수에 포함해 긴 접근선도 출발·도착 주변에 표시 |

최종 회귀 캡처는 `screenshots/route-connector-audit/20260711-after/zoom-matrix-v20`에 있다. 대중교통 출발·첫 승차·도착과 자동차·도보·자전거 출발·도착을 각각 6~18 정수 배율로 확인한 **117장**이다.

배율별 확인 결과:

- 6~11: 세부 배지는 숨기고 전체 경로 위치와 출발·도착만 유지
- 12~14: 본선과 접근선의 이동 흐름을 구분
- 15~16: 노선색, 승차 위치, 자동차·자전거에서 보행으로 바뀌는 접점을 식별
- 17~18: 실제 정류장 POI, 보행 점, 승차 행동과 공급자 승강장 번호를 표시

## TMAP Polyline native 렌더링 재검증

직접 만든 screen-space 화살표와 좌표별 점 렌더러를 기본 경로에서 제거하고, 현재 앱이 로드하는 TMAP JS V2 `Polyline`을 우선 사용한다. BUS/SUBWAY 한 구간은 **보이는 본선 Polyline 하나**만 생성하고 그 객체에 `direction: true`를 적용한다. 화살표를 위한 투명 carrier, 좌표 window, 자체 `DirectionArrowsLayer`는 생성하지 않는다.

| 구간 | Polyline 스타일 | 방향 표시 | 구현 상태 |
|---|---|---|---|
| WALK | 파란 `strokeStyle: "dash"` | 없음 | native Polyline |
| TRANSFER | 파란 `strokeStyle: "dash"` | 없음 | native Polyline |
| BUS | 노선색 `strokeStyle: "solid"` | `direction: true` | native Polyline |
| SUBWAY | 노선색 `strokeStyle: "solid"` | `direction: true` | native Polyline |

공식 샘플과 현재 로드된 SDK 소스를 함께 확인한 결과, V2 SDK는 dash를 내부 `setLineDash`로 그리며 direction은 solid 선에서만 그린다. WALK/TRANSFER는 `solid` casing 위에 `dash` 본선을 올린다. casing까지 dash로 그리면 두 선의 두께가 달라 SDK 내부 dash 주기가 어긋나는 문제가 있다. 앱 런타임 probe 결과는 다음과 같다.

- SDK: `Tmapv2`, 로더 `jsv2?version=1`
- `supportsDirection=true`
- `supportsDirectionColor=true`
- `supportsDirectionOpacity=true`
- `supportsDashStroke=true`
- `usableForRouteLine=true`

iPhone 17 Pro 시뮬레이터 검증에서는 native direction과 WALK/TRANSFER dash가 지도에 붙어 있었고 누락은 0건이었다. 화면 캡처는 `screenshots/route-native-polyline-audit/20260711`에 있다.

- `bus402-route-start-z18-native-v2.png`: WALK blue dash
- `bus402-overview-z16-native-v2.png`: BUS solid + native direction
- `subway-transfer-z17-native.png`: SUBWAY solid + native direction
- `transfer-z17-native-dash.png`: TRANSFER blue dash, direction 없음

## 2026-07-12 첨부 네이버지도 모션 비교

기준 영상은 `ScreenRecording_07-11-2026 12-16-36_1.MP4`의 서울역→강남역, 4호선→사당역 환승→2호선 경로다. NoLate도 동일한 출발·도착지로 TMAP 실제 대중교통 API를 재조회해 `passShape` 기반 형상을 비교했다. 직선으로 만든 정적 QA fixture는 렌더링 회귀용일 뿐, 실제 경로 정확도의 근거로 사용하지 않았다.

| 비교 항목 | 첨부 네이버지도 | 기존 NoLate 문제 | 수정 결과 |
|---|---|---|---|
| 본선·화살표 | 선과 방향 무늬가 한 객체처럼 이동 | 세그먼트당 여러 투명 direction window를 생성해 위상·접선이 불규칙 | BUS/SUBWAY 본선 Polyline 하나에 native direction 직접 적용 |
| 줌 비율 | 선 두께와 마커 크기가 화면 기준으로 안정적 | 배율 변경마다 Polyline 재생성으로 화살표 위상이 바뀔 수 있음 | 본선 10.4px, WALK/TRANSFER 5.2px로 고정해 같은 native Polyline 유지, 핵심 노드 22~32px 계층화 |
| 도보·환승 | 본선과 분리된 파란 접근선, 방향 화살표 없음 | 점 marker나 자체 screen 렌더러로 보일 여지 | TMAP native `strokeStyle: "dash"`, solid casing, direction 항상 false |
| 승차·환승 마커 | 실제 노드 중심의 원형 아이콘과 노선 태그를 분리 | 줌 경계에서 station→badge로 전체 아이콘을 교체 | 좌표 노드는 고정하고 노선 태그만 독립 marker로 구성 |
| 출발·도착 pin | 모든 배율에서 색·라벨·anchor 유지 | 저배율에서 라벨·크기를 교체 | `출발`/`도착` pin을 전 배율에서 같은 아이콘과 anchor로 유지 |
| 버스 정류장 | 선택 경로의 정류장만 본선 위에 절제해 표시 | 흰 점처럼 뭉개지거나 공급자 좌표 오차로 선에서 떨어질 수 있음 | 통과 노드는 80m 이내 본선 snap, 13~15px 이중 링, 선택 정류장은 실제 이름 배지로 전환 |
| 경로 형상 | 실제 선로·환승 위치를 따름 | 통과역 좌표만 이어 그린 fallback이 실제 형상처럼 보일 수 있음 | 선택 경로는 `TRANSIT_PASS_SHAPE_LINESTRING`을 우선하고 pass-stop/endpoint-only는 열화 fallback으로 분리 |

시뮬레이터 검증 산출물은 `screenshots/reference-video-audit/20260712-after`에 있다.

- `actual-subway-routeOverview.png`: 실제 API의 서울역→강남 전체 경로
- `subway-subwayZoom12-v3.png`, `subway-subwayZoom15-v3.png`, `subway-subwayZoom17-v3.png`: 고정 두께·native direction 배율
- `final-actual-subway-transfer-z17-v2.png`: 사당 환승 dash가 양쪽 노드에 연결되고 화살표가 없는 상태
- `final-actual-bus-firstBoard.png`: 실제 402 버스 승차점·접근 도보선·정류장 정렬
- `final-actual-bus-routeEnd.png`: 하차 후 실제 도보 dash가 도착 pin anchor에 정확히 닿는 상태
- `actual-subway-zoom-motion.mov`: 전체→z15→z17→환승 카메라 회귀

TMAP native direction의 사용자 설정은 활성화·색·투명도이고, 화살표 간격과 크기는 SDK가 `strokeWeight`를 기준으로 결정한다. 따라서 현재 구조는 줌 중 위상 붕괴를 해결하지만, 네이버지도의 화살표 간격을 임의로 복제하는 수준의 제어는 제공하지 않는다.

## 2026-07-13 동일 경로 다중 검증

iPhone 17 Pro, iOS 26.2에서 서울역→광화문과 잠실역→홍대입구를 추가 검증했다. 네이버지도와 카카오맵은 웹 소비자 화면에 같은 출발·도착을 입력했고, NoLate는 같은 WGS84 좌표를 사용했다. 지도 3사와의 육안 비교는 전체 경로 화면과 상세 확대 화면을 구분했다.

| 경로 | 네이버지도 | 카카오맵 | NoLate/TMAP API | 판정 |
|---|---:|---:|---:|---|
| 서울역→광화문 | 708번 중심, 약 10분 | 별도 캡처 없음 | 종로11, 14분 | 후보 차이는 있으나 같은 OD로 정상 전환. 세로형 단거리의 상단 pin 본체까지 카메라 여백에 포함 |
| 잠실역→홍대입구 | 2호선 짧은 방향, 39분 | 2호선 짧은 방향, 38분 | 2호선 긴 방향, 58분·약 29km | **경로 후보 자체 불일치** |

잠실역→홍대입구는 앱의 정렬 오류가 아니다. 앱과 같은 좌표로 TMAP `/transit/routes`를 직접 호출한 10개 후보의 최단 응답이 58분이며, 지도 3사의 38~39분 경로는 응답에 포함되지 않았다. 따라서 화면에서 임의로 선을 줄이거나 후보 점수를 바꿔서는 해결할 수 없다. 소비자 수준의 대중교통 경로 공급 계약 또는 별도 대중교통 라우터를 백엔드 게이트웨이에 추가해야 한다.

2026-07-14 12:00 기준 재호출에서도 상세 API와 요약 API 모두 최단이 57분·28.9km였고, 2호선 단일 레그는 잠실→강남→신도림→홍대입구의 23개 역을 반환했다. 성수를 경계로 두 번 나누어 조회하면 짧은 방향의 정밀 `passShape` 두 조각은 얻을 수 있었지만, 한 번의 검색에 공급자 요청이 3회 필요하고 분할 지점의 대기시간·운임을 앱이 재합성해야 한다. TMAP 무료 체험 한도와 실제 운행 정보의 책임 범위를 고려해 이 방식은 운영 fallback으로 채택하지 않았다.

화면 비교에서 확인한 공통 원칙과 적용 내용:

- 전체 경로 배율: 출발·도착 pin과 선택 본선을 우선하고 중간 승하차 노드·노선 태그는 숨긴다.
- 중간 배율: `z11.4`부터 승차·환승 노드, `z11.8`부터 노선 태그를 순차 노출한다.
- 상세 배율: `z16.8`부터 하차 경계까지 보존하고, WALK/TRANSFER dash와 BUS/SUBWAY native direction을 유지한다.
- 첫 진입 카메라: 바텀시트 높이뿐 아니라 실제 경로의 세로·가로 비율을 계산해 세로형 단거리만 더 넓게 맞춘다.
- 선 굵기: `z6~18`에서 본선 10.4px, WALK/TRANSFER 5.2px를 유지해 확대·축소 중 native Polyline과 방향표 위상이 바뀌지 않는다.

비교 캡처는 `screenshots/reference-parity/20260713-multi-route`에 있다.

- `naver/seoul-station-to-gwanghwamun-overview.png`
- `naver/jamsil-to-hongdae-overview.png`
- `kakao/jamsil-to-hongdae-overview.png`
- `kakao/jamsil-to-hongdae-detail.png`
- `nolate/short-valid-start-z12.png` ~ `short-valid-start-z18.png`
- `nolate/jamsil-hongdae-initial-middle.png`
- `nolate-after/seoul-gwanghwamun-entry-v2.png`
- `nolate-after/seoul-gwanghwamun-origin-z12.png` ~ `seoul-gwanghwamun-origin-z18.png`

### 첫 진입 bounds-fit 보강

경험적인 위·경도 delta 임계값은 바텀시트 높이와 경로 방향이 바뀔 때 출발 또는 도착 pin을 화면 경계에 걸치게 만들었다. 첫 진입 카메라는 Web Mercator 화면 좌표로 경로 bounds를 투영한 뒤, 상단 경로 제어부와 현재 바텀시트가 차지하는 사각형을 제외한 안전영역에 맞추도록 교체했다. pin 높이를 위한 상·하단 여백과 최소 경로 범위도 같은 계산에 포함한다.

iPhone 17 Pro에서 다음 세 가지 형상을 재검증했다.

- 서울역→광화문: 세로형 단거리
- 잠실역→홍대입구: 가로형 장거리
- 서울역→강남역: 세로·대각선 복합 경로

세 경로 모두 첫 진입 시 전체 본선과 출발·도착 pin이 헤더 및 바텀시트 안전영역 안에 들어왔다. 캡처는 `screenshots/reference-parity/20260713-entry-fit-v17`에 있다.

## 2026-07-13 최종 실행 계획과 반영 결과

이번 패스는 대중교통 실제 API 경로를 기준으로 `후보 신뢰성 → 첫 화면 → 선 계층 → 마커 계층 → 확대 검증` 순서로 진행했다.

| 순서 | 확인된 차이 | 반영 내용 | 실제 검증 |
|---|---|---|---|
| 1 | 공급자 요청과 후보 검증 | TMAP 공식 최대 `count=10`, 현재 `searchDttm`, `service` 파싱, 인증 백엔드 프록시·캐시 추가 | 서울역→강남 10개 후보와 서울역→남산 버스 실제 응답 재조회 |
| 2 | 정상 철도 우회를 오류로 오판 | 직선거리 비율만으로 후보를 누르지 않고, 좌표 단절 또는 3배 이상 극단 형상만 후순위 처리 | 사당 환승 4호선→2호선 경고 제거, 좌표 이상 테스트 유지 |
| 3 | 첫 화면에서 경로가 잘림 | Web Mercator bounds에 상단 제어부·현재 시트 높이·pin 여백을 함께 반영. QA 전체 경로도 같은 동적 fit 사용 | 근거리 버스와 서울역→강남 전체 본선·양 끝 pin 노출 |
| 4 | 저배율이 복잡함 | 첫 상세 진입 시트를 50%로 낮추고, 저배율 노선 태그·방향표·중간 정류장을 단계적으로 숨김 | z12, z15에서 본선 우선 계층 확인 |
| 5 | 선이 작고 줌 중 비율이 불안정 | BUS/SUBWAY 10.4px, WALK/TRANSFER 5.2px와 고정 casing 비율을 사용해 줌 중 객체 재생성 제거 | z12·15·17·18 동일 화면 폭과 native overlay 유지 확인 |
| 6 | 방향표가 불규칙하고 장거리 개요에서 사라짐 | screen-space 화살표를 쓰지 않고 TMAP native direction만 z6~18에서 opacity 0.40으로 사용 | 잠실→홍대 저배율과 서울역→강남 z12·15·17에서 일정한 위상 확인 |
| 7 | 승차·환승 마커가 겹치거나 의미가 약함 | 실제 노드는 보존하고 pin과 가까운 텍스트 태그만 숨김. 이전 노선 수단 노드와 다음 노선색 환승 화살표를 분리 | 버스 승차 snap 2m, 하차 4~16m, 사당 환승 노드 정렬 확인 |
| 8 | 도보·환승선 역할이 불명확 | WALK/TRANSFER만 파란 native dash와 solid casing, 방향표 없음. 실제 geometry가 없는 0m 환승은 선을 만들지 않음 | 서울역 보행 접근선과 사당 0m 환승을 각각 확인 |
| 9 | 접힌 상세 패널이 지도를 과도하게 가림 | 접힌 노출 높이를 76px+safe-area로 축소하고 첫 화면 상단 reserve를 줄임 | iPhone 17 Pro 402번 전체 경로에서 양 끝점 확인 |

현재 캡처는 `screenshots/reference-parity/20260713-post-plan-v1`에 있다.

- `api-bus-dynamic-overview.png`: 근거리 실제 버스 경로 동적 전체 맞춤
- `api-real-first-board-z17-settled.png`: 실제 보행 dash→406 승차점→BUS solid 연결
- `api-subway-transfer-z17-symbol.png`: 이전 노선 노드와 환승 전용 심볼 분리
- `api-subway-route-start-z17.png`, `api-subway-route-end-z17.png`: 실제 출발·도착 연결
- `subway-z15-connected.png`, `subway-z17.png`, `transfer-z17.png`: 고정 fixture 배율 회귀

남은 차이는 렌더링보다 공급 데이터와 SDK 제어 범위에 있다. TMAP 응답에 지도 3사의 소비자 경로 후보가 없으면 동일 경로를 만들 수 없고, native direction의 간격·삼각형 크기는 앱에서 지정할 수 없다. 공급자가 역사 내부 환승 geometry를 0m로 주는 경우에는 실내 동선을 임의 생성하지 않으며 환승 노드로만 표현한다. 주변의 모든 비경로 버스 정류장, 전국 실시간 식별자, 출구·승강장 실내 동선도 별도 데이터 공급자가 필요하다.

## 결론

현재 구현은 경로 선만 보여 주던 단계에서 벗어나 실제 공급자 경로, 복수 대안, 상세 안내, 교통·비용, 공통 상세 화면과 경로상 정류장 선택을 갖췄다. 이번에 확인한 출발·승차·도착 안내선과 확대 단계별 정류장 노출은 지도 3사와 같은 역할 분리 원칙에 근접했다. 다만 **서비스 전체가 네이버지도·TMAP·카카오맵과 완전 동급인 것은 아니다**. 특히 잠실역→홍대입구처럼 공급 API가 소비자 지도와 다른 후보를 반환하는 경우는 현재 화면 계층에서 해결할 수 없다. 전국 대중교통 시간표/실시간 식별자, 주변 전체 정류장 레이어, 실내 출구·하차문 데이터, 자전거 운영 SLA, 사용자 경로 옵션, 두 번째 상용 경로 공급자와 운영 관측성도 추가로 필요하다.

다음 구현 순서는 `두 번째 대중교통 공급자·관측성 → 전국 교통 식별자/시간표 → 경유지·접근성 옵션 → 실내 환승 데이터`가 적절하다.
