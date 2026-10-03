# 광고 구독 정책 — 기존 개발 서버 E2E 재개

판정: **새 계정 API E2E PASS / 전체 UI E2E 미완료**.

## 환경과 테스트 계정

- 기존 개발 서버 `http://127.0.0.1:5522`를 사용했다. 임시 서버를 추가로 실행하거나 사용자의 서버를 재시작하지 않았다.
- 실제 회원가입 API의 필수 약관 동의 버전을 조회해 합성 테스트 계정을 생성했다. DB에 직접 회원을 넣지 않았다.
- 회원 ID: 295. 이메일: `ads-e2e-20260926-000056@example.test`.
- 계정 비밀번호·토큰은 저장소에 포함하지 않는다. 로컬 자격 정보는 `/private/tmp/nolate-e2e-live/credentials.json`에 권한 0600으로 보관한다.
- 생성 직후 `curationCompleted=false`, 구독 응답은 `{"plan":"FREE","adsEnabled":false}`였다.

## 실제 HTTP 검증 결과

| 시나리오 | 결과 |
| --- | --- |
| 새 회원가입, 이메일·비밀번호 로그인 | PASS |
| 신규 회원 기본 FREE 정책 조회 | PASS |
| 알림 일정 6개 생성: 과거 FREE 5개 제한 초과 | PASS |
| 각 일정의 notificationEnabled=true, lead=120, interval=10 저장 | PASS |
| 마지막 일정 제목 및 ALARM 모드 수정 | PASS |
| 수정한 일정 재조회 | PASS |
| 121분 리드 입력 거부 | PASS: HTTP 400 / C001 |
| 이번에 생성한 일정 ID 340~345 정리 | PASS |

테스트 일정은 14일 뒤로 설정해 즉시 출발 알림 작업을 유발하지 않도록 했다. 테스트 종료 후 해당 일정만 API로 삭제했다. 새 테스트 계정과 기본 카테고리는 유지한다.

[회원가입 결과](2026-09-26-ads-only-live/signup-result.json), [일정 검증 결과](2026-09-26-ads-only-live/scenario-results.json)

## UI와 광고 검증의 한계

- 기존 계정으로 로그인 후 달력 진입한 화면은 시뮬레이터 스크린샷에서 확인했다. 새 테스트 계정의 UI 로그인/온보딩은 아직 수행하지 못했다.
- Device Hub의 화면 자동화는 `timeoutReached (-10005)`로 실패했다. 사용자가 창을 전면으로 가져오고 암호 저장 팝업을 닫은 뒤에도 동일했다.
- 프로세스 샘플의 메인 스레드는 AppKit 이벤트 대기 상태였다. 이번 타임아웃을 Device Hub 크래시로 단정하지 않는다. 앱 이름·번들 ID·앱 경로를 통한 자동화 연결 실패가 남아 있다.
- 현재 서버는 FREE 계정에도 adsEnabled=false를 반환한다. 코드상 광고 전역 스위치 `MONETIZATION_ADS_ENABLED`가 꺼진 상태에 해당한다. 설정 기본값은 false다.
- 광고 실제 로딩·노출·ATT/UMP, PREMIUM 전환, 실제 결제, APNs 전달은 이번 실행에서 검증하지 않았다.
- 저장소의 SubscriptionController에는 내 정책 조회만 존재한다. 이 테스트에서 DB의 구독 등급이나 서버 전역 광고 설정을 변경하지 않았다.
- 경로 데이터는 테스트 입력이다. 외부 길찾기 제공자의 정확도를 검증한 결과가 아니다.
