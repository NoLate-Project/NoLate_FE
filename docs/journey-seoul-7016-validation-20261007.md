# 서울 7016 실제 노선 자료 시험 — 2026-10-07

## 결론과 범위

사용자 요청에 따라 첫 실제 버스 시험 대상으로 **7016 상명대 방면, 서울역버스환승센터→경복궁역3번출구**를 선정했다.
공식 공개 자료 조회, 계약/표시 회귀 검사, 독립 시뮬레이터의 **미지원 경로 차단 E2E**까지 수행했다.
이는 실제 버스 자동 탑승·하차·완주 E2E 통과가 아니다. 실제 승객 GPS, 차량 연결, 음성, 해당 노선 APNs 안내는 시험하지 않았다.

## 공식 자료 관측

출처: [서울대중교통](https://bus.go.kr/), [공식 화면 JavaScript](https://bus.go.kr/app/app.js),
[공식 버스위치정보 API 설명](https://www.data.go.kr/data/15000332/openapi.do).
공식 화면이 사용하는 아래 read-only 요청을 소량 조회했다. 사용자 위치·계정·키를 보내지 않았다.

- `/sbus/bus/selectRouteInfo.do?rtId=100100447`
- `/sbus/bus/selectBusposInfo.do?routeId=100100447&isLowBus=0`

2026-10-07 12:50:11 KST 관측에서 노선 ID `100100447`, 실제 운행 차량 26건, 전체 형상 1,693점이 반환됐다.
차량별 source timestamp 범위는 `12:46:59~12:50:07`이었다. 응답 시각과 개별 차량 관측 시각은 다르다.
조회 성공을 모든 차량의 freshness 충족으로 간주하지 않는다. 차량 번호/차량 ID는 결과 파일이나 진단 요약에 보관하지 않는다.

| 순번 | 정류장 | ARS | 서울 정류장 ID |
| --- | --- | --- | --- |
| 44 | 서울역버스환승센터.강우규의거터 | 02007 | 101000007 |
| 45 | 소공동주민센터 | 02128 | 101000033 |
| 46 | 서울신문사 | 02137 | 101000039 |
| 47 | 광화문역2번출구.KT광화문지사 | 01118 | 100000023 |
| 48 | 경복궁역3번출구 | 01116 | 100000021 |

정적 정류장 관측 자료는 BE **test source** `Seoul7016PreviewFixture.kt`에만 추가했다.
`seoul-topis/public-web-preview` 출처를 그대로 남겼다. ODsay 응답, ODsay busID 또는 검증된 도보/버스 navigation geometry로 위장하지 않는다.
노선 변경 시 정적 자료를 최신으로 간주하지 않는다. 재현 probe는 예상 순서·ARS·방면이 달라지면 실패한다.

### 발견한 연결 위험

형상의 `sectord/ord`와 정류장의 `seq`는 단순 동일 번호로 연결할 수 없었다.
예를 들어 형상 `sectord=45`의 첫 점은 약 `(37.555621,126.935138)`로,
정류장 45의 `(37.562197167,126.97644367)`와 다른 위치였다.
따라서 번호만으로 잘라 정류장 이동선이라고 사용하지 않았다. 별도 link/section 식별자와 좌표 연속성 검증이 필요하다.
관측 차량의 방면도 상명대/은평차고지가 함께 반환돼 노선 ID만으로 차량을 선택하면 안 된다.

## 이번에 수정한 결함

1. 실제 상세 컴포넌트에 표시 `label`이 없는 BUS 구간을 넣으면 `leg.label.split`에서 render error 발생.
   누락 label에 안전하게 대응하고, 실제 lineName 또는 교통수단만 표시하도록 수정했다.
2. 소요시간 없는 경로의 레이아웃용 기본 가중치가 `1분`이라는 이동시간으로 노출됐다.
   가중치는 유지하되 표시를 `시간 미확인`으로 분리했다.
3. 불완전 경로가 `현재 시각 출발/도착`으로 생성되고 상세 병합에서도 되살아났다.
   검증된 시간 정보가 없으면 빈 시간으로 보존한다. 최종 상세에서는 `--:--`이며, 유효 공급자 시간표는 보존한다.
4. 진단 화면에서 native 검사 실패 사유가 보이지 않았다. 검사 결과 코드를 표시하도록 보완했다.

## 자동 검사

- BE `Seoul7016PreviewFixtureTest`, `JourneyBusRouteBindingTest`, `SavedJourneyInputValidatorTest`: **20 PASS**.
- FE 표시/상세/길안내 회귀 9 suites: **72 PASS**.
- FE 전체 회귀: **295 suites / 2,700 PASS**, 실패/skip 없음 (`/private/tmp/nolate-7016-fe-full.log`).
- read-only 공개 자료 probe 자체 검사: **2 PASS**. 순서·방면·ARS·노선·시간 형식 오류/빈 차량 목록을 거부하고 차량 식별자를 요약에서 제거한다.
- TypeScript `tsc --noEmit`: PASS.
- 실제 공개 자료 probe: PASS. 위의 source 관측과 미인증 상태를 출력한다.
- native 코드 변경 없음. 이번 단계에서 Swift 빌드/테스트 또는 실제 APNs 전송은 재실행하지 않았다.

재현 명령(FE):

```sh
node --test scripts/qa/seoul-7016-public-probe.test.mjs
node scripts/qa/seoul-7016-public-probe.mjs
```

공개 웹 요청은 조사/QA용이다. 이를 운영 provider adapter로 출시하지 않는다.
이 probe는 source freshness SLA나 continuous vehicle matching을 인증하지 않는다.

## 독립 시뮬레이터 E2E

기기 `NoLate Journey P0 Isolated 20261004`, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, iOS 26.5.
독립 창 `deviceWindow-AppWindow-8`의 `Show in Device Hub`로 detached 상태를 확인했다.
embedded Device Hub 화면이나 실기기는 조작하지 않았다.

1. test issuer/authenticated harness에 `seoul-7016-preview` 변형 선택. 실제 provider push OFF, 실제 DB 없음.
2. 공식 승차 정류장 좌표를 CoreSimulator에 주입. native 경로 검사 실행.
3. `PROVIDER_UNKNOWN`, `NON_API_ROUTE`, `FIRST_WALK_GEOMETRY_UNUSABLE`, `GEOMETRY_MISSING` 등을 표시.
4. 사용자 시험 동의를 체크해도 준비 비활성 상태 유지.
5. 나머지 실제 정류장 좌표 4개를 순서대로 **합성 GPS 점프** 입력.
   이것은 실제 이동 trace/정상 속도 replay가 아니며, 정류장 통과 판정 성공 시험도 아니다.
6. 서버 prepare/departure/activation/arrival/provider-push 시도 **모두 0**, native IDLE/출발 감지 0.
7. 상세 페이지 render crash를 재현 후 수정. 같은 독립 창에서 재진입 성공, 7016 및 4정거장 표시.
8. 누락 소요시간은 `시간 미확인`, 상세 시각 `--:--`, 잘못된 현재 위치 마커 없음.
9. 독립 창 Controls→Lock. 잠금 화면에 미지원 경로 Live Activity가 생성되지 않음을 확인.
10. GPS 주입 해제. 시험 서비스는 검증 후 종료했다. 앱 데이터/키/.env/운영 기본값은 변경하지 않았다.

증거: `docs/evidence/journey-seoul-7016-20261007/`.

- `01-real-route-blocked.png`: 첫 차단 관측.
- `02-detail-safe-missing-time.png`: render crash 수정 직후, 시간 병합 결함 수정 **전**의 중간 화면. 최종 시간 표시 증거가 아니다.
- `03-final-assessed-consented-blocked.png`: 동의 후 검사/시작 차단.
- `04-lock-no-unsupported-activity.png`: 실제 잠금 화면, 잘못된 카드 없음. 실제 APNs 수신 검증이 아니다.
- `05-final-detail-no-fabricated-time.png`: 최종 상세, 미확인 시간·시각.

## 다음 구현 순서 — 이번 노선을 계속 사용

1. 승인된 서울 버스 공식 API의 adapter/키·오류/TTL/방면 계약을 확보하고, ODsay localRouteId↔서울 route/stop namespace를 실제 응답으로 교차 검증.
2. 실제 도보 공급자 geometry + 실제 버스 section/link shape를 연결한다. 임의 직선/번호 동치로 대체하지 않는다.
3. 차량 source timestamp를 보존·검증하고, 사용자 GPS와 차량 후보의 지속 동행으로 탑승 근거를 구축한다. 조회된 차량 ID만으로 승객 탑승을 확정하지 않는다.
4. 실제 순번 47→48에서 ‘한 정류장 전’/접근/하차를 자동 판정하는 순수 코어·반례/지연/후진/이탈 검사 후 연속 GPS 독립 E2E.
5. 같은 상태를 지도·상세 경로·Live Activity·음성/알림에 연결. 해당 노선 APNs 업데이트/END와 잠금 화면 별도 E2E.

한 정류장 전 후보가 47번 정류장이라는 **정적 순서 확인**만 끝났다. 아직 그 시점의 실제 사용자 탑승 상태를 확인하거나 음성·하차 알림을 발생시키지 않는다.
