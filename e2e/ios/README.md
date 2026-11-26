# iOS XCUITest

Device Hub의 macOS 접근성 제어 대신 XCTest가 시뮬레이터의 설치된 NoLate 앱을 직접 조작한다. 앱 화면이나 인증 로직에 테스트 우회 코드를 넣지 않는다.

## 조기 관측에 따른 더 이른 환승 재연결 회귀

```bash
python3 e2e/ios/run-eta-early-transfer.py --java '<JDK 21 java 경로>'
```

H2/합성 시간표·차량 관측을 실제 Worker → API → 지정 시뮬레이터의 설치 앱으로 검증한다.
첫 시간표 승차 +330초/하차 +1530초, 관측 승차 +197초를 구분한다. 기존 환승 기준은
1833초지만 같은 도보243초+여유60초를 유지한 조기 기준은1700초다. 2014 대신
2012를 연결해 +2752초(46분) 대신 +2452초(41분)가 표시되는지 독립 기대값으로 검사한다.
원본 첫 열차 시간표를 지우거나 전체 도착에서 조기 보정을 두 번 빼지 않는다.
기존 서버·운영 DB·다른 시뮬레이터를 변경하지 않으며, STANDARD 알림 모드로 OS 알람을
예약하지 않는다. 출력은 새 private temp 폴더에 남기고 5523/8086 및 앱 endpoint를 정리한다.
**고정된 private backend 시계/합성 공급자 검증이며 실제 지도 정확도·실운행·벨소리 검증이 아니다.**

## 준비

합성 격리 실행기(`run-eta-early-transfer.py`, `run-eta-quota-offline.py`,
`run-eta-native-delivery.py`)는 아래 일반 서버 준비 절차와 달리 H2/5523과 Metro/8086을
직접 소유한다. 지정 UDID `9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69`의 앱 기동은 공개
XCTest `terminate()`/`open(URL)`로 수행하며, `ui-private-lifecycle/result.xcresult`에서
실제 기기 일치·1 pass·0 skip을 확인한다. 이 결과는 탐색 초기화와 URL 전달만 증명한다.
이어지는 로그인·Worker/API·설치 앱 검증을 대체하지 않는다. 데이터 삭제나 다른 기기/전역
CoreSimulator 재시작은 수행하지 않는다. Metro 작업자는 2개로 제한한다.

실운행 및 OS 전달 실행기의 `--java`는 서버뿐 아니라 Gradle 준비에도 적용한다.
준비 빌드는 Java 경로의 JDK, 단일 사용 데몬, 작업자 2개를 사용하며 공유 데몬을 중지하지 않는다.

Worker 증거 파일은 Jackson이 기록을 마치기 전에도 존재할 수 있다. 격리 실행기는 이전
파일과 다른 revision의 **완성된 JSON 객체**만 최대 60초 동안 기다리며, 부분 JSON이나
서버 종료를 통과로 취급하지 않는다. 기다리는 동안 Worker/API를 다시 실행하지 않는다.

- Xcode 및 iOS Simulator 런타임.
- **전용** 시뮬레이터에 `com.anonymous.nolatefe` 앱 설치. 기존 사용자 시뮬레이터를 초기화하지 않는다.
- 기존 개발 서버가 `http://127.0.0.1:5522`에서 실행 중이어야 한다. 테스트가 별도의 서버를 실행하거나 포트를 점유하지 않는다.
- Debug 앱은 `REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 npx expo start --localhost --port 8081`로 Metro를 실행하고 앱을 로드한다. Release 앱은 빌드 시 로컬 API 주소를 명시해야 한다.
- 앱의 초기 로딩을 완료하고 로그아웃된 로그인 화면에서 시작한다. 최초 시뮬레이터 부팅/Metro 번들 생성 시간은 UI 검증 시간과 구분한다.

## 실행

저장소 루트에서 실행한다. `<UDID>`는 `xcrun simctl list devices booted`로 확인한다. 결과 경로는 매번 새 경로를 사용한다.

```sh
python3 e2e/ios/run.py --device '<UDID>' --output /private/tmp/nolate-ui-smoke
```

이메일·비밀번호 입력, 로그인 버튼 클릭, 이메일 형식 오류 메시지를 확인한다. 실제 계정의 비밀번호를 사용하지 않는다.

신규 회원 시나리오는 정식 회원가입 API로 별도 테스트 계정을 준비한다. 비밀번호와 토큰을 저장소에 넣지 않는다.

```sh
python3 e2e/ios/create-fixture.py /private/tmp/nolate-ui-credentials.json
python3 e2e/ios/run.py --device '<UDID>' \
  --credentials /private/tmp/nolate-ui-credentials.json \
  --only testNewMemberScheduleJourney \
  --output /private/tmp/nolate-ui-journey
```

자격증명은 권한 0600 파일에서 읽어 `TEST_RUNNER_` 환경변수로 전달한다. 결과 폴더는 권한 0700으로 생성한다. 결과에는 테스트 계정 이메일과 앱 스크린샷이 포함될 수 있다.

동일 계정으로 API에 다시 로그인하면 서버 세션 세대가 바뀌어 기존 앱 세션이 무효화된다.
일정 저장 뒤 재실행·인증 복원을 확인하는 동안에는 API 검증용으로 재로그인하지 않는다.
`testNewMemberScheduleJourney`의 `SYNTHETIC_SCHEDULE_EDITED_TITLE` 로그에서 합성 제목을
확인하고, `TEST_RUNNER_E2E_EXPECTED_SCHEDULE_TITLE`에 전달해
`testSavedCalendarScheduleAfterProcessRestart`를 실행한다. 이 검사는 재로그인 없이
달력과 저장 제목이 복원돼야 통과한다. API 저장값 대조는 해당 계정의 화면 검증을 마친 뒤 수행한다.
서버 세션을 의도적으로 교체한 경우에는 `testExistingSyntheticMemberLogin`으로 먼저 앱에
명시적으로 로그인한다. 재실행 검사 안에서 자동으로 재로그인해 인증 유실을 감추지 않는다.

외부 공유 뒤 달력 갱신은 두 경우를 나눠 검사한다. `testExistingBusTicketAfterProcessRestart`는
이미 저장된 버스 승차권이 있는 합성 계정에서 재로그인·재등록 없이 프로세스를 재실행하고,
다음 날 달력과 상세 화면을 확인한다. `testTrainTicketTextShareWarmReturn`은 버스 표만 있는
합성 계정에서 다음 날 달력을 먼저 표시하고 기차 텍스트를 공유한 뒤, **앱을 종료하지 않고**
60초 안에 복귀해 새 표가 보이는지 확인한다. 기차 fixture를 이미 가져온 계정에서는 실행하지 않는다.
`testBusTicketPDFDuplicateExistingShare`는 기존 PDF 표의 중복 거절만 독립적으로 확인한다.
공유 확장 확인 버튼은 전체가 보이도록 스크롤한 뒤 한 번 누르고 저장 버튼 활성화를 기다린다.
부분 노출 상태의 `isHittable`만으로 탭 성공을 판단하지 않는다.

`testTicketShareCancelAndInvalidInputs`는 온보딩이 끝난 합성 계정에서 확인 전 가져오기 취소,
취소 완료로 표시된 표의 저장 거절, 여러 페이지 PDF 거절, 예매처 링크만 공유한 경우의 거절을
검증한다. 최신 `TicketShareFixture.swift`의 취소된 표·여러 페이지·링크 버튼을 사용한다.
실행 전후 같은 정상 앱 세션으로 일정 목록을 대조하고 생성 요청이 없었는지도 확인한다.
API 확인 때문에 재로그인해서 앱 세션을 교체하지 않는다.

2026-11-04의 캐시 복구·오프라인 유지·전경 복귀 검증 기록은
[검증 JSON](../../docs/qa/2026-11-04-ticket-cache-validation.json)에 있다.
이 기록의 개별 통과를 전체 길찾기·알림·실기기 검증 완료로 집계하지 않는다.

이미 온보딩까지 완료된 테스트 계정의 달력 화면에서는 `--only testCalendarCreateAndEdit`로 일정 생성 → 길게 누르기 → 수정 → 상세 화면 확인 → 달력 반영 확인을 실행할 수 있다. 이 테스트는 `XCUITest <timestamp>` 제목의 종일 일정을 실제 서버에 저장하며, 알림은 켜지 않는다. 실행 후 해당 테스트 계정의 생성 일정만 정리한다.

화면을 직접 보려면 Device Hub 기기 목록에서 테스트에 사용한 시뮬레이터를 선택한다. 다른 기기 창에는 테스트 동작이 표시되지 않는다.

`result.xcresult`는 Xcode에서 열어 단계별 로그와 첨부 화면을 볼 수 있다. `run.log`와 프로세스 종료 코드가 성공 여부의 기준이다. 화면이 보이거나 API 단독 요청이 성공한 것만으로 UI 시나리오 통과로 간주하지 않는다.

## 격리 ETA의 실제 OS 알림 전달

### 좌표 없는 기존 도착지의 첫 경로 저장

```sh
python3 e2e/ios/run-eta-unlocated-route.py --java '<JDK 21 java 경로>'
python3 e2e/ios/run-eta-unlocated-route.py --java '<JDK 21 java 경로>' --initial-destination located
```

새 H2에 이름만 있는 도착지와 경로 없는 일정 하나를 준비한다. 지정 시뮬레이터의 정상
길찾기 화면에서 최근 장소 → 합성 maasRP 경로 검색 → 선택 → 개인 경로 저장을 수행한다.
공통 도착지가 선택한 신림역 좌표로 바뀌고 4호선·2호선 개인 경로가 DB에 저장되는지,
재로그인 없이 앱을 종료·재실행한 뒤 같은 내용이 표시되는지 확인한다. 저장 API를
실행기에서 대신 호출하거나 실패 팝업을 닫아 통과시키지 않는다. 알림은 꺼진 채 유지한다.
준비 데이터는 실제 `ROUTE` 일정이며 서버의 `RouteSetupReminderPolicy`로 설정 필요를
먼저 확인한다. 이름만 있는 legacy `ScheduleRoute` row를 `READY`로 잘못 표시하면
UI의 준비 상태/설정 버튼 검사에서 실패한다. 저장된 flag 하나로 화면 상태를 강제하지 않는다.
운영 DB·기존5522/8085·다른 시뮬레이터는 변경하지 않으며 실제 지도 정확도 검증은 아니다.
`located`는 기존 공통 도착지에 강남역 좌표까지 있으나 경로가 없는 조건이다. 정상 검색
화면에서 신림역을 선택하고 첫 경로를 저장하면 오래된 강남역 좌표를 그대로 강제하지
않는지 같은 DB/재실행 검사를 수행한다. 다른 회원의 확정 계획이나 기존 상세 경로를
덮어쓰는 시험이 아니다.

모바일 대중교통은 현재 ODsay 고정이므로 `EXPO_PUBLIC_TRANSIT_PROVIDER=tmap`만으로
격리되지 않는다. 이 실행기는 실제 모바일 키를 비우고 `.env` 로드를 끈 별도 Metro에서
`EXPO_PUBLIC_ODSAY_ISOLATED_SIMULATOR_FIXTURE=1`을 사용한다. iOS Simulator·Debug·정확한
5523 주소·실제 H2 readiness 표식을 모두 확인한 경우에만 고정 loopback maasRP fixture를
호출하며 실제 키를 읽거나 전달하지 않는다. 조건이 맞지 않으면 실제 공급자로 fallback하지
않고 실패한다. Release·실기기에서는 이 전송을 사용할 수 없고 정상 ODsay 경계는 유지한다.

`--trace-cold-start` 진단은 종료 상태 알림 시험에서만 사용한다. 지정 기기의 `launchctl`
출력으로 앱 PID를 식별하고 실제 OS 관측 시각 후6~15초 안에서만 읽기 전용 stack을
수집한다. 늦게 도착한 로그는 따뜻한 프로세스를 cold start로 오인하지 않도록 제외한다.
샘플 없음·시간 초과는 진단 미확보이지 cold-start 원인 확인이나 성능 통과가 아니다.

### 실제 자동 재조회부터 OS 전달까지 연결 검증

```sh
python3 e2e/ios/run-eta-automatic-delivery.py \
  --java '<JDK 21 java 경로>' \
  --copied-input '/private/tmp/nolate-real-naver-requery-04-<승인된 복사 입력>.json' \
  --journey-provider tmap --target-lead-minutes 80
```

지정 UDID만 사용해 실제 앱 POST → 실제 `@Scheduled` Worker → 실제 공급자 → 정상 앱의
알람 스냅샷 복구 → 읽기 전용 native/OS 검사 → 실제 예정 시각의 OS 배너·터치·알람 끄기를
연결한다. DB는 새 H2이고 서버5523/Metro8086만 소유한다. 실제 평가 최대3회이며 한도/인증
오류에는 재시도하지 않는다. 미래 열차 관측 창은 실제 시간표와 벽시계로 기다린다.
준비 알람이 화면을 가리면 전용 일정의 준비 화면만 닫고 M0를 취소/재예약하지 않는다.
진단 검사는 `readOnly=1`이며 `sync.fetched=false, inspectionOnly=true`를 요구한다.
수동 Worker 호출·시계 변경·진단 replay·알림 이벤트 주입으로 연결을 복구하지 않는다.

운영 일정 복사본 없이 자동 재조회를 검사하려면 `--copied-input` 대신 `--public-nowon-sillim`
및 `--journey-provider odsay`를 사용한다. 실행기는 격리 DB에 공개 역 좌표만 최근 장소로
등록한다. 지정 시뮬레이터가 이 좌표로 실제 경로를 조회해 일정을 저장한다. 운행일은 KASI로
확인하며, 이 모드는 운영 DB 연결 없이 초기화한다. 출발 후 실제 재조회와 앱 표시를 확인하려면
현재 BE 소스와 일치하는 `--backend-snapshot`을 `--verify-postdeparture-cadence`와 함께 쓴다.

2026-10-13 최종 실행은 정상 ETA1/1, API/설치 앱 표시, native/OS generation1, 실제
14:00:14 예약에14:00:15 OS 관측, 터치·끄기·취소 정리까지 통과했다. 증거는
`e2e/evidence/2026-10-13-automatic-delivery/final-report.json`이며 원래 실패 회차도 보존한다.
이는 로컬 연결 통과이지 FCM/APNs·실기기 청취·전체 경로의 지도 정확도 보장이 아니다.

### 합성 ETA 입력의 OS 조건별 전달 회귀

```sh
python3 e2e/ios/run-eta-native-delivery.py --java '<JDK 21 java 경로>'
python3 e2e/ios/run-eta-native-delivery.py --audit-root '/private/tmp/nolate-eta-mock-e2e.<실행 ID>'
```

이 실행기는 새 H2/5523 및 Metro/8086을 소유하고 네 가지 OS 조건을 실제 시계로 검증한다.
잠금 단계의 `LOCK_PINNED_SIMULATOR_NOW`에는 지정 독립 창만 잠근다. 각 조건 사이에는
Worker의 환승 실패 취소와 정상 회복을 거쳐 새 알람을 예약한다. 마지막 취소 뒤 native/OS
대기 목록 0건을 두 번 확인하고 기존 Metro/8085로 복귀한다. 기존 서버는 중단하지 않는다.
소리 청취·FCM/APNs·실제 아이폰·실제 경로 정확도는 이 결과의 검증 범위가 아니다.
2026-10-08 사용자 요청에 따라 6단계는 시뮬레이터 범위이며 실제 아이폰은 보류한다.

`run-eta.py --only testObserveIsolatedNativeAlarmDelivery`는 지정 기기
`9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69`의 테스트 계정 296·일정 363만 사용한다.
이 시나리오는 별도 5523 서버·메모리 H2와 모의 교통 데이터를 요구한다. 기존 서버나 운영
일정의 알람을 검증용으로 변경하지 않는다. Worker가 채택한 출발시각, active UPSERT,
기기에 실제 예약된 시각이 일치해야 하며 OS 전달은 실제 벽시계로 기다린다.

`--native-mode`는 `foreground`, `background`, `terminated`, `locked`를 지원한다.
`--native-evidence`에 같은 실행의 서버 평가 증거를 지정하고, 실행 전 인증된 앱의
`nolate://internal/eta-alarm-verification` 화면을 연다. 테스트가 알람 화면을 직접 열거나
알림 수신 이벤트를 주입하지 않는다. 전경은 자동 화면 진입, 나머지는 실제 OS 알림 터치 후
화면 진입과 알람 끄기를 검증한다.

잠금 모드에서는 `ETA_NATIVE_LOCK_READY` 후 지정 독립 창의 Controls → Lock을 실행한다.
실제 날짜·시계와 홈 앱 아이콘 부재를 함께 관찰한다. 다른 기기 창을 잠그거나 검은 화면만으로
잠금을 판정하지 않는다. 화면을 깨우는 검증은 같은 창의 측면 버튼으로 수행하고 잠금 유지 여부를
다시 확인한다. 어두운 잠금화면에서 첫 터치 후 앱이 열리지 않으면 여전히 보이는 동일 일정의
OS 알림만 다시 터치한다. 실패는 보존하며 권한 요청·암호 화면은 자동 승인하지 않는다.
관찰된 동일 알림에 `열기` 버튼이 있으면 그 OS 동작을 사용한다. 잠금 해제가 필요할 때는
관찰된 잠금 창의 하단에서 위로 쓸어올린다. 앱이 전경으로 올라오기 전에 앱 버튼을 조회하면
잠금 중 접근성 조회 자체가 시간 초과될 수 있으므로 앱 상태를 먼저 확인한다.

`--only testVerifyIsolatedNativeAlarmState --native-mode state`는 같은 격리 환경에서 실제
`UNUserNotificationCenter` 대기 목록을 읽는다. `--native-evidence`의 서버 알림 계획 중 아직
미래인 각 알림에 대해 시각·세대·물리 ID가 일치하고 정확히 1건씩 존재해야 한다. M15/M10/M5
준비 알림은 중복이 아니며, 같은 스냅샷을 두 번 동기화한 뒤 OS 목록이 그대로인지 검사한다.
취소는 기존 예약 시각 이전에 네이티브 저장소와 OS 대기 목록 모두에서 사라져야 한다.
OS 배너가 접근성 트리에 먼저 나타나는 경우 최초 관측 시각은 그대로 유지하고, 같은
배너가 터치 가능해질 때까지만 최대 3초 기다린다. 전달 허용 지연 25초는 늘리지 않는다.
앱 종료 회차 뒤의 취소 검사는 private 8086 프로젝트를 공개 XCTest URL 동작으로 다시
연 뒤 수행한다. 개발 런처 기동 자체를 취소 성공으로 취급하지 않고 실제 목록 0건을 요구한다.
`verify-eta-native-state.py`는 별도 보존한 회차별 서버 증거와 실제 UI 결과 묶음을 대조한다.
앞당김·늦추기 합성 단계는 목표시각을 바꾸고 격리 작업의 이전 출발값을 초기화하므로,
그 결과를 같은 운영 일정의 불확실한 ETA에서 알람을 늦추는 정책 검증으로 해석하지 않는다.

스크린샷과 예약 일치는 소리 청취의 증거가 아니다. 사용자의 청취 확인을 별도로 기록하며,
시뮬레이터 로컬 알림 통과를 실제 아이폰·FCM 수신이나 ETA 2분 이내 정확도로 해석하지 않는다.

## 실제 미래 경로 비교

### API 한도와 무관한 회귀 검증

```sh
python3 e2e/ios/run-eta-quota-offline.py --java '<JDK 21 java 경로>'
python3 e2e/ios/run-eta-quota-offline.py --java '<JDK 21 java 경로>' --simulator
python3 e2e/ios/run-eta-quota-offline.py --java '<JDK 21 java 경로>' --arrival-quality --simulator
python3 e2e/ios/run-eta-quota-offline.py --java '<JDK 21 java 경로>' --optimization-failure --simulator
python3 e2e/ios/run-eta-quota-offline.py --audit-root '/private/tmp/nolate-eta-mock-e2e.<실행 ID>'
```

매번 새 `/private/tmp/nolate-eta-mock-e2e.*`에 별도 5523/H2 서버를 실행한다.
실제 API 키를 불러오지 않고 경로·시간표·도착 공급자만 합성 입력으로 대체한다.
정상 ETA → 실시간 도착 `ERROR-337` → 회복 → 시간표 `ERROR-337` → 회복 →
경로 HTTP 429 → 회복을 실제 Worker와 DB·공개 API까지 연결해 검증한다.
동일 일정·경로·목표시각을 보존하고, 저장된 다음 조회시각에만 평가하며, 오류 시
기존 알림의 UPSERT/시각 유지·신뢰도 하락·이력 기록·재예약과 회복 시 정상 채택을 확인한다.
실시간 한도 오류는 정상 15초 캐시가 만료된 첫 번째 재조회에서 주입한다.
캐시를 비우거나 운영 캐시 정책을 완화하지 않는다.

`--arrival-quality`는 미래 동일 열차 미관측 → 오래된 관측 → 원천시각 미검증 →
일반 도착 API 오류 → 타임아웃 → 도착 API 한도 → 정상 복구의 7개 상태를 검증한다.
완전한 미래 시간표만 `futureTimetablePrediction`으로 별도 노출하고, 정상 ETA·정시 도착
필드는 비워 두며, 알람의 기존 안전 시각을 유지하는지 확인한다. UI는 예측 카드의 열차별
시간표와 실시간 미확인·알람 유지 안내까지 펼쳐서 검사한다.
리마인드 경계 때문에 다음 검사까지 15초가 안 남으면 캐시 재사용 검사를 별도 보존하고,
저장된 다음 due 시각을 따라 최대 3회 더 평가해 주입 응답에 도달한다. 캐시 재사용을
새 API 요청 실패/복구로 세지 않으며, 각 중간 이력·입력·알람 상태도 독립 감사한다.
이 합성 공급자 E2E는 실제 API 가용성이나 네이버·실측 대비 2분 정확도 증거가 아니다.

`--optimization-failure`는 첫 응답의 동일 열차·전체 환승 ETA가 검증된 뒤 두 번째
경로 최적화 요청에만 타임아웃을 넣는다. 이번 평가의 검증 결과가 정상 상태로
Worker → 이력 → 공개 API → 실제 앱의 펼친 열차별 시각/도보까지 유지되고, 다음 due
회차도 정상인지 확인한다. 두 요청의 서로 다른 검색시각과 오류 주입이 필수이며,
저장 경로나 정상 캐시만으로 타임아웃 복구를 통과시키지 않는다.

`--simulator`는 지정한 `NoLate XCUITest 20261003`만 조작하며, 독립 Metro 8086을 사용한다.
개발 서버 URL을 처음 여는 OS 타임아웃만 한 번 재시도한다. 다른 오류/기기 종료는
실패로 남기며, URL 전달 성공만으로 UI 통과를 판정하지 않는다.
기존 5522/8085 서버는 중지하지 않는다. 시나리오마다 실제 앱의 예상/권장 출발과 보호된
출발시각·경고/현재 보정 여정을 확인한다. 마지막에는 H2 일정의 알림을 끄고 실제 Worker의
취소 명령을 동기화해 실제 OS 대기
알림까지 정리하고 기존 Metro 8085로 돌아간다. H2 전용 로그인은 운영 인증이 아니므로
원래 서버를 쓰려면 다시 로그인해야 한다. UI 실행은 xcresult의 정확히 1건 통과·미건너뜀·
기기 ID까지 대조한다. 포트가 이미 사용 중이면 기존 프로세스를 끄지 않고 실패한다.

새 H2 로그인 전에 해당 기기의 NoLate 앱 프로세스만 종료해 이전 서버의 마운트된
캘린더 화면을 물려받지 않는다. 앱 데이터·알림·다른 기기는 삭제하거나 초기화하지 않는다.
각 H2 서버는 새 임시 JWT 서명키를 사용해 이전 실행의 토큰을 받지 않는다. 정상 인증
초기화 뒤 실제 로그인 폼을 최대 45초 기다리며 저장소에 토큰을 직접 주입하지 않는다.
알림 취소는 마지막 실제 Worker→네이티브 동기화 검사로 확인한다. 예상하지 못한 앱 오류나
시스템 권한 팝업을 자동으로 닫아 통과시키지 않는다. Simulator의 `Busy` 오류로 테스트
러너 자체가 실행되지 않으면 앱 E2E 실패와 구분해 보존하고 지정 기기만 재시작해 재시도한다.
앱 설치본의 네이티브 변경은 Metro 재시작만으로 반영되지 않는다. 네이티브 알림 코드를
변경했다면 현재 소스로 서명된 Debug 앱을 다시 빌드해 지정 UDID에만 설치한 뒤 실행한다.
이전 설치본의 알림 열거 대기로 인증 초기화가 멈췄다고 해서 Keychain·계정 정리 fence를
삭제하거나 인증을 우회하지 않는다. 원래 주소 복귀가 시간 초과되더라도 실행 결과 파일은
보존하고 `originalAppEndpointRestored=false`로 실패를 기록한다.
백엔드 취소가 이미 성공한 뒤 OS 관찰만 실패했다면 같은 검증된 CANCEL 스냅샷을 재사용한다.
이미 CANCELED인 작업을 다시 실행해 fixture 서버를 종료시키지 않는다. 관찰 화면은 권한·
스냅샷·네이티브 저장소·OS 목록 조회의 진행 상태를 공개하며, 그 상태는 통과 증거가 아니다.
네이티브 UI 검사는 첫 탭 뒤 아직 READY이고 버튼이 활성·터치 가능할 때만 한 번 재시도한다.
BLOCKED/SYNC_FAILED/진행 중 호출은 건너뛰지 않고, 실제 OS 목록·전달 검사는 그대로 요구한다.
권한 정체를 구분하기 위해 격리 화면은 별도 Expo OS 권한 읽기의 완료 여부/상태를
`eta-alarm-diagnostic`에 표시한다. 권한 요청은 하지 않으며, 이 진단이 응답해도 NoLate
네이티브 권한·스냅샷·실제 OS 목록 검사를 대체하지 않는다. 실패 메시지는 마지막 진행
단계와 이 안전한 읽기 결과만 남긴다. 진단 이후 정상화만으로 특정 OS/actor 원인을 확정하지 않는다.

정상 회복 때는 `effectiveTransitRoute.segments[].rideTiming`도 대조한다. 원본 시간표의
공급자·취득시각·운행일·열차번호·방향·종별·승하차 시각은 `timetable`에 보존하고,
이번 예측의 승하차 시각과 근거는 별도 필드로 전달한다. 첫 열차의 관측 지연은 원본에
한 번만 적용하고 미래 환승은 해당 열차의 시간표를 사용한다. 구간의 반올림한 분 값을
역산한 시각이 아니다. 기존 스냅샷과 시간표 없는 구간의 `rideTiming`은 null이다.

회복 UI 검증은 독립 fixture 기대값(첫 승차 +210초/하차 +1410초, 환승 승차 +1800초/
하차 +2281초)과 실제 앱의 접힌 요약·펼친 상세를 모두 대조한다. 표시에는 `하차 예측`을
명시하며 첫 승차 실시간 반영과 미래 시간표를 구분한다. 상세의 시각 근거는 줄 수로 자르지
않고 스크롤로 확인한다. 감사는 Worker 스냅샷과 공개 API의 동일성과 UI marker/xcresult를
요구한다. 초 단위 표시는 데이터 해상도일 뿐 초 단위 정확도나 지도 일치를 입증하지 않는다.

`report.json`은 백엔드 전용 실행과 시뮬레이터 UI 실행을 구분하며, 실패 시 종료 코드 1을
반환한다. 합성 공급자 테스트의 통과는 실제 API 정상화·실시간 수신 성공·네이버 지도와의
2분 이내 일치·실제 FCM 전달을 의미하지 않는다. 이 항목들은 API가 복구된 뒤 별도로 검증한다.

### 실제 공급자의 격리 앱 검증

```sh
python3 e2e/ios/run-eta-real-isolated.py --java '<JDK 21 java 경로>' \
  --copied-input '/private/tmp/nolate-real-naver-requery-04-<승인된 입력>.json'
```

실행기는 실제 시계의 저장된 다음 조회시각을 기다려 최대 3회 평가하고, 정상 채택과 실제
앱 표시가 연속 2회 일치해야 통과한다. 중간 degraded/누락 UI/빠진 평가 번호는 연속성을
끊으며, 별도 감사도 같은 목표·공급자와 저장된 다음 due 이후 실행을 대조한다.
공급자 application_error/429가 보이면 반복 호출을
중단하고 PARTIAL로 남긴다. 단계 5는 STANDARD 알림 모드로 OS 벨소리 검증과 분리한다.
자동 작업·기존 서버·운영 일정은 변경하지 않고 임시 서버 종료 뒤 Metro/8085로 복귀한다.

BE 테스트 클래스 `EtaRealProviderSimulatorServer`는 명시적인
`-Dnolate.eta.real-isolated=true`로만 실행한다. 출력 경로는
`/private/tmp/nolate-eta-real-e2e.*`, API 기본 포트는 5523, 저장은 H2에 고정한다.
기본 공급자는 ODsay다. 승인된 좌표로 실제 ODsay 경로를 조회해 시험 일정 296/363에
저장하고, 서울 시간표·실시간 도착과 실제 시계로 평가한다. 기존 Tmap 저장 경로 검증에는
`--journey-provider tmap`을 명시한다. 푸시 ACK만 모의이므로 FCM 수신 성공으로 표현하지 않는다.
기존 모의 공급자 서버와 readiness 헤더도 구분한다.

네이버 공개 화면과 출발 조건을 맞추는 실행에는 `--copied-input` 대신 `--public-nowon-sillim`을
쓸 수 있다. `--planned-departure-at`에 한국 시각 10분 단위의 미래 출발, `--target-arrival-at`에
별도의 목표 도착을 명시한다. 이 모드는 운영 DB를 읽지 않고 공개 좌표에서 새 ODsay 응답을
받아 H2에만 저장한다. 입력 시각이 같아도 계산된 출발, 환승 경로 또는 도보 범위가 다르면
동일 조건의 정확도 표본에서 제외한다. 자동 Worker와 OS 전달은 별도 실행기로 확인한다.

`run-eta.py --only testVerifyIsolatedRealProviderEta --real-isolated
--real-isolated-evidence <evaluation-N.json>`는 같은 실행의 채택된 Worker 결과를 요구한다.
`LIVE_PROVIDER`, `stale=false`, 실시간 첫 열차 관찰, 목표 이전 도착, 공급자·시각·전체 구간
일치가 필요하다. 미채택 결과의 시간표 후보나 오래된 평가로 정상 앱 검증을 실행하지 않는다.
독립 감사는 `verify-real-isolated-eta.py <private-run-root>`로 실행하며, 최소 두 회차의
Worker→API→지정 시뮬레이터 성공이 있어야 지속 연결 검증을 통과한다. 외부 API 오류로
미채택된 회차는 이력만 성공했다고 단계 5 전체 성공으로 바꾸지 않는다.
검증기 종료 코드는 `PASSED`일 때만 0이다. 관찰 실행 자체가 끝났더라도 `PARTIAL`은 1이며,
Worker가 채택했지만 앱 결과가 없는 경우는 `ACCEPTED_UI_NOT_VERIFIED`로 구분한다.
실제 공급자 실행기의 `providerWire`는 고정된 공급자·operation·outcome별 누적 호출 수만
기록한다. `providerFailures`는 고정된 공급자·operation별 마지막 오류의 안전한 코드,
발생시각과 프로세스 누적 오류 수다. 최대 12개 메모리 슬롯이며 전체 요청 로그나 DB 이력이
아니다. 성공 후에도 과거 오류가 남으므로 현재 회차 실패 판정에는 발생시각과 wire outcome의
증분을 함께 사용해야 한다. 원문 메시지·URL·키는 보존하지 않으며 허용 코드 형식 외에는
`UNKNOWN`이다. Worker 실행 자체에서 확보되므로 별도 진단 요청은 필요하지 않다.
`diagnose`는 같은 Spring 어댑터로 공개 노원역을 한 번만 조회하며, 원문 URL·키를
노출하지 않고 차량 식별자·갱신시각 또는 제한된 오류 코드만 남긴다. 진단 성공은 E2E가 아니다.

### 실제 적용 설정·요청 생성 비교 (외부 교통 HTTP 0건)

```sh
python3 e2e/ios/run-eta-configuration-audit.py --java '<JDK 21 java 경로>' \
  --copied-input '/private/tmp/nolate-real-naver-requery-04-<승인된 입력>.json'
```

새 H2 테스트 서버의 실제 `SeoulTransitArrivalClient` 빈과 단독 진단의 환경변수 우선 설정을
비교한다. 설정 파일만 비교하지 않고 실제 RestClient의 URI 생성 직후 transport를 메모리
응답으로 가로챈다. 인증키·endpoint·노원역 요청·물리 조회 범위가 같은지 boolean으로만
기록하고 키·해시·원문 URL은 반환하지 않는다. 호선·방향·논리 반환 개수는 로컬 필터이며,
이 필터를 바꿔도 같은 역의 물리 요청 URI가 같은지 따로 확인한다.

이는 **현재 새 프로세스의 동일 입력 설정 감사**다. 과거 성공/실패 JVM의 설정을 복원하거나
Worker 후보별 실제 요청을 실행한 것은 아니다. 교통 HTTP·Worker 평가·시뮬레이터 UI는
실행하지 않으며 `PASSED`는 설정 감사에만 해당한다. 실제 API 복구나 ETA E2E 통과가 아니다.
가로챈 응답이 후속 실제 평가의 metric/circuit에 섞이지 않도록 `configuration-audit` 명령은
결과 저장 직후 서버를 종료한다. 기존 5522·Metro·앱 연결은 변경하지 않는다. 반환 JSON은
고정 boolean 스키마만 허용하며 누락·임의 필드·실제 HTTP가 있으면 검증에 실패한다.

### 같은 프로세스의 실제 단독 조회와 Worker 요청 대조

```sh
python3 e2e/ios/run-eta-request-parity.py --java '<JDK 21 java 경로>' \
  --copied-input '/private/tmp/nolate-real-naver-requery-04-<승인된 입력>.json'
```

새 H2 서버의 실제 Spring 클라이언트에 관찰 전용 interceptor를 붙인다. 원래 transport와
요청·응답을 그대로 전달하며 본문을 읽거나 가짜 응답·재시도를 넣지 않는다. 직접 조회 1회가
거절되거나 빈 목록이면 서버와 실행기가 모두 Worker 실행을 막는다. 성공 시 Worker는 최대
1회만 실행한다. 서울 실시간 외에 Worker가 호출하는 실제 Tmap·시간표 요청도 발생한다.

물리 요청 순서·시각·HTTP 상태와 최초 직접 조회의 키/endpoint/역명/서비스/범위/URI 일치
여부만 고정 스키마로 남긴다. 최대 20건이며 원문 URI·키·해시·본문·헤더는 출력하지 않는다.
비교 기준 URI는 프로세스 메모리에만 존재하고 종료 시 버린다. HTTP 200과 공급자 본문의
application-level 성공은 별개이며 `providerFailures`와 회차별 wire 증분을 함께 본다.
직접 조회 성공 누적값을 Worker 성공으로 세지 않는다.

이 실행은 UI E2E가 아니다. `REQUEST_PARITY_ONLY`도 요청 대조 범위에만 해당하며 실제 이동
오차·FCM·벨소리를 검증하지 않는다. `WORKER_NOT_ACCEPTED` 또는 공급자 제한 응답 후에는
추가 실제 조회를 반복하지 않는다. 기존 서버·Metro·시뮬레이터 연결과 운영 DB는 변경하지 않는다.

### 지도 예측 비교의 판정 범위

설치 앱 E2E, 실제 공급자 시간표 연결, 지도 예측 일치, 실제 이동 오차는 별개다.
`verify-eta-comparison.py`는 마지막의 실제 이동 오차나 E2E 통과를 판정하지 않는다.
아래 명령은 저장한 예측 증거를 읽기만 하며 API 호출·DB 변경을 하지 않는다.

```sh
python3 -m unittest discover -s e2e/ios -p 'test_eta_comparison.py' -v
python3 e2e/ios/verify-eta-comparison.py e2e/evidence/2026-10-05-future-2000-comparison.json
```

기본 종료 코드 0은 입력을 읽어 진단을 출력했다는 뜻이며 정확도 합격이 아니다.
자동화의 합격 조건에는 `--require-two-minute-agreement`를 사용한다. 확인된 예측 일치만
0, 확인된 2분 초과는 1, 비교 제외/정밀도 미확정은 3, 잘못된 입력은 2다.
`predictionAgreementVerified`도 실제 이동 정확도와는 별개다.

같은 미래 출발시각, 정확한 출발·도착 경계, 노선·승하차역·방향·종별,
5분 이내 수집 시각이 확인된 경우에만 도착 예측 차이 ±120초를 판정한다.
문서의 `comparisonScope`는 기본 `SAME_SERVICE_TIMING`(동일 열차 시각 비교)과
`DOOR_TO_DOOR_PREDICTION`(전체 여정의 지도 예측 비교)을 구분한다. 전자는 동일 열차의
운행일·식별 체계·번호까지 확인해야 한다. 후자는 다른 열차를 추천했거나 지도에 번호가
공개되지 않아도 나머지 조건이 같으면 도착 예측 차이를 평가하며, 동일 열차의 정확도로
해석하지 않는다. 범위에 관계없이 실제 이동 정확도를 판정하지 않는다.
누락된 조건, 모의 입력, 역 플랫폼과 거리 좌표의 혼합은 제외하며 차이는 진단값으로만 남긴다.
열차가 다르면 `TRAIN_SELECTION_MISMATCH`, 번호 확인 근거가 없으면
`TRAIN_IDENTITY_UNCONFIRMED`로 동일 열차 비교 표본에서 제외한다. 전체 여정 비교에서는
이를 `sameTrainComparison`의 진단으로만 남긴다. 원시 시각 차이와
노선 타임라인 진단은 남기므로 다른 열차를 추천했다는 차이 자체를 숨기지 않는다. 지도에 표시된 총시간을
목표 도착시각에서 단순히 빼거나, 비교 차이를 임의로 ETA에서 빼지 않는다.

각 ride의 `trainIdentity`에는 `{namespace, serviceDate, number, evidence}`를 넣는다.
운행일은 `YYYY-MM-DD`이며, 사업자/원천별 번호 체계가 다르면 임의로 접두사를 없애
같은 열차로 만들지 않는다. 지도에 번호가 보이지 않으면 승차시각에서 번호를 추정하지 않는다.

최종 도착시각에는 `arrivalClockEvidence: {resolutionSeconds, rounding, evidence}`를 넣는다.
`EXACT`는 초 단위 계산 결과(`resolutionSeconds=1`), `TRUNCATED`는 버림,
`NEAREST`는 반올림 계약이 확인된 표시 시각이다. 단순히 분 단위로 보인다는 이유만으로
반올림 방식을 추정하지 않고 `UNKNOWN`으로 남긴다. 누락/불명확은
`ARRIVAL_CLOCK_PRECISION_UNCONFIRMED`로 제외한다. 양쪽 표시 해상도를 합친 차이 범위
전체가 ±120초 안에 있어야 `WITHIN_TWO_MINUTES`, 전체가 밖이면
`OUTSIDE_TWO_MINUTES`, 경계에 걸치면 `INDETERMINATE_CLOCK_PRECISION`과
`withinTwoMinutes=null`이다. `EXACT`도 예측 계산값의 표현 해상도일 뿐 실제 이동 정확도가 아니다.

실제 격리 실행기는 채택 회차마다 `prediction-observation-N.json`을 자동 생성한다.
비교 출발은 이번 `effectiveTransitRoute.departureAt`이며 보호된 이전 알람 시각은
별도 `protectedAlarmDepartureAt`으로만 보존한다. 열차별 보정 시각을 정수 분으로
바꾸지 않으며, 역 내부 도보·승강장 경계는 계속 UNKNOWN이다. 독립 감사는 이 파일을
동일 Worker·공개 API·실제 화면 검증 회차와 대조한다. 과거 실행은 다음처럼 읽기만 해
추출할 수 있으며, 재생/추출을 새로운 실제 공급자 호출이나 E2E로 세지 않는다.

```sh
python3 e2e/ios/verify-eta-comparison.py --export-worker '<실제 evaluation-N.json>'
python3 e2e/ios/verify-real-isolated-eta.py --require-comparison-evidence '/private/tmp/nolate-eta-real-e2e.<실행 ID>'
```

같은 미래 출발 조건을 비교할 때 격리 실행기에 `--planned-departure-at`과
`--target-arrival-at`을 함께 지정할 수 있다. 후자는 테스트 일정의 목표 도착 입력일 뿐
공급자 응답·열차 선택·계산 결과를 고정하지 않는다. 실제 계산 경로의 출발이 지도 요청과
달라지면 같은 조건의 정상 비교로 판정하지 않는다. `journeyTimingTrace`는 각 검색 후보의
시간표 연결 결과를 수동 HTTP 추가 없이 관찰하며 정상 채택 여부를 대신하지 않는다.

`verify-eta-map-display.py`는 별도 화면 표시 진단이다. 같은 요청 좌표·현재 계산 출발시각·
노선 순서와 5분 이내 관측을 확인하고 앱/API가 채택한 도착과 네이버 공개 화면의 도착
표시 차이를 남긴다. 보호된 이전 알림 출발을 현재 검색 출발로 사용하지 않는다. 공개 화면의
열차 번호·하차 초·반올림 계약·승강장 도보 범위를 추정하지 않는다. 분 단위 표시의 명목 차이가
120초 이내여도 `mapAccuracyWithinTwoMinutesVerified`와 `actualTripAccuracyVerified`는
false다. 위 엄격한 시간표/승강장 비교 검증기를 완화하거나 대체하지 않는다.

```sh
python3 e2e/ios/verify-eta-map-display.py --worker '<evaluation-N.json>' \
  --public-status '<ui-status-N.json>' --map-display '<visible-map-evidence.json>' \
  --snapshot '<saved-public-UI.yml>'
```

각 관측에는 `walkingBoundaryEvidence`를 접근·환승(횟수만큼)·도착 순서로 기록한다.
항목은 `scope`, `from/to: {kind, id}`, `stationInteriorCoverage`, 실제 화면·문서를
가리키는 `evidence`로 구성한다. `kind`는 `STREET_COORDINATE`, `STATION_ENTRANCE`,
`STATION_PLATFORM`, `UNKNOWN` 중 하나다. 첫 from/마지막 to의 id는 각각 기존
`originBoundary`/`destinationBoundary`와 일치해야 한다. 접근의 to, 환승의 양 끝,
도착의 from은 동일한 승강장으로 확인하고 `INCLUDED_TO_PLATFORM`을 기록해야 한다.
역 밖 구간만 확인된 `EXCLUDED`는 승강장 이동까지 확인한 근거가 아니다.
이 항목은 사람이 확인한 비교 증거이며 공급자 polyline에서 자동 추론하지 않는다.

누락·불명확한 경계는 `WALKING_BOUNDARIES_UNCONFIRMED`, 확인됐지만 서로 다른 경계는
`WALKING_BOUNDARY_MISMATCH`로 제외한다. 지도에 접근/도착 도보가 표시되지 않아도
0초로 입력하거나 확인된 경계로 간주하지 않는다. Tmap의 `endpointBasis`는 명목
구간 끝점만 나타내고 `pathEvidence.stationInteriorCoverage=UNKNOWN`을 유지한다.
저장·API·앱 표시의 모의 공급자 검증 근거는
`e2e/evidence/2026-10-09-walking-boundary-implementation-e2e.json`이다.

BE의 읽기 전용 공급자 검증에는 동일 미래 시각을 명시할 수 있다. 실행 시각 이후
24시간 이내 UTC 시각을 넣는다. 이 모드는 실시간 API를 호출하지 않으며 live 성공이 아니다.

```sh
./gradlew transitTimetableIntegrationTest -PallowTransitLiveProbe=true \
  -PetaProbeDepartureAt='<future UTC instant>' -PetaProbeTimetableOnly=true
```

`stage=timetable` 출력에 전체 도보·대기 포함 구간과 별도 열차 승차/하차 시각을 기록한다.
지도 증거에는 실제 화면에 설정한 출발시각과 수집 시각, 해상도, 구간 경계를 함께 남긴다.

`timelineDiagnostic`는 요청 출발시각부터 도착까지를 출발 제안의 시각 조정, 첫 승차 전
시간, 각 열차의 운행, 환승 사이 시간, 마지막 하차 후 잔여시간으로 나눈다. 같은 노선·
승하차역·방향의 표시 타임라인에서 차이가 발생한 위치를 찾기 위한 산술 진단이다.
역 접근·환승 간격을 확인된 도보 또는 대기로 해석하지 않으며 종별·경계 미확인은 계속
정확도 판정에서 제외한다. 서로 다른 요청시각의 진단에는 그 절대 시각 차이도 포함한다.
표시 총 소요시간, 제안 출발시각, 요청시각부터 도착까지 걸리는 시간은 별도로 보존한다.
지도 차이를 운영 ETA에서 상수로 빼지 않는다.

2026년 10월 6일 21:30 비교에서는 실제 공급자 시간표와 네이버 지도 UI를 확인했다.
증거는 `e2e/evidence/2026-10-06-same-coordinates-2130-comparison.json`이다.
이 실행은 시뮬레이터 E2E 또는 실제 이동 정확도 검증이 아니다.

## 도착 도보 포함 앱 검증

독립 iOS 시뮬레이터의 Release 로그인·ODsay 경로 검색 E2E는 앱을
`CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=-`로 빌드한다.
`CODE_SIGNING_ALLOWED=NO` 빌드는 로그인 요청 전 iOS Keychain 조회에서
`ERR_KEY_CHAIN`으로 실패할 수 있어, 서버 로그인 장애나 ODsay 장애로 판정하면 안 된다.
`testIsolatedReleaseMemberLoginAndOnboarding`은 저장된 합성 일정 상세까지,
`testIsolatedIOSOdsayRouteSearch`는 실제 ODsay 검색 결과의 펼친 상세와 저장 버튼까지
검증한다. `testIsolatedIOSOdsayRouteSaveAndReopen`은 격리 시험 계정의 합성 일정에만
실제 ODsay 경로를 저장해 다시 열고 지도 설정을 확인한다. 이 세 테스트는 GPS 이동·실제
차량 탑승·APNs 전달을 검증하지 않는다. 시험 Release 빌드에는 ODsay 키와 함께
`EXPO_PUBLIC_TMAP_APP_KEY`도 전달해야 경로 상세 지도가 설정 오류로 빠지지 않는다.

### 실제 여정의 도보·시간표 자동 감사

실제 ODsay를 한 번 시험하려면 기존 실제 공급자 격리 실행기에
`--journey-provider odsay --max-evaluations 1`을 전달한다. 전용 H2에서 동일 공개 좌표의
새 ODsay 경로를 조회해 실제 노선/역 ID로 저장하며, 기존 Tmap 경로를 재명명하지 않는다.
기존 BE 5522/Metro 8085 및 env 파일을 변경하지 않고, 전용 5523/8086만 사용 후 종료한다.
`--max-evaluations 1`이면 시드 경로 1회와 Worker 평가 1회이며, 평가마다 정상과 같은
최대 3회 경로 탐색을 허용한다. 반복 관찰은 명시적으로 `--max-evaluations 2` 또는 `3`을
선택하며 저장된 다음 조회시각까지 기다린다. 운영 재조회 정책은
변경하지 않으며 공급자 오류를 우회하거나 Tmap으로 자동 fallback하지 않는다.

ODsay 미채택 결과는 별도 `testVerifyIsolatedRealProviderDiagnostic`에서 실제 앱의
예상 출발/저장 경로 기준 표시를 검증한다. Worker→공개 API의 source/stale/failureReason/
시각/소요시간과 원본 ODsay ID 보존도 독립 감사한다. 진단 UI가 통과해도 정상 ETA UI
통과 수에는 포함하지 않고 전체 정상 보정 기준은 PARTIAL로 남긴다. 이 테스트용 실행
옵션은 앱의 전역 공급자를 영구 전환하거나 운영 DB 일정을 변경하는 기능이 아니다.

ODsay는 도시 1000, 공식 1~9호선 코드와 노선명이 함께 일치할 때 서울 시간표로 연결한다.
경유역 순번과 양 끝 ID/역명을 대조해 다음 역을 보존한다. 2호선의 ODsay 방향 코드는
서울 INOUT_TAG로 직접 복사하지 않으며, 같은 열차의 승차→다음 역→하차 순서가 유일한
방향을 증명해야 한다. 시간표 연결만 성공했거나 실시간 원천이 오래됐으면 정상 ETA로
집계하지 않는다. 테스트용 수동 추적은 원본 반환을 관찰할 뿐 추가 HTTP나 대역 응답은 없다.

정상 ODsay ETA의 독립 감사는 실제 첫 차량·두 시간표·앱 시각의 일치를 요구한다.
도보는 분 단위 원본 모델의 합산으로 검사하며 초 단위 원본/geometry가 있다고 꾸미지 않는다.
Tmap의 원본 초 및 geometry 감사 기준은 유지한다. 미래 시간표만 있는 경우는 별도 공개
`futureTimetablePrediction`과 미확인 경고를 검증하며 `acceptedUiCases`에는 포함하지 않는다.

실제 공급자 UI 검사는 저장된 목표 날짜의 달력 셀을 먼저 선택한다. 오늘 출발/내일 도착
일정도 오늘 목록에서 임의로 찾지 않으며, 날짜 선택은 읽기 전용이고 일정 저장은 없다.
서울 시간표 query는 여정 출발 운행일을 명시해 자정을 넘은 환승도 같은 날의 명시적
24~26시 원본 행으로 연결한다. 00시 행을 임의 변환하거나 다른 날짜/미확인 휴일의
시간표를 채택하지 않는다. 원본에 탈 수 있는 환승편이 없으면 진단 UI 통과와 별개로
정상 ETA E2E는 계속 PARTIAL이다.

```sh
python3 e2e/ios/verify-eta-walking-boundaries.py '<공개 상태 또는 Worker evaluation JSON>'
```

현재 여정만 읽으며 이전 정상 경로로 대체하지 않는다. WALK 원본 초와 열차별 예측
승하차시각으로 전체 시간을 분해하고, 접근·환승 후 승차 가능 시각과 마지막 하차→도착
사이 도보 합산을 점검한다. 분 단위 올림된 `waitingMinutes`를 다시 더하지 않는다.
누락된 도보 초를 0으로 보거나 거리로 시간을 역산하지 않으며, 정확한 값이 없으면
UNVERIFIED다. 중복/누락 도착 도보·탈 수 없는 환승·총시간 충돌은 FAILED다.

상세 좌표의 시작/끝과 공급자 명목 끝점 사이 거리, step 내부 polyline 길이와 step 간
간격을 따로 기록한다. 간격을 임의로 연결한 경로를 만들지 않는다. 이 수치는 WGS84 좌표
기반 진단값이지 측량 결과·승강장 위치·보행 시간 보정값이 아니다. 제공된 상세 경로가
있거나 명목 끝점과 일치해도 `stationInteriorCoverageVerified=false`를 유지한다.
TMAP [공식 대중교통 문서](https://transit.tmapmobility.com/docs/routes)의 `sectionTime`,
`start/end`, `steps` 계약만으로 승강장 포함 범위를 확정하지 않는다.

`verify-real-isolated-eta.py`에도 이 감사를 연결했다. 따라서 실제 Worker와 공개 API의
값이 서로 같더라도 잘못된 도보 합산을 함께 담았다면 E2E 성공으로 집계하지 않는다.
감사의 PASSED는 시간축 산술 통과이며 네이버 2분 일치·실제 이동 정확도 통과가 아니다.

`verify-eta-fixture.py <private-root> --walking-boundary`는 지정 시뮬레이터의 정상·환승편
변경 XCUITest 결과, 실제 앱이 받은 공개 API, Worker 스냅샷을 함께 검증한다. 모의 마지막
열차 하차시각에 원본 도착 도보 171초가 한 번만 포함되어야 하며, 누락·중복 합산과 API
도착시각 불일치를 거부한다. 앱에는 총시간 포함 여부와 확인되지 않은 역 내부 이동 범위를
표시한다. 원천 좌표를 출입구·승강장 확인의 증거로 사용하지 않는다.

2026년 10월 6일 두 실제 앱 E2E가 통과했다. 증거는
`e2e/evidence/2026-10-06-egress-inclusion.json`과 두 상세 화면이다. 공급자는 모의 입력이고
DB는 별도 메모리 H2다. 실제 이동 정확도나 이번 실행의 기기 알림 전달 판정은 아니다.

## 시외 경로 검색·저장·재실행 E2E

`testIntercitySearchSaveReopen`은 실제 공급자 검색과 정상 일정 저장을 사용한다.
전용 시뮬레이터, 신규 합성 계정(`@example.test`), 현재 소스를 로드하는 개발 앱이 필요하다.
계정의 최근 장소에 `서울남부터미널 E2E`(37.4849, 127.0167),
`공주터미널 E2E`(36.4600, 127.1246)를 정상 장소 등록 흐름으로 준비한다.
화면은 로그아웃·온보딩·달력 또는 비어 있는 새 일정 초안에서 시작한다.
테스트 중 같은 계정으로 API 로그인을 하면 앱 세션이 무효화될 수 있으므로
API 검증용 계정은 분리한다. 사용자의 기존 시뮬레이터/계정은 사용하지 않는다.

현재 iOS 앱은 ODsay로 대중교통 경로를 검색한다. 아래 10월 기록의
`EXPO_PUBLIC_TRANSIT_PROVIDER=tmap` 설정은 당시 테스트 앱에서 사용했다.
현재 앱은 이 값으로 대중교통 공급자를 전환하지 않는다.
예상 경로 시각은 실제 운행 시간표로 간주하지 않으며 출발 알림은 비활성 상태로 저장한다.

`testIntercityRailKeywordSearchSaveReopen`은 전용 계정에 서울역을 최근 장소
`서울역 E2E`로 등록한 뒤 다음 날 14시 일정을 만든다. 도착지에 ‘동대구역’을 입력하고
TMAP의 KTX 정차역 결과를 선택한다. ODsay 기차 경로에서 시간표를 열어 일정 날짜를
확인하고 서울→동대구의 TAGO 운행편을 조회한다. 처음에는 아직 출발하지 않았고
14시까지 동대구역에 도착하는 편이 보인다. 시간 조건을 꺼서 하루 전체 시간표와
늦게 도착하는 편의 표시를 확인하고, 다음 페이지를 조회한 뒤 조건을 다시 적용한다.
역에서 최종 목적지까지의 이동과 하차 여유는 운행편을 경로에 연결할 때 검증한다.
경로를 일정에 저장하고 앱을 재실행해 기차 구간을 확인한다. 이 테스트에는 실제 ODsay
iOS 키, TMAP 장소 검색 키와 별도 로컬 서버의 TAGO 열차 키가 필요하다.

```sh
python3 e2e/ios/run.py \
  --device '<전용 시뮬레이터 UDID>' \
  --credentials '/private/tmp/<합성 계정 JSON>' \
  --derived-data '/private/tmp/nolate-intercity-xcuitest' \
  --runner-bundle-id 'dev.nolate.intercity.e2e.tests' \
  --only testIntercitySearchSaveReopen \
  --output '/private/tmp/<새 결과 디렉터리>'
```

`--derived-data`와 `--runner-bundle-id`는 동시에 실행되는 다른 XCTest 작업과
러너를 분리하기 위한 선택 옵션이며 기존 기본값은 유지한다.
성공 판정은 `.xcresult`의 passed=1, failed=0, skipped=0과 검색·저장·재실행 화면을 함께 확인한다.

별도 API E2E는 로컬 API 5522와 전용 합성 계정을 사용한다. 캡처한 실제 TMAP 응답의
고속버스·SRT를 현재 FE 모델로 변환해 실제 POST/DB/GET/복원을 확인한다.
생성한 일정은 finally에서 삭제한다. 새 공급자 검색이나 화면 E2E로 집계하지 않는다.
자격 증명 JSON은 `email`, `password`, `memberId`를 포함하고 저장소 밖에 보관한다.

```sh
INTERCITY_E2E_CREDENTIALS='/private/tmp/<별도 합성 계정 JSON>' \
INTERCITY_E2E_OUTPUT='/private/tmp/nolate-intercity-api-result.json' \
npm test -- --runInBand --no-watchman --testRegex='e2e/intercity-api.e2e.ts$'
```

2026-10-12 실행은 iOS 고속버스 화면 1개와 API 고속버스·SRT 2개 사례가 통과했다.
ODsay는 코드 429로 실응답 검증을 완료하지 못했다. ODsay 열차·고속·시외버스는
합성 계약 fixture로 검증했다. Android 화면, 실제 시간표/예매/승차권/시외 이동 중 안내는
검증 완료에 포함하지 않는다. 증거는
`e2e/evidence/intercity-2026-10-12/validation.json`에 구분해 기록한다.

iOS 우선 후속 테스트는 같은 명령의 `--only`를
`testIntercityTrainSearchSaveReopen`으로 바꾸고 새 output 디렉터리를 지정한다.
기차를 포함한 후보를 실제 화면에서 찾아 선택하며, 없으면 실패한다.
2026-10-12 첫 실행에서 추천 5개에 기차가 누락되는 문제를 발견했고,
추천 목록 수정 후 기차 검색·저장·종료/재실행·TRAIN 상세 확인이 통과했다.
증거는 `e2e/evidence/intercity-2026-10-12/ios-followup-validation.json`이다.
사용자 지시에 따라 Android 구현·화면 E2E는 후속으로 보류한다.

## 실제 TAGO 시간표 조회 iOS E2E

`testIntercityLiveTimetableSearchSaveReopen`은 앞의 정상 로그인·실제 TMAP 검색 흐름에서
기차 구간의 `운행 시간표 조회`를 연다. 시·도와 실제 역·터미널 ID를 화면에서 선택하고
수서→공주 열차 및 서울경부→공주 고속버스의 공공 운행편을 확인한다.
시외버스는 미래 날짜의 `DATE_UNSUPPORTED`와 당일 서울남부→공주의 정상 0건을 구분한다.
이후 시간표를 닫고 원래 경로를 저장해 앱 종료·재실행 후 TRAIN 보존을 확인한다.
당일 제공 데이터가 달라지면 해당 기대값을 실응답과 비교해 검토한다.

테스트는 위 명령의 `--only`를 `testIntercityLiveTimetableSearchSaveReopen`으로 바꾼다.
현재 BE 소스의 `/api/intercity/*`가 실행되는 별도 로컬 API가 필요하며,
`EXPO_PUBLIC_LOCAL_API_BASE_URL`로 해당 서버를 사용하도록 Metro를 시작한다.
다른 작업의 서버·포트·시뮬레이터를 재사용하거나 중단하지 않는다.
이번 실행은 loopback 5524의 별도 메모리 H2, 실제 TAGO/TMAP adapter, 정상 가입한
합성 계정 두 개(UI/API 분리)를 사용했다. 인증·교통 응답을 우회하거나 모의 처리하지 않았다.

서버 키는 `TAGO_TRAIN_API_KEY`, `TAGO_EXPRESS_BUS_API_KEY`,
`TAGO_INTERCITY_BUS_API_KEY`이고 공통 `TAGO_API_KEY`로 대체할 수 있다.
키를 앱에 포함하거나 결과 파일에 복사하지 않는다. 각 API 활용신청은 별도로 필요하다.
공공 시간표 조회만으로는 경로 시각을 바꾸지 않는다. 아래 후속 기능의 명시적 운행편 선택은 경로에 시각을 적용하며, 예매 완료·잔여 좌석 확인을 의미하지 않는다.
시외 ETA guard는 유지한다. Android 화면 E2E는 보류한다.

BE 회귀는 `./gradlew test --tests 'com.noLate.intercity.*' --tests 'com.noLate.eta.application.TransitEtaCalculationServiceTest'`,
FE 회귀는 `npx jest --runInBand --no-watchman __tests__/intercityTimetableModel.test.ts __tests__/intercityRoutePipeline.test.ts`를 사용한다.
실응답 fixture는 민감정보가 없는 공개 역·시간표 데이터이며, fixture 테스트를 새 실호출로 집계하지 않는다.

2026-10-12 최종 실행은 BE 44개·FE 11개 테스트, typecheck 및 실제 iOS E2E 1개가
통과했다. 실제 API와 화면 검증의 범위 및 남은 항목은
`e2e/evidence/intercity-2026-10-12/tago-timetable-validation.json`에 기록했다.
화면 PNG도 같은 디렉터리의 `tago-*.png`에 보관한다.

## 선택 운행편 연결·저장·재실행 iOS E2E

`testIntercitySelectedServiceSaveReopen`은 정상 로그인과 실제 TMAP 검색 후 수서→공주
TAGO 열차 편을 선택한다. 일정은 다음 날 20:00으로 설정하고, 시간표는 11~14시 출발 편을
사용해 일정 시각에서 역산한 값과 선택 편 시각을 구분한다. 같은 승하차 장소인지 확인하기
전에는 적용이 불가능하며, 확인 후 실제 TMAP 접근/도착 경로를 재조회한다.
탑승 준비·대기와 하차 후 여유를 별도 구간으로 저장하고, 저장한 날짜를 실제 캘린더에서 연다.
앱 종료·재실행 후 열차 출발시각과 `예매 미확인` 표시가 유지되는지 검사한다.
공유 기능이 비활성인 테스트 프로파일에서 재실행 시 나타나는 안내창은 확인 버튼으로 닫는다.
기기 알림은 비활성화한다.

긴 화면 테스트에서는 전용 Metro를 `CI=1`로 실행해 소스 변경에 따른 자동 새로고침을 끈다.
이는 설치된 Expo CLI의 watch 비활성 옵션이며, 실제 TAGO/TMAP 요청은 계속 실행된다.
테스트 중 자동 새로고침으로 작성 화면이 초기화된 실행은 통과로 집계하지 않는다.

```bash
python3 e2e/ios/run.py \
  --device <전용-시뮬레이터-UDID> \
  --credentials <저장소-밖-합성계정-json> \
  --output <새로운-비공개-결과-디렉터리> \
  --derived-data <전용-derived-data> \
  --runner-bundle-id dev.nolate.intercity.selection.e2e \
  --only testIntercitySelectedServiceSaveReopen
```

같은 로컬 API와 실제 공급자를 사용하는 API E2E는 열차·고속버스 각각에 대해
운행편 선택→앞뒤 경로 재조회→일정 생성→DB 재조회→정상 수정→시각 불일치 수정 거절을
확인한다. 전체 구간의 최초 검색 자료는 캡처한 실제 TMAP 응답이며, 연결 경로와 TAGO 편은
실호출한다. 화면 E2E와 API E2E의 집계를 분리한다.

```bash
INTERCITY_E2E_CREDENTIALS=<별도-API계정-json> \
INTERCITY_E2E_OUTPUT=<비공개-결과-json> \
npm test -- --runInBand --no-watchman \
  --testRegex 'e2e/intercity-selection-api\.e2e\.ts$'
```

선택 경로는 schemaVersion 3 / `anchored_journey`로 저장한다. 전체 시간 근거는
`route_estimate`이며, 선택 편만 `TIMETABLE`이다. 장거리 편 한 개, 사용자의 동일 장소 확인,
탑승 준비 5~120분·하차 여유 0~120분을 지원한다. 좌표 없는 역·복수 장거리 편·연결 실패는
적용을 거절한다. 취소/화면 종료 뒤 도착한 비동기 응답은 적용하지 않는다. 편을 재선택해도
이전 준비시간을 중복하지 않는다. 예약·좌석·탑승홈·실제 내부 동선은 확인되지 않는다.
시외버스 당일 제한과 시외 ETA guard는 유지하고, Android 및 기기 알림 검증은 보류한다.

최신 실행 결과와 화면은 `e2e/evidence/intercity-2026-10-12/intercity-selection-validation.json`에 기록한다.

2026-10-12 최종 실행은 FE 8 suites / 116 tests, BE 3 suites / 51 tests,
기차·고속버스 실제 API E2E 2개 및 기차 선택 여정 iOS 화면 E2E 1개가 통과했다.
iOS 최종 실행의 실패·스킵은 0개이며, 초기 실패·연결 중단은 검증 JSON에 별도로 기록했다.
typecheck 통과, ESLint 오류 0개·기존 inline-style 경고 5개다.
원본은 `/private/tmp/nolate-intercity-selection-ui-20261012-14/result.xcresult`이며,
공개 화면은 같은 evidence 디렉터리의 `selected-service-*.png`다.


## iOS 기차 승차권 이미지·텍스트 가져오기

`testTrainTicketImageShareSaveReopen`은 테스트 전용 UIKit 앱이 만든 **합성 승차권 이미지**를
실제 iOS 공유 시트로 NoLate 공유 확장에 전달한다. Vision OCR 뒤 불확실한 역 이름은 직접
수정하고, 원본 확인 전 저장이 막히는지 검사한다. 개인 일정 저장 후 앱을 종료·재실행하고
승차권 요약 및 `예매 상태 미검증` 표시를 확인한다. 실제 코레일톡이나 구매한 표를
공유한 테스트가 아니며, 코레일 내부 승차권 전달 기능과 외부 앱 공유를 동일시하지 않는다.

먼저 전용 E2E 시뮬레이터에 현재 개발 앱과 정상 가입한 합성 계정을 준비한다.
공유 확장은 메인 앱의 공유 Keychain 인증을 그대로 사용한다. 서버 재시작 후에는 정상
로그인으로 세션을 다시 만들고, UI 계정과 API 계정을 분리한다.
공유 확장을 다음처럼 빌드한다. simulator Keychain 권한을 바이너리에 넣기 위해
`CODE_SIGNING_ALLOWED=YES`가 필요하다. `NO`로 빌드하거나 시뮬레이터 앱에 기기용
entitlements를 수동 추가하면 인증 또는 앱 실행이 실패한다.

```bash
xcodebuild -project ios/NoLateFE.xcodeproj -target NoLateShareExtension \
  -configuration Debug -sdk iphonesimulator ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=- \
  DEVELOPMENT_TEAM=457QQLB6H6 \
  CONFIGURATION_BUILD_DIR=/private/tmp/nolate-ticket-extension-build build
python3 e2e/ios/prepare-ticket-share-fixture.py \
  --device <전용-E2E-시뮬레이터-UDID> \
  --extension /private/tmp/nolate-ticket-extension-build/NoLateShareExtension.appex \
  --output /private/tmp/nolate-ticket-prepared-<새-ID>
```

설치 도우미는 이름에 `E2E`가 포함된 부팅된 시뮬레이터만 허용한다. 기존 앱 데이터를
보존하면서 현재 확장과 테스트 공유 앱만 설치한다. 이 합성 공유 앱은 제품 타깃에 포함하지 않는다.
전용 Metro를 `CI=1`로 실행한 경우 소스 변경 뒤 Metro를 재시작하고 앱을 새로 실행한다.
실행 중인 앱을 활성화하는 것만으로는 이전 JS 번들이 바뀌지 않는다.
이번 테스트의 Metro 포트는 8097이며 필요하면 전용 기기에서 다음 URL로 연결한다.

```bash
xcrun simctl openurl <전용-E2E-시뮬레이터-UDID> \
  'nolate://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8097'
python3 e2e/ios/run.py \
  --device <전용-E2E-시뮬레이터-UDID> \
  --credentials <저장소-밖-합성-UI-계정-json> \
  --derived-data /private/tmp/nolate-ticket-xctest \
  --runner-bundle-id dev.nolate.intercity.selection.e2e \
  --only testTrainTicketImageShareSaveReopen \
  --output /private/tmp/nolate-ticket-ui-<새-ID>
```

출발·도착 시각의 잠금, 실제 TMAP 앞뒤 경로 조회, DB 복원, 모순된 수정 거절은 별도 API
E2E에서 검사한다. 이 테스트는 합성 승차권과 기존 실응답 전체 경로 fixture를 사용하며,
연결 경로 두 번은 실호출한다. TAGO 재조회는 필요하지 않다. 알림은 비활성화한다.

```bash
INTERCITY_E2E_CREDENTIALS=<별도-API-계정-json> \
INTERCITY_E2E_OUTPUT=/private/tmp/nolate-ticket-api-result.json \
npm test -- --runInBand --no-watchman \
  --testRegex 'e2e/intercity-selection-api\.e2e\.ts$' \
  --testNamePattern 'reviewed ticket import'
```

텍스트 파서·날짜 검증은 Foundation만으로 실행할 수 있다.

```bash
mkdir -m 700 /private/tmp/nolate-ticket-policy-<새-ID>
cp e2e/ios/TrainTicketImportPolicyTests.swift /private/tmp/nolate-ticket-policy-<새-ID>/main.swift
xcrun swiftc ios/NoLateShareExtension/TrainTicketImport.swift \
  /private/tmp/nolate-ticket-policy-<새-ID>/main.swift \
  -o /private/tmp/nolate-ticket-policy-<새-ID>/policy
/private/tmp/nolate-ticket-policy-<새-ID>/policy
```

첫 버전은 기차 한 편의 이미지 한 장 또는 상세 텍스트 한 개만 지원한다. 이미지·OCR 원문·QR·
결제정보를 서버나 일정에 저장하지 않으며, 확인된 날짜·역·시각·열차번호만 개인 카테고리에
저장한다. 역 좌표는 임의로 만들지 않고 경로 설정에서 같은 승하차 장소인지 확인받는다.
버스·PDF·다중 표·원본 보관·취소/재발권 동기화·기기 알림은 후속 범위다.
결과는 `e2e/evidence/intercity-2026-10-12/ticket-import-validation.json`에 기록한다.

2026-10-12 최종 실행은 iOS 화면 1개(실패·스킵 0개), API 1개(이름 필터로 다른 TAGO
사례 2개 미선택), FE 9 suites / 138 tests, BE 3 suites / 50 tests, Swift 정책 11 assertions가
통과했다. typecheck와 공유 확장 빌드도 통과했고, 선택 파일 ESLint 오류는 0개다.
XCTest 원본은 `/private/tmp/nolate-ticket-import-20261012/native-12/result.xcresult`다.
초기 실패·중단과 최종 통과를 검증 JSON에 구분했으며 이전 단계 테스트 수와 합산하지 않는다.

### 가져온 표의 전체 경로 연결과 재실행

`testTrainTicketImageShareConnectRouteSaveReopen`은 위 공유·검토·저장 흐름에 이어,
경로 미설정 상태에서 도착 희망 시각을 20:00으로 수정해도 표가 유지되는지 검사한다.
이어 경로 설정 버튼으로 일정 수정에 진입해 출발지와 최종 목적지를 선택하고, 실제 TMAP
기차 경로에서 `가져온 승차권으로 연결`을 선택한다. 같은 승하차 장소임을 확인해야 적용할
수 있다. 실제 앞뒤 이동 경로를 연결해 저장한 뒤 앱을 다시 실행하고, 타임라인의
`승차권 입력 12:20`, 도착 `13:12`, `예매 상태 미검증`과 최종 목적지를 확인한다.

```bash
python3 e2e/ios/run.py \
  --device <전용-E2E-시뮬레이터-UDID> \
  --credentials <저장소-밖-합성-UI-계정-json> \
  --derived-data /private/tmp/nolate-ticket-xctest \
  --runner-bundle-id dev.nolate.intercity.selection.e2e \
  --only testTrainTicketImageShareConnectRouteSaveReopen \
  --output /private/tmp/nolate-ticket-journey-ui-<새-ID>
```

2026-10-12 후속 실행은 FE 12 suites / 160 tests, typecheck, 변경 파일 ESLint 오류·경고
0개, API 1개(TMAP 연결 2회, TAGO 0회, 다른 사례 2개 미선택), iOS 화면 1개가 통과했다.
iOS 최종 실행은 210.558초, 실패·스킵 0개이며 원본은
`/private/tmp/nolate-ticket-connection-20261012/native-03/result.xcresult`다.
화면에서 생성한 일정의 서버 저장값도 조회해 최종 목적지, 고정 열차 시각, `READY`와
알림 비활성화를 확인했다. 초기 실패 2회와 이전 단계 검증 수는 최종 통과 수에 합산하지 않는다.

결과는 [전체 연결 검증 JSON](../evidence/intercity-2026-10-12/ticket-journey-validation.json)과
[재실행 후 타임라인](../evidence/intercity-2026-10-12/ticket-journey-reopened.png)에 남긴다.
실제 코레일톡·구매 표·실기기 공유 또는 탑승용 증표·기기 알림 전달을 검증한 결과는 아니다.

## iOS 기차 공식 예매 웹 이동과 복귀 — 최초 웹 구현 기록

`testTrainOfficialBookingOpenReturn`은 합성 이미지 공유부터 전체 경로 저장·재실행까지
진행하면서 세 지점에서 실제 `코레일 공식 예매 열기` 버튼을 누른다.

- 경로 미설정인 가져온 표: Safari 복귀 후 표와 예매 미검증 상태 유지
- 선택한 미저장 기차 경로: Safari 복귀 후 경로 저장·시간표 조회 버튼 유지
- 승하차 장소를 확인한 운행편 연결 화면: Safari 복귀 후 선택 표와 확인 상태 유지

마지막에는 연결된 일정을 저장·재실행해 고정 열차 시각과 예매 미검증 상태를 검사한다.
저장된 경로 상세에서는 접힌 시트의 펼치기 버튼이 가려지지 않도록 예매 버튼을 펼친 뒤
표시한다. 경로 미설정 표의 일반 상세 화면에서는 바로 표시한다.
실제 브라우저의 `korail.com` 주소를 확인하며 로그인·좌석 선택·결제는 실행하지 않는다.
전용 UI 합성 계정의 테스트 표는 이전 실행의 것만 검증해 제거한 뒤 시작해야 같은 제목의
일정을 잘못 선택하지 않는다. API 회귀 테스트는 별도 합성 계정으로 실행한다.

Expo 개발 가상 환경 모듈은 `.env`를 셸 환경 뒤에 병합하므로 공급자가 다시 ODsay로
바뀔 수 있다. 전용 서버에는 아래 E2E 설정을 사용한다. 이 설정은 해당 서버의 그래프에서만
루트 `.env*`를 제외해 명시한 TMAP 설정을 유지한다. 일반 Metro 설정과 `.env`는 수정하지
않는다. `TMPDIR`도 새 비공개 테스트 폴더 아래로 지정해 캐시를 분리한다.

```bash
mkdir -m 700 /private/tmp/nolate-booking-cache-<새-ID>
TMPDIR=/private/tmp/nolate-booking-cache-<새-ID> \
CI=1 EXPO_PUBLIC_TRANSIT_PROVIDER=tmap EXPO_PUBLIC_ROUTE_API_PROXY_ENABLED=true \
EXPO_PUBLIC_LOCAL_API_BASE_URL=http://127.0.0.1:5524 \
EXPO_OVERRIDE_METRO_CONFIG="$PWD/e2e/ios/metro-intercity-e2e.config.cjs" \
REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 \
npx expo start --dev-client --localhost --port 8097 --clear
```

번들을 새로 연결하고 실제 검색 로그의 공급자가 `tmap`인지 확인한다. 테스트는 Safari의
주소 외에도 `승차권` 또는 `출발역`이 있는 실제 사이트 콘텐츠가 로드되는지 확인한다.

```bash
python3 e2e/ios/run.py \
  --device <전용-E2E-시뮬레이터-UDID> \
  --credentials <저장소-밖-합성-UI-계정-json> \
  --derived-data /private/tmp/nolate-ticket-xctest \
  --runner-bundle-id dev.nolate.intercity.selection.e2e \
  --only testTrainOfficialBookingOpenReturn \
  --output /private/tmp/nolate-booking-ui-<새-ID>
```

URL은 공식 공개 진입점인 `https://www.korail.com/`으로 고정하고 개인정보나 여정 쿼리를
붙이지 않는다. HTTPS의 앱·브라우저 선택은 iOS에 맡기며 미검증 앱 스킴·출도착지·날짜
자동 입력은 추가하지 않았다. 공식 앱이 설치된 실기기의 실행은 별도 검증 대상이다.
Android와 버스 예매 버튼은 이번 범위에서 보류한다.

2026-10-12 최종 실행은 FE 11 suites / 122 tests, typecheck, ESLint 오류 0개·기존
inline-style 경고 17개(새 파일 경고 0개), API 회귀 1개(TMAP 연결 2회, TAGO 0회,
다른 사례 2개 미선택), iOS 화면 1개가 통과했다. iOS는 236.673초, 실패·스킵 0개이며
원본은 `/private/tmp/nolate-booking-20261012/native-03/result.xcresult`다. 서버 조회로 실제
화면에서 생성한 일정의 고정 열차 시각·20:00 도착 희망 시각·최종 목적지·예매 미검증과
알림 비활성화도 확인했다. 공급자 설정 문제로 실패한 01과 접힌 시트 버튼 가림으로
실패한 02는 별도 기록했으며, 최종 통과 수나 이전 단계 테스트 수에 합산하지 않는다.

[예매 연결 검증 JSON](../evidence/intercity-2026-10-12/train-booking-validation.json)과
[실제 공식 웹 화면](../evidence/intercity-2026-10-12/train-booking-official-browser.png)에 근거를
남긴다. 미저장 경로의 백그라운드 복귀와 저장된 경로의 프로세스 재실행을 구분한다.

## iOS 코레일 앱 우선 연결

현재 버튼 표시는 `코레일 앱으로 예매`다. 접근성 이름 `코레일 공식 예매 열기`는 유지한다.
`korailtalk://gotoMainViewContoller` 처리 앱을 조회한 뒤 앱을 먼저 열고, 조회 실패·미설치·
앱 열기 실패 시 `https://www.korail.com/`을 연다. 앱 열기가 성공하면 웹을 추가로 열지 않는다.
이 주소는 2026-10-12 코레일 공식 웹 번들의 iOS 메인 화면 이동 코드에서 확인했다.
공개 외부 연동 계약은 아니므로 실제 코레일 앱 버전별 처리는 실기기에서 별도 확인해야 한다.
역·날짜 자동 입력과 예매 완료 판정은 지원하지 않는다.

`app.json`과 네이티브 `Info.plist`의 `LSApplicationQueriesSchemes`에 `korailtalk`을 추가했다.
기존 설치본에는 네이티브 재빌드가 필요하며 Metro 업데이트만으로 이 설정이 추가되지 않는다.
시뮬레이터 테스트는 기존 개발 앱 복사본에 제품과 같은 조회 허용 목록을 적용·재서명한다.
전체 네이티브 릴리스 빌드를 검증하는 절차는 아니다.

다음 준비 스크립트는 이름에 E2E가 포함된 부팅 중인 전용 시뮬레이터만 허용한다.
`absent`는 테스트 소유의 가짜 앱만 제거한다. 실제 코레일 앱을 삭제하지 않는다.

```bash
python3 e2e/ios/prepare-train-booking-e2e.py \
  --device <전용-E2E-시뮬레이터-UDID> \
  --output /private/tmp/nolate-train-app-<새-ID>/setup-absent \
  --app-fixture absent
# 같은 TMAP 전용 Metro에 앱을 새로 연결한 후 실행
python3 e2e/ios/run.py \
  --device <전용-E2E-시뮬레이터-UDID> \
  --credentials <저장소-밖-합성-UI-계정-json> \
  --runner-bundle-id dev.nolate.intercity.selection.e2e \
  --only testTrainOfficialBookingOpenReturn \
  --output /private/tmp/nolate-train-app-<새-ID>/native-absent
```

설치 분기는 별도 새 출력 경로에서 `--app-fixture install`로 준비하고
`--only testTrainAppBookingOpenReturn`을 실행한다. `TrainBookingFixture.swift`는
`dev.nolate.trainbookingfixture`로만 설치되는 합성 URL 처리 앱이며 제품에 포함하지 않는다.
화면에도 실제 코레일 앱이 아님을 표시하고 수신 주소에 계정·표 정보가 없는지 확인한다.
각 실행 전 이전 테스트가 만든 합성 일정만 정리하고 앱 세션을 다시 연결한다.
두 테스트 모두 표 가져오기·미저장 경로·승하차 확인 단계에서 전환/복귀한 뒤
고정 열차 시간과 최종 목적지를 저장하고 앱 종료/재실행까지 검증한다.
테스트 후 전용 시뮬레이터의 `dev.nolate.trainbookingfixture`를 제거한다.
이 설치 분기 통과는 iOS의 URL 전달과 NoLate 복귀를 증명하며 실제 코레일 앱 수신을 증명하지 않는다.

2026-10-12 앱 우선 연결 검증은 FE 11 suites / 127 tests, typecheck,
변경 TS 파일 ESLint 오류·경고 0개와 iOS E2E 2개가 통과했다.
웹 대체 연결 257.817초, 합성 앱 설치 연결 238.890초이며 실패·스킵 0개다.
각 실행의 서버 저장 결과에서도 고정 열차 12:20 → 13:12, 최종 도착 희망 시각 20:00 KST,
최종 목적지, TMAP 연결과 예매 미검증·알림 비활성화가 유지됨을 확인했다.
[검증 기록](../evidence/intercity-2026-10-12/train-app-validation.json),
[웹 대체 연결](../evidence/intercity-2026-10-12/train-app-web-fallback.png),
[합성 앱 수신](../evidence/intercity-2026-10-12/train-app-synthetic-handler.png),
[재실행](../evidence/intercity-2026-10-12/train-app-reopened.png)을 보관했다.
실제 코레일 앱·구매 표·iPhone 동작은 미검증이다. 이전 웹 전용 증거와 수치를 합산하지 않는다.

2026-10-12 후속 네이티브 재빌드: iPhone용 Release 1.3.0 (55) 빌드, 코드 서명,
아티팩트 메타데이터 검사와 컴파일된 앱 조회 목록·번들 연결 주소 검사가 통과했다.
[네이티브 빌드 기록](../evidence/intercity-2026-10-12/train-app-native-build.json)에 보관한다.
빌드는 iPhone에 설치하지 않았다. 실제 코레일 앱 실행은 기기 잠금으로 거절됐으며,
사용자가 “지금은 시뮬레이터 검증까지만”으로 지정해 **실기기 검증을 보류**한다.
사용자 요청 없이 실기기 검증을 재개하지 않는다. 기존 127개·시뮬레이터 2개 검증 수치는 그대로다.

## iOS 시외버스 실경로 검색·저장·재실행

`testIntercityBusSearchSaveReopen`은 동서울종합터미널 → 속초시외버스터미널을 실제
대중교통 경로 API(현재 ODsay)로 검색해 `시외버스` 후보를 선택한다. 다음 날 14:00 도착 희망 일정으로 저장하고
프로세스 종료·재실행 후 상세에서 시외버스 구간이 유지되는지 확인한다. 기존 기차·고속버스
테스트와 같은 공통 흐름을 사용하며 이 사례는 시간표의 특정 운행편을 선택하지 않는다.

현재 테스트는 동서울의 TAGO 터미널 검색도 확인한다. 목록에 없으면 해당 화면에서
티머니GO와 버스타고 예매처를 바로 열 수 있어야 한다. 동서울이 검색되는 날에는
존재하지 않는 터미널 이름으로 같은 빈 결과를 검증한다. 시간표를 닫은 후에는
선택한 시외버스 경로를 저장하고 앱을 재실행해 확인한다.

전용 API 5524와 위 TMAP 전용 Metro 설정을 사용한다. 신규 합성 UI 계정을 정상
가입·로그인으로 만들고 정상 `/api/recent-route-places` API에 아래 두 장소를 등록한다.
좌표는 실제 TMAP POI 조회값이다. API 회귀 계정은 별도로 만든다. UI 실행 중 같은 계정으로
다시 로그인하면 세션이 바뀔 수 있으므로 서버 저장값 확인은 화면 실행 종료 후에 한다.

| 최근 장소 이름 | 위도 | 경도 |
| --- | --- | --- |
| 동서울종합터미널 E2E | 37.5339323 | 127.09476136 |
| 속초시외버스터미널 E2E | 38.21118713 | 128.59088288 |

```bash
python3 e2e/ios/run.py \
  --device <전용-E2E-시뮬레이터-UDID> \
  --credentials <저장소-밖-신규-합성-UI-계정-json> \
  --derived-data /private/tmp/nolate-intercity-bus-xctest \
  --runner-bundle-id dev.nolate.intercity.selection.e2e \
  --only testIntercityBusSearchSaveReopen \
  --output /private/tmp/nolate-intercity-bus-<새-ID>/native
```

API 사례는 실제 캡처의 `EXPRESSBUS / type=22 / service=1`을 현재 FE로 변환한 뒤
정상 POST→DB GET→FE 복원까지 검증하고 생성한 일정만 삭제한다. 새 공급자 조회나 화면
E2E는 아니다. `places.json`에는 출발지, 도착지 순서로 `{name, lat, lng}` 값 두 개를 둔다.
별도 API 계정 JSON에는 정상 가입 결과의 `email`, `password`, `memberId`를 둔다.
계정·응답·장소·결과 경로는 모두 `/private/tmp/nolate-intercity-bus-` 접두사여야 한다.
아래는 FE 루트에서 실행한다. 공개 캡처를 별도의 비공개 테스트 폴더에 복사해 사용할 수 있다.

```bash
INTERCITY_BUS_E2E_CREDENTIALS=/private/tmp/nolate-intercity-bus-<새-ID>/credentials-api.json \
INTERCITY_BUS_E2E_RESPONSE=/private/tmp/nolate-intercity-bus-<새-ID>/live-response.json \
INTERCITY_BUS_E2E_PLACES=/private/tmp/nolate-intercity-bus-<새-ID>/places.json \
INTERCITY_BUS_E2E_OUTPUT=/private/tmp/nolate-intercity-bus-<새-ID>/api-proof.json \
npx jest --runInBand --no-watchman --testMatch '**/e2e/intercity-bus-api.e2e.ts'
```

2026-10-12 실행은 FE 6 suites / 171 tests, typecheck, 신규 API 테스트 ESLint,
API 1개와 iOS 화면 1개가 통과했다. 화면은 첫 실행 173.900초, 실패·스킵 0개다.
시외버스 130분과 전체 약 135분을 유지했고 서버 조회에서도 `INTERCITY_BUS`, `READY`,
알림 비활성화 및 예상 시간 근거를 확인했다. 원본은
`/private/tmp/nolate-intercity-bus-20261012/native-01/result.xcresult`다.

TAGO 정상 API도 동서울 `NAI0511601` → 속초 `NAI2482701`의 당일 시간표 34건을
반환했다. 이미 출발한 편을 포함하며 좌석 수가 아니다. **시간표의 한 편 선택·앞뒤 경로
연결·저장 화면 E2E는 후속 검증**이다. 대표 노선 한 건의 결과이며 전국 커버리지를
보장하지 않는다. 버스 예매 앱·승차권 가져오기, 실기기와 Android는 이번 범위에 포함하지 않는다.

[검증 기록](../evidence/intercity-2026-10-12/intercity-bus-validation.json),
[실제 TMAP 캡처](../evidence/intercity-2026-10-12/intercity-bus-tmap-response.json),
[검색 화면](../evidence/intercity-2026-10-12/intercity-bus-search.png),
[재실행 화면](../evidence/intercity-2026-10-12/intercity-bus-reopened.png)에 근거를 보관한다.

## iOS 시외버스 당일 편 선택과 자정 통과

`testIntercityBusSelectedServiceSaveReopen`은 인천국제공항 제2여객터미널 → 청주시외버스터미널을
실제 검색하고, TAGO에서 당일 23:00 심야우등 편을 조회해 선택한다. 사용자가 같은 승하차
장소임을 확인한 후 접근 이동과 준비·하차 여유를 연결하고, 다음 날 14:00 도착 희망 일정으로
저장한다. 앱 프로세스를 종료·재실행해 `시간표 23:00`과 `예매 미확인`이 유지되는지 검사한다.

이 사례는 **당일 실제 미래 23:00 편이 제공되고 탑승 준비시간이 남을 때만** 실행할 수 있다.
기기·서버 시계를 변경하거나 지난 편을 활성화하지 않는다. 자정 통과 도착 시각과 선택 편의
보존은 API 및 화면 실행 후 정상 서버 조회로 추가 확인한다. 실기기·Android는 보류한다.

전용 UI 계정을 정상 가입하고 `/api/recent-route-places`에 다음 두 장소를 등록한다.
요청의 이름 필드는 `label`, `placeName`이다(`name`이 아님). 등록 응답의 `label`을 확인한다.

| label 및 placeName | 위도 | 경도 |
| --- | --- | --- |
| 인천국제공항 제2여객터미널 E2E | 37.46792821 | 126.43237916 |
| 청주시외버스터미널 E2E | 36.62545989 | 127.43158967 |

```bash
python3 e2e/ios/run.py \
  --device <전용-E2E-시뮬레이터-UDID> \
  --credentials <저장소-밖-합성-UI-계정-json> \
  --derived-data /private/tmp/nolate-intercity-bus-selection-xctest \
  --runner-bundle-id dev.nolate.intercity.selection.e2e \
  --only testIntercityBusSelectedServiceSaveReopen \
  --output /private/tmp/nolate-intercity-bus-selection-<새-ID>/native
```

별도 API 계정으로 `e2e/intercity-bus-selection-api.e2e.ts`를 실행하면 실제 TAGO 당일 편과
실제 TMAP 도보 조회 2회로 접근·도착 후 이동을 연결한다. API 사례의 최종 목적지는 실제
POI 조회에 포함된 청주시외버스터미널 환승주차장이다. 이로써 터미널 도착으로 끝나는 화면
사례와 별도로 양쪽 외부 도보 이동을 검증한다. 단일 시외버스가 있는 초기 전체 경로는
실제 TMAP 캡처를 사용한다. POST→GET→FE 복원, 정상 개인 경로 수정, 고정 출발 시각을
옮기는 수정의 400 거절을 검사하고 이 API 사례가 만든 일정만 삭제한다.

API 계정 메일은 `xcuitest-intercity-bus-selection-api-...@example.test`이며 JSON에는
`email`, `password`, `memberId`를 둔다. `places.json`에는 출발지, 도착지 순서로
`{name, lat, lng}` 값 두 개를 둔다. 키 파일과 계정은 저장소 밖에 둔다.
아래는 전용 로컬 API 5524를 실행한 상태에서 FE 루트에서 실행한다.

```bash
INTERCITY_BUS_E2E_CREDENTIALS=/private/tmp/nolate-intercity-bus-selection-<새-ID>/credentials-api.json \
INTERCITY_BUS_E2E_RESPONSE=/private/tmp/nolate-intercity-bus-selection-<새-ID>/live-response.json \
INTERCITY_BUS_E2E_PLACES=/private/tmp/nolate-intercity-bus-selection-<새-ID>/places.json \
INTERCITY_BUS_E2E_TMAP_PROPERTIES=/private/tmp/nolate-intercity-<서버-ID>/server.properties \
INTERCITY_BUS_E2E_OUTPUT=/private/tmp/nolate-intercity-bus-selection-<새-ID>/api-proof.json \
npx jest --runInBand --no-watchman --testMatch '**/e2e/intercity-bus-selection-api.e2e.ts'
```


2026-10-12 최종 실행은 FE 6 suites / 80 tests, typecheck, 신규 API 테스트 ESLint,
API 1개와 iOS 화면 1개가 통과했다. 화면은 226.625초, 실패·스킵 0개이며 원본은
`/private/tmp/nolate-intercity-bus-selection-20261012/native-06/result.xcresult`다.
화면 실행 후 서버 대조에서도 schemaVersion 3, `anchored_journey`, `READY`, 알림 비활성화,
실제 편의 ID·23:00 출발·다음 날 01:25 도착·145분 구간이 유지됐다. 화면의 하차 터미널과
최종 목적지가 30m 이내여서 도착 후 외부 도보는 생략됐고, 별도 API 사례에서는 실제
환승주차장 목적지로 양쪽 도보 연결을 확인했다.

초기 최근 장소 seed 오류·복수 장거리 대안 선택·테스트 컴파일 및 축약명 비교 오류와
시뮬레이터 무응답 중단은 최종 통과와 분리해 기록했다. 전용 시뮬레이터만 재시작했으며
저장 데이터는 유지했다. 제품 코드나 지난 출발 제한은 변경하지 않았다. 이전 단계와
반복 실행의 테스트 수를 합산하지 않는다. BE 코드 변경·회귀 재실행은 이번 범위가 아니다.

[검증 기록](../evidence/intercity-2026-10-12/intercity-bus-selection-validation.json),
[API 연결·저장 증거](../evidence/intercity-2026-10-12/intercity-bus-selection-api.json),
[실제 편](../evidence/intercity-2026-10-12/intercity-bus-selected-timetable.png),
[터미널 확인](../evidence/intercity-2026-10-12/intercity-bus-selected-mapping.png),
[재실행 상세](../evidence/intercity-2026-10-12/intercity-bus-selected-reopened.png)에 근거를 보관한다.
전국 커버리지·예매·실제 표·좌석·탑승홈·기기 알림을 검증한 결과는 아니며,
버스 예매 앱 연결·승차권 가져오기, 실기기·Android는 후속 대상이다.

## 2026-10-13 버스·PDF 승차권과 고정 출발 시각

제품 범위는 iOS의 기차·고속·시외버스 단일 승차권 여정이다. 이미지·상세 텍스트·잠기지 않은 1페이지 PDF를 지원한다. PDF는 20MB 이하이고, 텍스트 추출 실패 시 기기 내 OCR을 사용한다. 여러 파일·여러 페이지·취소/환불 완료로 인식한 표는 저장하지 않는다. 사용자 수정·원본 일치 확인 전에는 저장할 수 없다. 이미지 OCR이 터미널의 숫자를 잘못 읽을 수 있으므로 자동 정규화로 실제 장소를 확정하지 않는다.

`testBusTicketImageShareConnectRouteSaveReopen`은 합성 시외버스 이미지를 실제 공유 시트로 가져온 후 12:20→14:45를 고정하고 인천공항 제2터미널→청주 경로를 실제 TMAP으로 조회해 연결·저장·재실행한다. 알림은 비활성화한다. 티머니GO가 없는 시뮬레이터에서는 세 단계에서 실제 공식 웹을 열고 돌아와 선택 상태가 유지되는지 확인한다.

`testBusTicketPDFShareSaveReopen`은 텍스트 PDF의 수신·사용자 확인·저장·재실행을 검증한다. 합성 `tmoneytia` 처리 앱을 설치한 경우 앱 전환·정확한 메인 URL·복귀를 확인한다. 같은 PDF를 다시 공유해 중복 거절 문구를 확인한다. `testBusTicketScannedPDFShareSaveReopen`은 이미지로만 된 PDF에서 OCR을 거쳐 저장·재실행한다. PDF 두 사례는 경로 연결 전 `NOT_CONFIGURED` 상태를 검증하며, 전체 경로 연결 검증으로 집계하지 않는다. 합성 앱은 실제 티머니GO가 아니다.

공유 확장 빌드에는 해당 테스트 API를 명시해야 한다. 이 실행에서는 기본 Debug 주소 5522 대신 `NOLATE_API_BASE_URL=http://127.0.0.1:5524`를 xcodebuild 인자로 전달했다. `prepare-ticket-share-fixture.py`는 복사한 개발 앱에 제품의 조회 목록과 현재 확장만 반영하며 기존 데이터를 유지한다. 합성 공유 앱은 이미지·텍스트·PDF·스캔 PDF 버튼을 제공한다.

```bash
python3 e2e/ios/prepare-train-booking-e2e.py \
  --device <전용-E2E-시뮬레이터-UDID> --bus \
  --app-fixture absent --output /private/tmp/nolate-train-app-<새-ID>-bus-absent
python3 e2e/ios/run.py \
  --device <전용-E2E-시뮬레이터-UDID> \
  --credentials <저장소-밖-합성-UI-계정-json> \
  --derived-data /private/tmp/nolate-ticket-xctest \
  --runner-bundle-id dev.nolate.intercity.selection.e2e \
  --only testBusTicketImageShareConnectRouteSaveReopen \
  --output /private/tmp/nolate-ticket-completion-<새-ID>-bus-image
```

PDF 앱 전환 검증 전 같은 도우미를 `--bus --app-fixture install`과 새 출력 경로로 실행한다. 별도 PDF 합성 계정으로 `--only testBusTicketPDFShareSaveReopen`, 스캔 합성 계정으로 `--only testBusTicketScannedPDFShareSaveReopen`을 각각 실행한다. API 로그인만으로 기존 UI의 다른 계정이 로그아웃된다고 가정하지 않는다. 테스트는 현재 프로필이 `xcuitest-ticket-completion-…@example.test` 합성 계정인지 확인한 뒤 화면의 정상 로그아웃·확인을 거쳐 제공된 별도 계정으로 로그인한다. 실제 사용자 계정은 자동 로그아웃하지 않는다. 각 계정의 준비·온보딩은 정상 가입 API로 수행하고 비밀번호·토큰은 저장소 밖 파일에만 둔다. 버스 전체 연결 계정의 최근 장소에는 인천공항 제2터미널과 청주시외버스터미널 두 항목을 준비한다. 키보드가 가린 최근 장소는 스크롤 후 선택한다.

독립 API E2E는 현재 로컬 5524 서버의 별도 합성 계정 `credentials-api.json`을 사용한다. 캡처한 실제 TMAP 초기 응답과 실제 도보 API 2회씩으로 연결하며 TAGO 호출은 없다. 동시 중복 공유, 연결 후 재공유, 시각·등급 변조 거절, 고정 출발 상태, 삭제 후 재가져오기를 확인한다. API 계정의 생성 일정은 테스트가 삭제한다. 기본 Jest 대상에는 포함하지 않는다.

```bash
TICKET_COMPLETION_E2E_ROOT=/private/tmp/nolate-ticket-completion-<ID> \
TICKET_COMPLETION_RESPONSE=/private/tmp/nolate-intercity-<ID>/airport-daytime-response.json \
TICKET_COMPLETION_TMAP_PROPERTIES=/private/tmp/nolate-intercity-<ID>/server.properties \
npm test -- --runInBand --no-watchman --testMatch '**/e2e/ticket-completion-api.e2e.ts'
```

운영 기본 공급자와 `.env`는 바꾸지 않는다. ODsay 한도 초과 후 이 전용 테스트 세션만 TMAP을 사용한다. 최종 결과·초기 실패·화면·소스 해시는 [최신 검증 기록](../evidence/intercity-2026-10-13/ticket-completion-validation.json)에 구분한다. XCTest 종료 후 summary를 읽고, 다음으로 attachments를 추출한다. 원시 XCTest 로그에는 합성 로그인 입력이 있으므로 그대로 공개하지 않는다.

실제 코레일/티머니GO 앱의 주소 수신과 실제 구매한 표의 외부 공유 형식, Android, 전국 커버리지, 원본·QR 오프라인 보관, 예매 취소 자동 동기화와 실제 기기 알림 전달은 이 결과로 확인되지 않는다. 실기기는 사용자 지시로 보류한다.

새 개발 앱이 Expo launcher에서 시작하면 `TEST_RUNNER_E2E_METRO_URL=http://127.0.0.1:8097`을 `run.py` 앞에 명시한다. 테스트는 관찰한 `Enter URL manually` 화면에서 이 주소만 입력하며, Bonjour로 표시된 다른 개발 서버를 선택하지 않는다. URL은 loopback HTTP만 허용한다. 이 절차는 테스트 준비이고 제품 코드의 연결 분기가 아니다.

예매 앱 전환 없이 PDF 수신·중복 방지만 독립 검증하려면 `testBusTicketPDFShareDuplicateSaveReopen`을 사용한다. 설치 앱 전환까지 포함한 `testBusTicketPDFShareSaveReopen`의 성공 기준은 그대로 유지한다. iOS 27과 iOS 26.5에서 앱 전환 중 LaunchServices `openOptionsModifiedForOneTapOpen`의 sandbox extension 발급이 멈춘 초기 실행은 실패로 기록하며, 테스트 본문 실패 후 해당 앱과 진단 수집기만 정리한다. 다른 시뮬레이터나 호스트의 공용 서비스를 재시작하지 않는다.

최종 제품 파서는 숫자가 있는 터미널 이름을 허용하면서 `출발 12:20`의 `12`를 장소로 인식하지 않는다. 유효한 표에 포함된 “예매 취소 안내”와 실제 “취소 완료” 상태도 구분한다. 합성 버스 문서에는 취소수수료 안내를 넣어 정상 공유가 막히지 않는지 확인한다. Swift 정책 검증은 총 24개 assertion이다.

최종 네이티브 집계는 앱 미설치 상태의 버스 이미지 전체 연결·공식 웹 복귀, PDF 수신·중복 거절, 스캔 PDF OCR·복원, 기차 이미지 전체 연결 네 사례다. 설치된 합성 티머니GO 처리 앱 전환은 두 OS에서 멈춰 통과로 집계하지 않는다. 실제 앱과의 전환 보장은 실기기 후속 검증이 필요하다.

최종 실행은 네 사례 모두 1 passed / 0 failed / 0 skipped이며, 저장 API로 별도 대조했다. 버스 이미지 261.908초·기차 이미지 224.668초(iOS 27), PDF 중복 100.962초·스캔 PDF 108.813초(iOS 26.5)다. FE 170개·BE 276개·Swift 24개·API 2개, typecheck와 서명된 iPhone Release 빌드도 통과했다. ESLint 오류는 0개이며 inline-style 경고 11개는 남아 있다. 원본 xcresult 경로·소스 해시·초기 실패는 최신 검증 JSON을 따른다.


## 2026-10-15 실제 iPhone의 공식 앱 URL 실행 확인

사용자가 iPhone 연결 후 실기기 진행을 요청했고, 범위를 “지금은 표 없이 앱 전환만 확인”으로 지정했다. 현재 소스로 만든 서명된 Release 1.3.0(55)를 iPhone 13 / iOS 26.6의 기존 NoLate 위에 업데이트 설치했다. 이 설치 빌드는 운영 API를 사용하고 TMAP을 선택하며, `.env`와 운영 서버 배포는 변경하지 않았다. 앱을 삭제하거나 계정을 로그아웃하지 않는다.

`PhysicalBookingSmokeTests.swift`와 `run-physical-booking-smoke.py`는 현재 제품의 두 URL 상수를 읽어 실제 기기에서 검사한다. UI 테스트 실행기를 foreground로 활성화한 다음 `UIApplication.open`에 URL만 전달하고, 실제 코레일+ 또는 티머니GO의 bundle이 foreground가 되는지 확인한다. 수신 앱을 bundle ID로 지정해 강제 실행하는 방식과 구분한다. 이후 NoLate를 다시 활성화하고 화면 복귀를 확인한다. NoLate의 컴파일된 조회 허용 목록·실기기 프로비저닝·서명도 따로 검증했다.

```bash
python3 e2e/ios/run-physical-booking-smoke.py \
  --device <연결된-실제-iPhone-UDID> \
  --output /private/tmp/nolate-physical-booking-<새-ID>
```

최종 URL 실행 smoke는 2 passed / 0 failed / 0 skipped이며, 예매 연결·가져온 표·고정 여정의 FE 회귀는 4 suites / 52 tests가 통과했다. NoLate의 실제 예매 버튼을 화면에서 직접 누르는 전체 UI 흐름, 예매처 메인 화면 로딩 완료, 실제 승차권 공유·저장, 로그인·구매·알림 전달 검증으로 확대 해석하지 않는다. 이번 테스트는 일정을 생성·수정·삭제하지 않으며, 실제 표 공유는 사용자 요청대로 수행하지 않았다.

초기 복사 캐시 경로 오류와 background 테스트 실행기의 URL 요청 거절은 실패 기록으로 남겼다. 수신 bundle을 지정한 중간 URL 진입 검증은 최종 통과 수에 합산하지 않았다. 실제 달력과 예매 앱의 화면이 담긴 스크린샷·녹화·원시 로그는 저장소 밖 비공개 xcresult에만 보관한다. 사용한 테스트 실행기만 종료 후 제거했고, NoLate와 실제 예매 앱은 유지했다.

[실기기 URL 실행 검증 기록](../evidence/intercity-2026-10-15/physical-booking-validation.json)

## 저장된 버스 경로의 잠금 상태 하차·최종 도보

`testIsolatedSavedRouteNavigationEntry`의 `E2E_BUS_LOCK_FULL_TRIP=1`은
`E2E_EXPECT_OFFICIAL_BUS=1`, `E2E_BUS_GPS_REPLAY=1`, `E2E_BUS_FULL_TRIP=1`과 함께 사용한다.
격리 계정의 저장된 1711 경로와 독립적인 시험 차량/GPS 재생이 필요하며,
교통 단계나 도착 상태를 API로 강제 변경하지 않는다.

`E2E_BUS_LOCK_BEFORE_HANDOFF_READY` 뒤 **해당 시험 UDID의 독립 Device Hub 창**에서
Controls → Lock을 사용한다. 다른 시뮬레이터나 실기기를 잠그지 않는다.
첫 Live Activity 표시 허용 창이 있으면 시험 기기의 NoLate 요청인지 확인한다.
XCUITest는 잠금 화면의 정류장 접근 안내와 `목적지까지` 전환을 확인하고,
자동 도착 뒤 `위치 안내를 종료했어요` 종료 카드를 먼저 확인한다.
제품은 이 인계 카드를 최대 90초 유지한다. 이후 최종 도보 제목·경로 식별 정보·
종료 카드가 모두 30초 연속 사라져야 카드 제거로 판단하고 화면을 보관한다.
순간적인 접근성 트리 갱신이나, 도보 카드가 종료 카드로 바뀌는 것은 제거로 세지 않는다.
`E2E_BUS_LOCK_CARD_REMOVED` 뒤 같은 시뮬레이터를 잠금 해제하면,
앱 화면의 `목적지에 도착했어요`도 확인해야 통과한다.
카드 제목이 잠깐 사라지는 것만으로 자동 도착을 통과 처리하지 않는다.

이는 로컬 Live Activity와 주입 GPS의 제품 화면 시험이다. 실제 APNs 수신,
현장 차량 응답의 연속성, 실기기 GPS·무음·음성 전달을 증명하지 않는다.

## 일반 제품 화면의 버스 환승 완주

`testIsolatedSavedRouteNavigationEntry`의 `E2E_BUS_TRANSFER_FULL_TRIP=1`은 일반
로그인·저장 일정·지도·경로 시트에서 첫 버스 대기/탑승→환승 도보→두 번째 버스
대기/탑승→최종 도보→자동 도착을 검사한다. 두 번째 탑승 때 접힌 경로 바의 현재
위치 마커도 검사한다. 안내 단계·탑승·도착을 강제로 설정하는 입력은 사용하지 않는다.

BE test source의 `TransferBusProductSimulatorServer`는 명시적인
`-Dnolate.journey.transfer-product-e2e=true`와 권한 0700의 새
`/private/tmp/nolate-transfer-product-e2e.*` 디렉터리를 요구한다. loopback 5528/H2만
사용하며 실기기 준비는 꺼져 있다. 동일 디렉터리의 `start-bus-1`/`start-bus-3`은
승객 GPS를 받지 않는 별도 시험 차량 시계만 시작한다. `bus-*-started-at`의 확인된
시각에 맞춰 지정 시험 시뮬레이터에 GPS를 주입한다. 차량 시계를 시작한 뒤 재생을
반복하려면 새 서버와 새 디렉터리를 사용한다. 안내 준비·차량 시계 전에 앱 실행만
실패했다면 같은 미사용 서버와 새 결과 폴더에서 재시도할 수 있다. 이때 설치 앱의
해시·정상 기동과 이전 실행의 실제 종료를 확인하고 실패 결과를 보존한다.
정상 종료·실패 모두 주입 GPS를 정리한다.

현재 사례는 120m 환승 도보와 110m 최종 도보다. 10m 정류장 인근의 짧은 환승에서는
연속 위치 근거 후 다음 버스 대기로 바로 넘어갈 수 있어, 도보 문구가 반드시 오래
표시된다는 가정을 사용하지 않는다. 합성 경로·보행 HTTP 응답·시험 차량이므로 공식
노선 완주, 전국 지원, 실제 차량/APNs 또는 실기기 검증으로 집계하지 않는다.

## 서울역에서 충무로를 거쳐 경복궁까지 지하철 환승

`run-journey-subway-transfer.py`는 전용 시뮬레이터에 Release 앱을 새로 설치하고 저장 일정 563에서 출발한다.
서울역 승차, 명동에서 다음 역 환승 안내, 충무로 환승 도보와 3호선 대기, 을지로3가의 경로 바,
경복궁 하차와 최종 도보 도착을 차례로 확인한다. `--lock`을 주면 독립 시뮬레이터 창을
`LOCK_READY`에서 잠가, 3호선 열차의 다음 역인 종로3가를 잠금 카드에서 확인한다.
`--verify-transfer-copy`로 실행하면 첫 번째 열차에서 세션 검증 재시도와 위치 복구를 거쳐
충무로 환승 도보까지만 진행한다. 3호선 승차 안내, 기술 코드와 지난 경고가 사라진 화면을 확인하고 앱에서 안내를 종료한다.

```sh
python3 e2e/ios/run-journey-subway-transfer.py <격리-결과-디렉터리> <Release-시뮬레이터-앱> <전용-UDID> --lock
```

BE 시험 서버 `OfficialSubwayProductSimulatorServer`를
`-Dnolate.journey.official-subway-product-e2e=true -Dnolate.journey.transfer-subway-replay=true`로
시작한다. 인자는 새 0700 디렉터리 `/private/tmp/nolate-transfer-subway-product.*`이다.
원본 ODsay 응답을 제품 파서와 경로 데코레이터로 읽은 `product-route.json`, 출도착 `places.json`,
각 탑승 구간의 공식 역명·종점 코드 조회 응답 `path-{1,3}-{name,code}.json`, 서울교통공사
`official-coordinates.csv`, 각 보행 요청의 TMAP 응답 `walk-{0,2,4}.json`을 여기에 둔다.
각 구간은 저장된 경로와 동일한 출도착 좌표로 받아야 한다. 서버는 이 파일을 제품 경로로 재검증하고
`127.0.0.1:5535`의 H2에 시험용 일정과 계정을 저장한다. 열차 관측은 두 독립 시계에서 만들고
승객 위치는 시뮬레이터에 주입한다. 판정 결과는 `simulator-e2e/result.xcresult`와
`subway-responses.jsonl`에서 확인한다.

회현에서 명동으로 이동할 때 같은 역 이름 쌍이 유지되는 동안 두 시점의 경로 바 마커 위치를 비교한다.
명동에서 충무로로 이동할 때 승객의 위치 입력만 약 18초간 중단해 직전 역 기록으로 돌아가고
현재 위치 마커가 사라지는지 확인한다. `--lock`을 쓰면 두 번째 열차의 을지로3가→종로3가 역간 표시와
이후 종로3가 정차 표시를 잠금 화면에서 각각 확인한다. 정차역의 승객·열차 일치 판정은 별도로 유지한다.
이 격리 서버는 첫 보행 구간의 재검증 요청 한 번에 H2의 시험 계정 행을 잠근다.
시험은 해당 요청의 503 응답, 잠금 해제 후 같은 세션의 200 응답, 앱의 길안내 지속을 함께 검증한다.

### Safari 승차권 본문 공유 (2026-11-19)

공유 확장에 Apple의 JavaScript preprocessing과 활성화 dictionary version 2를 등록했다.
주소와 본문처럼 한 항목에 여러 표현이 있어도 지원 형식을 제공하면 표시한다. Safari가 제공한 공식 철도
도메인의 표시 본문만 기기에서 분석하고 기존 승차권 확인 화면으로 보낸다. 전달용 URL의
경로·query, 쿠키, 폼, HTML, QR 이미지를 수집하거나 링크를 별도로 조회하지 않는다.
확인된 승차권 필드는 기존 `IOS_SHARE_TEXT` 계약으로 저장하며 사용자 확인은 필수다.

카카오톡 내 브라우저 등에서 URL만 보내면 본문을 읽었다고 간주하지 않는다. 이 경우
`승차권 내용이 필요해요`와 Safari에서 재공유하거나 사진 앱에서 캡처를 공유하는 방법을
표시한다. 실제 받은 승차권 URL·해당 페이지의 DOM·카카오톡의 본문 전달은 아직 검증하지 않았다.

`node --test scripts/ticket-web-page.test.cjs`는 전처리의 도메인·본문·URL 제외·크기 제한을,
`TrainTicketImportPolicyTests.swift`는 네이티브 본문 검증과 기존 승차권 검증을 확인한다.
`testTrainTicketWebPageShareReviewAndURLOnlyRecovery`는 합성 공유 앱이 제공한 URL과
전처리 property list에서 본문을 우선 사용해 역·열차번호를 채우는지, 저장이 사용자 확인
전에는 잠겨 있는지, 취소 후 URL만 공유하면 재공유 안내가 나오는지 확인한다. 실제 Safari나
코레일이 본문을 전달했다는 증거로 집계하지 않는다.

Apple 계약: [App Extension Programming Guide — Accessing a Webpage](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html).

2026-11-19 최종 실행은 서명된 Release 공유 확장과 전용 iOS 27 시뮬레이터에서
위 UI 검사 1건·0건 실패(66.827초), 전처리 Node 검사 4건·0건 실패, Swift 정책 검사와
변경 JavaScript lint(오류·경고 0개)가 통과했다. 합성 브라우저는 URL placeholder로
공유 대상을 선택한 다음 `NSExtensionItem`에 URL·전처리 결과를 제공한다. 전처리 결과를
처음부터 제공해 공유 목록에서 빠진 앞선 시도와, 이미지 OCR의 모든 역 이름을 자동
채움으로 가정했던 실패도 [검증 기록](../../docs/qa/2026-11-19-ticket-webpage-share-validation.json)에
보존했다. 실제 Safari JavaScript 실행·실제 코레일 승차권·카카오톡 호환성 및 아이폰 설치는
이 결과에 포함하지 않는다.

### 코레일 스마트티켓 사진 공유

`prepare-ticket-share-fixture.py`에 `--smart-ticket-photo`를 추가하면 전용 시뮬레이터의
사진 보관함에 `NoLateSmartTicketFixture.jpg`를 넣는다. 합성 사진에는 상태바 시각과
서울 06:43, 동대구 08:32, KTX 255가 두 열로 배치돼 있다.
`testSmartTicketScreenshotFromPhotos`를 실행할 때 해당 시뮬레이터 UDID를
`TEST_RUNNER_E2E_DEVICE_ID`에, 사진 보관함에 표시되는 해당 썸네일의 전체 접근성 레이블을
`TEST_RUNNER_E2E_SMART_TICKET_PHOTO_LABEL`에 전달한다. 사진 앱의 공유 시트에서 NoLate를
열어 역·시각·열차번호와 확인 전 저장 버튼 상태를 검사한다.

`testSmartTicketUpcomingSaveAndReopen`은 같은 배치의 합성 표를 한국 시간 기준 다음 날로
생성한다. 격리 서버에 로그인한 테스트 계정 이메일을 `TEST_RUNNER_E2E_TICKET_WRITE_EMAIL`에
전달하면 프로필을 확인한 뒤 표를 일정에 저장하고 앱을 재실행해 달력과 상세 화면에서 확인한다.
`--smart-ticket-photo upcoming`으로 다음 날 표를 사진 보관함에 넣고 그 썸네일 레이블을
`TEST_RUNNER_E2E_UPCOMING_SMART_TICKET_PHOTO_LABEL`에 지정하면 같은 저장 검사를 사진 앱에서 시작한다.

### 스마트티켓 PDF를 파일 앱에서 공유하기

전용 iOS 시뮬레이터와 격리 계정에서 다음 순서로 Safari가 생성한 한 페이지 PDF를 확인한다.

1. FE 루트에서 `python3 -m http.server 8765 --bind 127.0.0.1 --directory e2e/ios/fixtures`를 실행한다.
2. 시뮬레이터 Safari로 `http://127.0.0.1:8765/smart-ticket-print.html`을 연다. 공유 시트의 **옵션 → PDF**를 선택하고 **파일에 저장 → 나의 iPhone**에 `NoLate 합성 승차권.pdf`를 저장한다.
3. 파일 앱에서 **나의 iPhone**을 연다. `TEST_RUNNER_E2E_SAFARI_SMART_TICKET_PDF=1`과 `TEST_RUNNER_E2E_DEVICE_ID`를 해당 시뮬레이터 테스트에 전달하고 `testSmartTicketPDFFromFiles`를 실행한다. 테스트는 저장된 PDF를 길게 눌러 NoLate에 공유하고 역·시각·열차번호와 확인 전 저장 버튼 상태를 검사한다.

`testSmartTicketTextPDFRecognizesBothColumns`와 `testSmartTicketScannedPDFRecognizesBothColumns`는 같은 표를 선택 가능한 텍스트 PDF와 스캔 PDF로 각각 공유한다. `testSmartTicketUpcomingScannedPDFSaveAndReopen`은 격리 계정의 `TEST_RUNNER_E2E_TICKET_WRITE_EMAIL`을 확인한 뒤 다음 날 표를 저장하고 앱을 재실행해 캘린더에서 다시 연다.

`testSmartTicketHybridPDFRecognizesBothColumns`는 이미지로 된 승차권 아래에 선택 가능한 ‘전자문서 사본’ 한 줄이 있는 PDF를 검사한다. `testSmartTicketHybridPDFRejectsRefundedTicket`은 그 줄에 ‘환불 완료’가 있으면 사용자가 원본을 확인한 뒤에도 저장이 거절되는지 검사한다.

시외버스 스캔 PDF에서는 iOS Vision이 실제 화살표를 `인천공항2터미널 >> 청주`로 읽은 사례도 검사한다. 같은 파일의 저장·재실행 검증은 `testBusTicketScannedPDFShareSaveReopen`, 선택 가능한 PDF의 중복 저장 검증은 `testBusTicketPDFShareDuplicateSaveReopen`을 사용한다. [기차·버스 PDF 검증 기록](../../docs/qa/2026-11-20-smart-ticket-pdf-validation.json)

### 웹페이지 본문으로 전달되는 두 열의 스마트티켓

공유 호스트를 `prepare-ticket-share-fixture.py`로 준비하면 빌드한 공유 확장의 `TicketWebPage.js`와 인쇄용 합성 HTML이 함께 설치된다. `testSmartTicketRenderedWebPageRecognizesBothColumns`는 iOS WebKit으로 이 HTML을 메모리에서 렌더링하고, 제품 스크립트의 반환값과 테스트 URL을 시스템 공유 시트를 통해 NoLate로 보낸다. 원본 사이트로 네트워크 요청을 보내지 않는다.

`testSmartTicketReversedWebPageUsesVisualOrder`는 화면을 유지한 채 HTML 요소의 순서를 뒤집고 열차명과 번호를 나눠 검증한다. `testSmartTicketLabelledWebPageUsesClockLabels`는 본문에 도착 시각이 먼저 나와도 출발·도착 라벨에 따라 시각을 읽는지 확인한다. `testSmartTicketPartialWebPageLeavesTimesForReview`는 도착 시각이 빠지고 표 밖에 다른 시계가 있어도 입력이 비어 있는지 확인한다. `testSmartTicketPastWebPageRejectsSave`는 지난 표의 저장 거절을 확인한다. `testSmartTicketUpcomingWebPageSaveAndReopen`는 전용 시뮬레이터와 로그인한 합성 계정에서 다음 날 표를 확인·저장한 뒤 앱을 재실행해 달력 상세를 검사한다. 실제 코레일 페이지의 구성과 카카오톡이 제공하는 공유 항목은 실기기에서 별도로 확인한다.

전체 앱을 새로 설치해 검사할 때는 Release 빌드에 전달한 `EXPO_PUBLIC_API_BASE_URL`·`EXPO_PUBLIC_LOCAL_API_BASE_URL`과 공유 확장의 `NOLATE_API_BASE_URL`을 같은 테스트 서버로 설정한다. Metro는 공개 환경 설정이 달라지면 변환 캐시를 구분한다. 빌드 결과의 `Release-iphonesimulator/main.jsbundle`에 기록된 두 API 설정값과 앱에 포함된 공유 확장의 `Info.plist`에서 실제 주소를 대조할 수 있다. [웹페이지 공유 검증 기록](../../docs/qa/2026-11-19-ticket-webpage-share-validation.json)

### 출발·도착 시각과 실제 Safari 공유

`testTicketLabelledTextAndPDFKeepAfternoonRideTimes`는 도착을 먼저 적은 한국어 승차권을 텍스트와 PDF로 공유한다. 현재 시각이 함께 있고 출발 시각만 빠진 경우에도 확인 화면의 두 입력값을 검사한다. `testTicketLabelledOvernightBusPDFSaveAndReopen`은 양쪽 날짜가 명시된 심야 시외버스 표를 공유하고, 다음 날 달력에서 저장된 일정을 다시 연다. 저장 테스트는 기존 승차권 테스트와 같은 전용 계정과 `E2E_TICKET_WRITE_EMAIL`을 사용한다.

`testSmartTicketFromSafariWebShare`는 시뮬레이터의 Safari에서 합성 페이지의 공유 버튼을 누른다. `NoLate_FE`에서 다음 명령으로 페이지를 열 수 있다.

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory e2e/ios/fixtures
```

XCUITest 실행 시 `TEST_RUNNER_E2E_SMART_TICKET_SAFARI_URL=http://127.0.0.1:8765/smart-ticket-share.html`을 전달한다. 이 페이지는 웹 공유 API로 승차권 상세 텍스트와 공개 코레일 홈페이지 주소를 각각 보낸다.

`TEST_RUNNER_E2E_PUBLIC_RAIL_BOOKING_HOME=1`로 `testSmartTicketKorailHomeFromSafariToolbar`를 실행하면 Safari 도구 막대에서 실제 코레일 공개 홈페이지를 공유한다. 예매 양식의 기본 출발역·도착역·시각이 승차권으로 표시되는지 검사한다. `testSmartTicketForwardedPreviewNeedsTicketDetails`는 전달 링크와 제목만 담은 두 가지 공유 형식에서 안내를 확인하고, 승차권 상세를 함께 보냈을 때 원래 역·시각·열차번호가 표시되는지 검사한다. 개인 승차권 페이지와 카카오톡 앱의 공유 동작은 실기기 확인 대상이다.

`testSmartTicketCompactRailPhotoReadsPrintedRoute`는 수서 → 공주 SRT 615 합성 이미지를 공유해 역 이름을 직접 입력하기 전의 확인 화면을 검사한다. 같은 화살표를 Vision이 iOS 26.5에서는 `>`, iOS 27.0에서는 `>>`로 읽었다. 날짜와 열차번호 사이에 경로 한 줄이 있고 출발·도착 시각이 확인되는 경우를 검증한다.

같은 페이지에서 `testSmartTicketBusLinksAndDetailsFromSafari`를 실행하면 티머니 시외버스·버스타고·고속버스통합예매 링크를 각각 공유한 뒤 버스타고 링크와 합성 승차권 본문을 함께 공유한다. 링크만 받으면 상세 내용이 필요하다는 안내가 나오고, 본문을 함께 받으면 터미널·등급·시각을 확인할 수 있다. `testSmartTicketCarrierAppLinksRequestTicketContent`는 테스트 호스트에서 티머니GO 앱 주소와 코레일톡 앱 주소를 시스템 공유 시트로 보낸다.

`testSmartTicketBusWebPageUsesCarrierAndRejectsBookingHome`는 WebKit으로 렌더링한 합성 고속버스 승차권과 예매 양식을 검사한다. `testSmartTicketOvernightBusWebPageSaveAndReopen`은 전용 계정의 달력에서 저장된 다음 날 도착편을 다시 연다. `TEST_RUNNER_E2E_PUBLIC_BUS_BOOKING_HOME=1`을 설정하면 `testSmartTicketTmoneyHomeFromSafariToolbar`에서 Safari 도구 막대로 티머니 시외버스 공개 홈페이지를 공유하는 흐름도 검사할 수 있다.


### Reported boarding followed by a fresh alighting forecast

`run-eta-early-transfer.py --phase reported-boarding --java <java21> --backend-snapshot <owned-copy>`
uses three Worker evaluations in isolated H2: accepted plan, an ARRIVED state without a matching
alighting vehicle, then a later fresh forecast for that exact vehicle. The pending state must remain
LAST_ACCEPTED_PLAN. The final API and pinned installed app must distinguish historical station
arrival from a future forecast, retain the original departure/alarm and walking segments, and use
the actual vehicle number rather than the comparison timetable number. All provider rows and
clock advances are declared synthetic; this is not an accuracy or physical-boarding result.

The real runner's `--verify-reported-boarding-chain` requires
`--verify-timetable-planned-postdeparture --verify-observed-service-connection --observe-train-positions`.
An explicit departure selectable in Naver’s public ten-minute picker is required before startup.
It spends only the original three evaluations: initial future plan, last boarding +30 seconds,
and a later alighting window. A missing natural ARRIVED state stays unverified; another simultaneous
endpoint match cannot satisfy this historical-state scenario. The maximum remains three ETA
rounds, 16 separate position HTTP calls, and one supplementary station per production refresh.
Provider/auth/quota errors stop the run without retry or key changes. Keep the accepted input,
actual clock and results intact; use only the authorized simulator, H2 and owned 5523/8086.
