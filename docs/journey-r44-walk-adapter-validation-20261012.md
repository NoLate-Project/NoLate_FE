# R4-4a 원본 도보 형상 어댑터 검증

실행일: 2026-10-12 (Asia/Seoul). 제한된 FE 어댑터 slice이며 R4 전체 완료가 아니다.

## 구현

기존 `getWalkingRouteViaTmap`의 같은 응답을 두 경로로 처리한다. 화면용 도로 파서는
기존대로 유지하고, 새 `parseTmapPedestrianGeometry`는 원본 FeatureCollection의 전체
좌표를 별도 검사한다. 기존 두 search option 이외 추가 API 호출을 만들지 않았다.
요청 좌표는 await 전에 복사하며 `WGS84GEO`, `sort=index`를 명시한다.

- 숫자 WGS84 좌표만 허용한다. 문자열/NaN/null/좌표 축 교체/고도 좌표는 보정하지 않는다.
- 원본 Feature index는 증가해야 한다. 정렬/역순 복구를 하지 않는다.
- Point는 좌표를 검증하지만 선형에 끼워 넣지 않는다. LineString 이외 선형은 미지원이다.
- 선형 간 공유 끝점은 정확히 같아야 한다. 작은 틈도 직선 connector로 채우지 않는다.
- 원본 선형 좌표 최대 2,000개, Feature 최대 4,096개다. 초과하면 전체 거부한다.
- 인접한 정확한 중복 좌표만 합친다. 원본 개수와 전달 개수를 각각 보관한다.
- segment 최대 150m, 요청 출발/도착 일치 오차 최대 30m를 적용한다.
  보수적인 내부 후보 검사 정책이며 실제 도보 정확도나 위치 SLA를 보증하는 값이 아니다.
- 결과는 별도 `pedestrianGeometry`에 `provider=tmap`, `PEDESTRIAN_FEATURE_COLLECTION`으로
  보관한다. 자동 안내의 기존 native trusted geometry source로 등록하지 않았다.

TMAP 요청 계약은 [공식 보행자 경로안내 문서](https://tmap-skopenapi.readme.io/reference/%EB%B3%B4%ED%96%89%EC%9E%90-%EA%B2%BD%EB%A1%9C%EC%95%88%EB%82%B4)의
좌표계/정렬/endpoint 항목을 확인했다. 문서 열람 외 실제 공급자 API 요청은 없었다.
원본 index 존재·LineString 연속성 등의 엄격한 후보 정책은 현장 전체 응답을 지원한다고
인증한 공급자 보장 조건이 아니다. 실제 응답 확보 후 지원 범위를 확인해야 한다.

## 자동 검사

| 검사 | 결과 |
| --- | --- |
| 새 순수 파서/요청 연결/개발 화면 | 3 suites / 37 tests PASS |
| 최종 FE 전체 | 303 suites / 2,842 tests PASS |
| TypeScript | PASS |
| Swift 기존 정책 회귀 | 327 tests PASS |
| Node QA | 40 tests PASS |
| FE diff whitespace | PASS |

요청 연결 테스트는 주입한 합성 응답만 사용한다. 요청 중 caller 좌표 변경, 기존 API 호출
횟수 유지, raw 후보 거부 시 기존 display 경로 보존, transit evidence 미승격을 확인했다.
잘못된 좌표·순서·희소 배열·크기 초과·장거리 segment·0길이와 입력 불변성을 검사했다.
Release에서는 새 개발 화면이 schedule로 redirect되는 것도 검사했다.

초기 테스트 fixture의 `test.each` 배열 인자 작성 오류 및 환경 모듈 mock 누락/URLSearchParams
타입 오류를 고친 뒤 위 최종 결과를 얻었다. 첫 실패 실행을 합격으로 집계하지 않는다.
E2E 첫 시도에서 Debug 공개 경로 목록 누락으로 로그인 화면에 도달했다. Debug-only 등록 후
번들 재시작·재진입하고 최종 전체 FE/타입 검사를 다시 수행했다.
BE 코드는 변경/재검사하지 않았다. 네이티브 소스/바이너리도 변경하거나 새 빌드하지 않았다.

로그는 `/private/tmp/nolate-r44-focused-final-20261012.log`,
`/private/tmp/nolate-r44-full-fe-final-20261012.log`,
`/private/tmp/nolate-r44-typecheck-release-20261012.log`,
`/private/tmp/nolate-r44-swift-20261012.log`, `/private/tmp/nolate-r44-qa-20261012.log`다.

## 독립 시뮬레이터 E2E

대상은 `NoLate R2 Session E2E 20261008`, iOS 26.5,
UDID `96AF9A48-4721-4335-B7BF-10B9382B7A30` 한 대다.
실제 detached 창 `deviceWindow-AppWindow-9`에서 CUA로 버튼을 조작했다.
호스트 앱 이름은 Device Hub지만 `Show in Device Hub` 툴바가 있는 독립 창이며 embedded
preview를 조작하지 않았다. 다른 시뮬레이터·실기기는 변경하지 않았다.

실제 앱의 `/internal/journey-walk-adapter`에서 production parser와 같은 함수를 실행했다.

1. 연결된 합성 원본: 통과, 원본 4점/전달 3점/2개 선형.
2. 끊어진 원본: `DISCONNECTED_LINES`, 성공 개수 행 제거.
3. 잘못된 좌표: `INVALID_COORDINATE`, 성공 개수 행 없음.
4. 다른 요청 도착지: `ENDPOINT_MISMATCH`, 성공 개수 행 없음.
5. 정상 원본 재선택: 통과와 개수 행 복구. 모든 경우 자동 길안내 OFF 유지.

화면 증거:

- [정상 원본](evidence/journey-r44-walk-adapter-20261012/01-connected.png)
- [선형 끊김 차단](evidence/journey-r44-walk-adapter-20261012/02-disconnected-blocked.png)
- [좌표 오류 차단](evidence/journey-r44-walk-adapter-20261012/03-invalid-coordinate-blocked.png)
- [요청 도착지 불일치 차단](evidence/journey-r44-walk-adapter-20261012/04-endpoint-blocked.png)

이번 E2E는 합성 raw 응답 어댑터의 UI 검사다. GPS replay/버스 탑승/잠금 Live Activity/
실제 APNs/실제 공급자 응답 수신/현장 GPS를 재검증한 실행이 아니다. 실제 교통 API 및
APNs 요청은 0건이며, 로컬 fixture 서버도 이번 실행에는 사용하지 않았다.

## 남은 실제 경로 연결 조건

1. 실제 pedestrian 응답의 feature/index/연결 조건을 확인한다. 합성 fixture를 실제 응답으로
   표시하거나 display parser의 축약 경로를 raw geometry로 재사용하지 않는다.
2. 서버가 선택 ODsay 버스 경로/revision/승하차 정류장을 소유한 상태에서 별도 도보 공급자
   요청 endpoint·출처·조회 시각을 검증하는 혼합 공급자 계약을 만든다. 현재 결과는 로컬
   후보 검사일 뿐이고 서명/최신성/소유권/경로 revision 검증을 제공하지 않는다.
3. native/서버 wire에 이 출처를 명시적으로 추가하고 재검증한 뒤 첫/최종 도보에 연결한다.
   ODsay `geometryInputComplete=false`를 TMAP 결과로 강제 true 처리하지 않는다.
4. 공식 버스 stop-shape 매핑은 이전 실제 검사에서 선택 순번 44의 occurrence 2개로 차단됐다.
   이번에 공식 API를 재조회하지 않았으므로 최신 매핑 결과로 단정하지 않는다. 검증된 공급자
   형상/공식 section 근거 없이 nearest 선택·허용 거리 확대·정류장 생략으로 해소하지 않는다.
5. 위 조건이 충족된 실제 경로로 GPS/별도 차량·상세·Live Activity·원격 APNs를 묶은 후속
   E2E가 필요하다. 제품 기본 ON, 지하철/환승/음성 및 실기기 합격은 여전히 별도 단계다.

`.env`, 제품 기본 OFF와 iOS Info.plist는 보존했다. Info.plist SHA-256은 이전과 같은
`7d9287e4cffd4a788f27804727328dafaa1476873e570b5cb4a4b984e6130359`다.
자격증명·원본 응답·사용자 GPS를 문서/화면에 남기지 않았다. commit/push/deploy하지 않았다.
