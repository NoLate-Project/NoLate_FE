# R1–R6 재검사 — 2026-10-08

최신 후속: 실제 7016 정류장 106개·형상점 1,693개를 진단용으로 파싱했고,
공개 번호 오류 1행을 매핑에서 제외했다. BE 회귀는 352건, Swift는 285건 PASS다.
[실응답 진단 후속](journey-r1-catalog-diagnostics-validation-20261008.md).
아래 344건/FIELD_MISSING/형상 미호출과 GPS E2E는 앞선 실행 기록이며,
R2 Runtime 미연결·R3/R5/R6 미구현 판정은 변경되지 않았다.

## 결론

**기존 구현의 회귀 검사는 통과했지만, R1–R6 전체 구현/전체 E2E 통과는 아니다.**
R2의 새 차량 동행 코어는 Runtime 미연결이고 R3/R5/R6은 미구현이다.
실제 공급자 계약 실패와 Mac 잠금을 별개의 미완료 사유로 기록한다.
사용자가 권한을 허용했으므로 기존 허가 질문을 반복하지 않았다. 운영 배포/DB 변경·실기기 조작은 하지 않았다.

## 자동 검사

| 검사 | 이번 실행 결과 | 검증 경계 |
| --- | --- | --- |
| BE 교통·여정·Live Activity | 50 suites / 344 tests PASS, 실패·오류·skip 0 | MySQL-tag 제외. Firebase/APNs payload·소유권·재조정 계약 포함. 실제 외부 전달 아님 |
| Swift Package | 285 tests PASS, 실패 0 | R2 새 동행 코어 15건 포함. 순수 정책이며 UIKit/CoreLocation/ActivityKit 실행 검사는 아님 |
| FE Jest 전체 | 295 suites / 2,700 tests PASS | 컴포넌트/bridge·계약 mock 검사. 실제 단말 E2E 아님 |
| TypeScript | PASS | `tsc --noEmit` |
| QA 도구 | 17 tests PASS | replay/readiness/전송 도구 안전장치, 실제 전송 아님 |
| 진단 빌드·simulator 호환 설정 | 16 tests PASS | 설정/launcher 단위 검사, 실제 Xcode 새 빌드 아님 |
| FE·BE diff whitespace | PASS | 기존 dirty 변경 보존 |

재현 명령:

```sh
# BE worktree
./gradlew test --tests 'com.noLate.transit.*' --tests 'com.noLate.journey.*' --tests 'com.noLate.notification.liveactivity.*' -Pkotlin.incremental=false -PexcludeMysqlTests=true
# FE worktree
npm test -- --runInBand --no-watchman
npm run typecheck
node --test scripts/qa/*.test.mjs
node --test scripts/journey-diagnostics-config.test.mjs scripts/xcode-simulator-compat.test.mjs
# FE/modules/nolate-live-activity
swift test
```

로그는 `/private/tmp/nolate-r1-r6-{be,swift,jest,typecheck,qa,build-config}-20261008.log`다.
처음 FE 실행은 기존 임시 node_modules의 파일 소실로 코드에 도달하기 전에 실패했다.
주요 패키지의 lock/설치 버전 일치를 확인한 뒤 **ignored worktree node_modules 심볼릭 링크만**
기존 primary FE node_modules로 전환해 재실행했다. 두 의존성 디렉터리와 package/lock 파일은 보존했다.
의존성 재설치·업그레이드·사용자 `.env` 수정은 하지 않았다.

## R1 실제 API 검사

사용자 승인 후 `SEOUL_BUS_API_KEY`의 동일 중복 값을 단일 값으로 읽어 공식
`ws.bus.go.kr/api/rest/busRouteInfo/getStaionByRoute`에 고정 7016 노선 요청 **1회**를 전송했다.
HTTP 평문 시험이며 키를 별도 단기 프로세스에만 전달했다. 자동 polling/재시도/redirect는 없다.

```json
{
  "probe": "SEOUL_7016_ROUTE_CATALOG",
  "navigationReady": false,
  "stopSectionCrosswalkVerified": false,
  "passengerVehicleAssociation": false,
  "transport": "HTTP_EXPLICIT_TEST",
  "status": "PROVIDER_CHECK_FAILED",
  "networkAttempts": 1,
  "failureCategory": "INVALID_RESPONSE",
  "failedOperation": "STOPS",
  "contractFailure": "FIELD_MISSING"
}
```

probe exit 2 / Gradle exit 1. 앞선 401 실패와 구분한다. 정류장 정상 목록을 확보하지 못해
형상 `getRoutePath`는 **0회**다. 추가 차량 위치/지하철 credential 요청도 0회다.
현재 분류만으로 어떤 필드/행인지, 서비스 키나 제공처 중 어느 쪽이 원인인지 확정할 수 없다.
원문 응답·URI·키를 파일/로그에 남기지 않았다. 필수값·좌표계·정류장 순서 검사를 낮추지 않았다.
공식 [노선정보조회 명세](https://www.data.go.kr/data/15000193/openapi.do)의 필드와 endpoint를 재확인했다.
실제 형상/방면·구간/정류장 crosswalk·도보 geometry·차량 동행 지원 인증은 여전히 미완료다.

## 독립 시뮬레이터 E2E

대상: `NoLate Journey P0 Isolated 20261004`, iOS 26.5,
UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, detached `deviceWindow-AppWindow-8`.
`Show in Device Hub` 컨트롤이 있는 분리 창만 CUA로 조작했다. embedded 관리 화면/실기기는 조작하지 않았다.
기존 설치 바이너리의 baseline 검사이며 **새 R2 코어를 native 재빌드/연결한 E2E가 아니다**.

1. 7016 미지원 상세 화면의 안내 준비 비활성·시간 미확인·IDLE를 확인했다.
2. provider OFF/DB 없음/합성 JWT인 loopback harness(15544/15545)를 시작했다.
   dotenv 비활성·일반 API loopback 격리 Metro(8088)도 시작했다.
3. 독립 창에서 저장 경로 다시 불러오기 → 지원 검사 → 제한된 위치 시험 동의 → 준비를 눌렀다.
   이 버튼들은 동의/준비용이며 출발/탑승/다음 구간을 강제하지 않는다.
4. **ARMED·출발 0회**를 AX/화면에서 확인했다.
5. `marker-walk` 연속 합성 CoreSimulator GPS만 입력했다. **ACTIVE·출발 1회·ACKNOWLEDGED**를 확인했다.
   서버 prepare/departure/activation은 각각 1회였다. 단계 변경 bridge 호출은 없다.
6. 정상 상세 컴포넌트에서 “합성 정류장 1까지 · 도보 약 60m”, 전체 경로 바의 위치 화살표,
   첫 도보 목록의 “현재 위치”를 확인했다. 지도는 명시적 offline fixture이므로 실제 지도 타일/GPS 지도 정확도 합격은 아니다.
7. `marker-finish` GPS 입력 후 같은 상세에 “승차 지점 근처”와 승차 경계의 마커를 확인했다.
8. `dwell` GPS 입력은 완료했지만 **Mac이 잠겨** 그 뒤 WAITING/위치 만료/종료·잠금 카드 UI를 읽지 못했다.
   사용자에게 Mac 수동 잠금 해제를 요청했다. 우회/자동 해제/다른 UI 도구는 사용하지 않았다.
9. 합성 GPS를 clear했다. 읽기 전용 fixture 검사에서 최종 서버 **STOPPED**, prepare/departure/activation 각 1,
   rejected/trap/실제 push 수락 각 0을 관측했다. 종료 원인·native 종료 큐·카드 제거를 확인한 것으로 승격하지 않는다.

화면 관측은 이번 CUA 도구의 AX/스크린샷 출력에 있다. 잠금 뒤 화면을 촬영했다고 기록하지 않는다.
readiness 집계는 `/private/tmp/nolate-r1-r6-readiness-20261008.json`에 토큰 없이 저장했다.
실제 APNs 발송·잠금 화면 원격 UPDATE/END 수신은 **이번 실행에서 0회/미검증**이다.
이전 APNs 증거 문서는 과거 이력으로 유지하며 이번 재검사 성공으로 합산하지 않는다.

정리: 서버 STOPPED 집계/GPS clear 이후 해당 시험 앱 프로세스를 종료했다.
이번 Metro PID 2236/시험 harness JVM PID 2488의 cwd를 각각 FE/BE worktree로 확인하고 종료했다.
사용자 앱 데이터·키·DB·다른 시뮬레이터·실기기는 삭제/변경하지 않았다.
Mac 잠금으로 종료 뒤 native 큐/잠금 카드 UI까지 확인한 것은 아니다.

## 단계별 판정

| 단계 | 판정 | 미완료 사유 / 다음 합격 조건 |
| --- | --- | --- |
| R1 공급자 계약 | 부분 통과, 실제 경로 게이트 실패 | 내부 계약·실패 처리 회귀 PASS. 실제 정류장 FIELD_MISSING 원인을 안전한 필드·행 진단으로 구분하고 정상 목록/형상·crosswalk·도보 경로 확보 필요 |
| R2 탑승·주행 | 순수 코어 PASS, 전체 E2E 미실행 | 15건 동행 판정 PASS. Runtime에는 BusApproach만 연결되고 public boardingConfirmed=false. 같은 소유권/TTL의 실제 관측 연결 및 GPS+독립 차량 입력 E2E 필요 |
| R3 하차·최종 도보 | 테스트 불가: 미구현 | 한 정류장 전/하차 지점 접근과 실제 하차 증거를 구분하는 reducer·도착 체류 확인부터 구현 필요 |
| R4 경로 상세/Live Activity | 첫 도보 상세 E2E 부분 PASS | 첫 도보 bar/list 잔여 거리·접근 표시 확인. 버스 진행 projection 미구현, 새 코어 연동·현재 실행 잠금/실제 APNs E2E 미완료 |
| R5 음성/안내 알림 | 테스트 불가: 미구현 | speakJourneyProbe는 진단용. 실제 navigation event router/TTS/중복·만료/오디오 충돌 정책 연결 필요 |
| R6 지하철/환승 | 테스트 불가: 미구현 | 열차/역/방면·원본 시각 계약과 지하 불확실성/환승 상태기계·Runtime 연결 필요. 기존 도착정보 API나 수동 상태기계가 이를 대체하지 않음 |

코드 근거: `NoLateJourneyAutomaticSession.swift`는 core/bus 접근 snapshot만 보유하고,
`NoLateAutomaticGuidanceProjection.swift`는 첫 도보/접근/WAITING/미확정 candidate만 투영한다.
`NoLateJourneyRouteNormalizer.swift`는 `fullAutomaticGuidance=false`,
`NoLateJourneyAutomaticRuntime.swift`의 외부 snapshot은 `boardingConfirmed=false`다.
단순 수동 RIDING/TRANSFERRING enum 존재를 자동 내비게이션 연결로 간주하지 않는다.

## 재개 순서와 실기기 전 게이트

1. Mac 잠금 해제 후 기존 독립 창의 대기·stale·native 종료 큐/잠금 카드 제거를 재검사한다.
2. 공급자 실패 진단은 필드 이름/행 순번 등 allowlist 메타데이터만 반환하도록 보강하고,
   계약 테스트 후 명시적으로 횟수를 제한한 실제 응답 검사를 수행한다. 키 변경을 먼저 추측하지 않는다.
3. R2 Runtime/단일 snapshot 연결 → R3 → R4 → R5 → R6 순으로 구현/단위/독립 시뮬레이터 E2E를 각각 통과시킨다.
4. 실제 APNs는 승인된 단일 시험 설치·실제 provider·원격 전용 UPDATE/END와 같은 활동의 잠금 카드 수신을 따로 검증한다.
5. 실기기에서는 실제 GPS·터널/지하 단절·평행/반대 노선·다른 이동수단 동행·오탑승/하차 지나침,
   무음/집중 모드/오디오 중단·장시간 잠금/배터리·권한 회수·로그인 세대 변경을 runbook대로 검사한다.
   현재 DEBUG/SIMULATOR 가드를 제거하거나 운영 기본 ON으로 바꾸는 것은 이 검사의 대안이 아니다.
