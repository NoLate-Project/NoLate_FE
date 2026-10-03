# iOS XCUITest

Device Hub의 macOS 접근성 제어 대신 XCTest가 시뮬레이터의 설치된 NoLate 앱을 직접 조작한다. 앱 화면이나 인증 로직에 테스트 우회 코드를 넣지 않는다.

## 준비

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

이미 온보딩까지 완료된 테스트 계정의 달력 화면에서는 `--only testCalendarCreateAndEdit`로 일정 생성 → 길게 누르기 → 수정 → 상세 화면 확인 → 달력 반영 확인을 실행할 수 있다. 이 테스트는 `XCUITest <timestamp>` 제목의 종일 일정을 실제 서버에 저장하며, 알림은 켜지 않는다. 실행 후 해당 테스트 계정의 생성 일정만 정리한다.

화면을 직접 보려면 Device Hub 기기 목록에서 테스트에 사용한 시뮬레이터를 선택한다. 다른 기기 창에는 테스트 동작이 표시되지 않는다.

`result.xcresult`는 Xcode에서 열어 단계별 로그와 첨부 화면을 볼 수 있다. `run.log`와 프로세스 종료 코드가 성공 여부의 기준이다. 화면이 보이거나 API 단독 요청이 성공한 것만으로 UI 시나리오 통과로 간주하지 않는다.
