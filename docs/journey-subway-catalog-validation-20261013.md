# 지하철 독립 운행 catalog resolver — 부분 구현 및 독립 화면 검사

2026-10-13, Asia/Seoul. **R6 전체 완료/실제 지하철 주행/운영 ON의 증거가 아니다.**

후속으로 [소유 자동 세션 endpoint/JPA fence와 신규 독립 화면 6사례](journey-owned-subway-observation-validation-20261013.md)를
추가했다. 이 문서의 “새 endpoint/automatic-session 연결 없음”은 그 이전 snapshot이다.
공식 운영 catalog 설치와 native 승객 결합 미완료는 여전히 유지한다.

## 구현

BE `IndependentSavedSubwayServiceCatalog`는 서버 소유 역 대응·운행 계통 자료를 받는 순수
resolver다. 원본 ODsay city/line/station/way와 서울 역 ID 대응, 각 계통의 전체 정차 순서가
모두 있어야 저장 구간을 정확한 연속 부분 순서로 해석한다. 일반 정차를 건너뛰어 급행으로
만들지 않고, 이름/좌표 근접/ID 정렬/배열 역전/양 끝 역만의 추측을 하지 않는다.

자료 상한은 역 10,000/계통 256/선택 후보 32/계통 정차 500이다. 과다 후보를 절단하지
않는다. 입력의 중복·역 대응 충돌·방면 충돌·미대응 정차를 전체 거절한다. 유효 기간은
고정된 `[validFrom, validUntil)`이고 최대 31일은 NoLate 정책이지 공급자 SLA가 아니다.
원본과 service/pattern의 목록은 복사·불변화해 호출자 또는 Java/cast 소비자가 검증 뒤 바꿀 수 없다.

`SavedJourneySubwayObservationCheck`는 다중 계통을 대조하고 I/O 전후 catalog 유효성을
검사한다. 소유권/login/revision 재검사는 유지한다. 원본 누락 시 catalog 유효성/resolve 및
열차 조회를 모두 하지 않는다. 동일 열차가 복수 운행 패턴에 맞거나 반복 역 occurrence가
모호하면 후보를 선택하지 않는다. 여러 분기 종착역의 서로 다른 열차는 별도 관측으로 유지한다.
반복된 전체 저장 구간이 있는 계통을 발견하면 전체 resolve를 차단한다. 모호한 순환 계통만
버리고 다른 일반 계통을 남기는 우회도 후보 순서에 무관하게 금지한다.
모든 결과의 승객 탑승/현재 위치/남은 역 수는 여전히 false/null이다.

공식 운영 catalog 수집/설치, 파일 loader, Spring production bean, 사용자 업로드, 새 endpoint,
automatic-session/native 승객 결합을 추가한 것은 아니다. 독립 자료를 넣었다는 사실만으로
공식 출처가 입증되지 않는다. 기존 공개 역 Excel에 ODsay 대응·운행 계통 정차 순서가 없는
한계는 이전 [R6 기록](journey-r6-subway-observation-validation-20261012.md)을 따른다.
공식 [ODsay 명세](https://lab.odsay.com/guide/releaseReference?platform=web)와
[가이드](https://lab.odsay.com/guide/guide?platform=web)의 공개 자료만 추가 확인했고 개인 키 조회는 없었다.

## 자동 검사

- BE 관련 7 suites / **91 PASS**, 실패·오류·skip 0. catalog 17, matcher 18, saved check 17,
  원본 evidence 11, 열차 파서 20, HTTP 7, HTTP fixture 1(16사례 순회)이다.
- FE 초기 focused 2 suites / **35 PASS**; 순환 우회 보강 후 전체 **323 suites / 3,164 PASS**(42.189초).
- TypeScript 및 두 저장소 `git diff --check` PASS. native 소스 변경/신규 iOS 빌드/Swift 실행은 없다.
- 첫 fixture 확장 컴파일은 Kotlin 문자열 `else` 공백 누락으로 실패했고 수정 후 통과했다.
  87→88→불변성 회귀 추가 90→순환 우회 보강 91건으로 늘었다. 실패 로그를 삭제하지 않는다.
- UI 조작 helper 최초 실행은 diff AX에서 버튼이 없다고 중단했다. 전체 최신 AX를 읽도록
  고쳤으며 그 시도는 E2E 통과 건수로 계산하지 않는다.
- 순환 우회 추가 후 첫 cold start는 watch-disabled Metro의 이전 번들(15버튼)이었다.
  그 화면을 새 사례 통과로 계산하지 않았다. 소유 PID/cwd를 확인한 8088만 재시작하고
  같은 앱을 UI로 다시 열어 16번째 버튼과 결과를 확인했다.
- 해당 unsigned 시험 앱은 로그인 전부터 공유 Keychain `-34018` 경고를 낸다. 이 실행은
  실계정 로그인/정상 서명 Keychain·인증 복구 검증이 아니며 이를 제품 인증 통과로 계산하지 않는다.

로그: `/private/tmp/nolate-r6-independent-catalog-*20261013.log`.
BE 최종 자동 검사: `nolate-r6-independent-catalog-be-final5-20261013.log`.
최종 UI 서버: `nolate-r6-independent-catalog-harness-loop-final-20261013.log`.

## 독립 시뮬레이터 E2E

`NoLate Mixed Journey E2E 20261012`, iOS 26.5,
`4EE367B1-CDC6-4585-A64B-CB554EEB7DE2`, `deviceWindow-AppWindow-1`.
`Show in Device Hub` 툴바로 분리 창을 확인했다. embedded Hub/다른 기기를 조작하지 않았다.
Safari 딥링크와 앱 열기를 UI로 사용했고 고정 8088 개발 서버의 새 번들을 선택했다.
로그인 화면에서는 실제 계정 정보를 입력하지 않고 진단 딥링크를 다시 열었다.

| 합성 사례 | 화면 결과 | 로컬 공급자/소유권 읽기 |
| --- | --- | --- |
| 정상 / 복수 | TRAIN_REFERENCES_ONLY, 1 / 2개·탑승 미확정 | 1 / 2 |
| 반대 방면 | SERVICE_PATTERN_OR_FRESHNESS_MISMATCH, 0개 | 1 / 2 |
| 오래된 / 부분 목록 | TRAIN_OBSERVATIONS_UNAVAILABLE, 0개 | 1 / 2 |
| 조회 중 경로 변경 / 로그인 철회 | SAVED_ROUTE_CHANGED / OWNER_CHANGED | 1 / 2 |
| catalog 대응 없음 | STATION_CROSSWALK_REQUIRED | 0 / 2 |
| redirect | PROVIDER_UNAVAILABLE | 1 / 1 |
| 저장 원본 역 ID 없음 | RAW_SUBWAY_IDENTIFIERS_REQUIRED | 0 / 2 |
| 분기·종착역 분리 | TRAIN_REFERENCES_ONLY, 2개·탑승 미확정 | 1 / 2 |
| 급행 정차 대조 | TRAIN_REFERENCES_ONLY, 1개·탑승 미확정 | 1 / 2 |
| 중복 운행 패턴 | SERVICE_PATTERN_AMBIGUOUS, 0개 | 1 / 2 |
| 중간 역 대응 누락 | STATION_CROSSWALK_REQUIRED, 0개 | 0 / 2 |
| catalog 만료 | CATALOG_UNAVAILABLE, 0개 | 0 / 1 |
| 순환 구간의 모호성을 일반 후보로 우회 | STATION_CROSSWALK_REQUIRED, 0개 | 0 / 2 |

최초 15사례를 AX/화면으로 확인하고 후속 새 번들에서 정상 및 순환 우회 추가 사례를 확인해
총 16사례다. 전체 16사례를 마지막 번들에서 재실행했다는 뜻은 아니다. 이 버튼은 합성 관측 사례 선택이지 출발/탑승/하차
단계 전환이 아니다. 전 사례에서 실제 공급자 0회·GPS 미사용·위치/남은 역 미표시를 확인했다.
정상 성공 뒤 소유 PID/main-class를 확인한 test-source 15547 서버만 정상 중단하고,
재검사에서 **서버 연결 실패 · 이전 결과 사용 안 함**을 확인했다. 이후 같은 fixture를
재기동해 불변성 보강 최신 코드의 정상/신규 5사례/원본 누락을 재검사했다.

증거 폴더: `docs/evidence/journey-subway-catalog-20261013` 및 `ui-results.json`.
[분기](evidence/journey-subway-catalog-20261013/20-final-branches-result.png),
[급행](evidence/journey-subway-catalog-20261013/21-final-express-result.png),
[중복 패턴](evidence/journey-subway-catalog-20261013/22-final-ambiguous-result.png),
[중간 역 누락](evidence/journey-subway-catalog-20261013/23-final-unmapped-result.png),
[만료](evidence/journey-subway-catalog-20261013/24-final-expired-result.png),
[원본 누락](evidence/journey-subway-catalog-20261013/25-final-raw-missing-result.png),
[순환 구간 우회 차단](evidence/journey-subway-catalog-20261013/27-loop-shadow-result.png),
[서버 단절](evidence/journey-subway-catalog-20261013/18-server-disconnected-result.png).
초기 11번 result 파일은 결과 상단이 잘려 최종 25번 증거로 대체한다. 원본 파일은 보존한다.

## 다음 연결 조건

1. 독립 검증된 공식 ODsay↔서울 역 대응 및 계통별 분기/종착/급행 정차 자료 설치.
2. 승인된 실제 열차 정상 응답 계약 확인. 현재 개인 키/실제 API·APNs 호출 0회다.
3. owned automatic-session/신선도/취소·교체 fence를 둔 서버→native 계약과 승객 탑승 근거 결합.
4. 터널·복수 후보·잘못 탄 노선·다음 환승을 실제 상세/Activity/음성/알림 projection에 연결하고
   독립 GPS/잠금 E2E. 열차 관측만으로 승객 위치를 채우지 않는다.

이 단계에서 운영 DB/`.env`/source Info.plist/Release 설정/실기기/OS 알림 권한을 변경하지
않았다. 운영 5522는 중지 상태이며 운영 백업·H2·기존 실패 자료는 보존한다.
후속 재확인을 위해 test-source 15547 harness와 새 8088 Metro만 유지한다. 이전 혼합 경로
15546 서버는 중지 상태다. 독립 창에는 마지막 순환 구간 차단 결과를 남겼다.
