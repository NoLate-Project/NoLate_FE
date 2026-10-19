# 대중교통 길안내 v1 — 수동 파일럿

작성: 2026-10-03 · 브랜치: `feature/transit-guidance-v1` (FE/BE 각각)

## 이번에 동작하는 흐름

1. 본인 대중교통 경로가 저장된 일정 상세에서 **길안내 시작**을 누른다.
2. 안내 화면에서 시작을 확인하면 서버가 여정 생성과 출발 처리를 함께 수행한다.
3. 도보 → 승차 대기 → 탑승 → 하차 → 환승 → 최종 도보 → 도착을 버튼으로 확인한다.
4. 서버가 승인한 현재 단계·다음 안내를 화면과 iOS Live Activity에 표시한다.
5. 재진입/앱 전경 복귀 시 서버 상태를 복원하며, 도착 또는 종료 후에는 진행할 수 없다.

이동 경로는 실제 원본 `TransitLegDetail` 구간 배열을 사용한다. UI용으로 축약한 경로의
인덱스와 섞지 않으며 정류장·좌표 필드를 보존한다. 현재 진행률은 **확인한 구간의 비율**이지
측정된 이동 거리 비율이 아니다. 수동 모드는 남은 정거장 수를 추정해 표시하지 않는다.

## 안전 장치

- 서버 승인 전에는 화면 진행 상태를 앞당기지 않는다.
- 시작 UUID, session/generation/routeRevision/sequence로 중복·역행·이전 여정 요청을 차단한다.
- 타임아웃 이후에는 서버를 다시 조회한다. 재조회도 실패하면 진행 버튼을 잠그고 재확인을 요청한다.
- 화면 이탈·로그아웃 시 늦은 응답을 버린다. 인증 만료 후 다른 계정 화면에 이전 상태를 적용하지 않는다.
- 진행 중 경로는 고정한다. 경로 변경, 로그인 세대 변경, 권한 회수, 8시간 만료 시 서버가 종료한다.
- 기존 출발 알림 취소와 여정 종료를 분리한다. 파일럿이 켜진 앱의 뒤늦은 출발 액션은
  로컬 Live Activity/토큰을 직접 종료하지 않고 서버의 여정 검증을 따른다.
- 위치 권한·백그라운드 추적·원시 GPS 전송을 추가하지 않는다.

## 실행 전 준비

기존 체크아웃의 미커밋 위젯 수정과 `.env`를 건드리지 않기 위해 작업 폴더를 분리했다.

```text
/Users/mac/IdeaProjects/NoLate/.worktrees/transit-guidance-v1/NoLate_FE
/Users/mac/IdeaProjects/NoLate/.worktrees/transit-guidance-v1/NoLate_BE
```

1. 서버의 [여정 마이그레이션](../../NoLate_BE/docs/schedule/migrations/2026-10-03-journey-guidance-sessions.sql)을
   검토하고 개발 DB에 적용한다. 이 작업에서는 DB 마이그레이션이나 배포를 실행하지 않았다.
   엔티티가 추가되므로 **기능 OFF 배포에서도 스키마는 필요하다**.
2. 개발 서버에 `JOURNEY_GUIDANCE_ENABLED=true`를 설정한다.
3. FE 빌드 환경에 `EXPO_PUBLIC_JOURNEY_GUIDANCE_ENABLED=true`를 설정한다. 기본값은 OFF다.
   `.env`는 복사·수정·커밋하지 않았다. 기존 API/지도/인증 환경 설정은 개발 환경에서 별도로 준비한다.
4. 네이티브 변경이 있으므로 새 iOS 개발 빌드가 필요하다. 프로젝트의 기존 prebuild/plugin 절차로
   `modules/nolate-live-activity/ios` 소스를 반영한다. 기존 체크아웃의 생성된 `ios` 파일은 수정하지 않았다.
5. 개발 전용 `nolate:///internal/journey-preview`에서는 로그인·서버 없이 가상 경로의 단계 UI를 확인한다.
   이 미리보기는 실제 여정이나 Live Activity를 만들지 않는다.

서버 API와 운영 제약은 [BE 계약](../../NoLate_BE/docs/schedule/journey-guidance-v1.md)을 참고한다.

## Live Activity 제약

- 원격 콘텐츠 revision은 서버만 갱신한다. 이번 파일럿은 로컬 생성 fallback을 추가하지 않았다.
- 새 Activity 원격 시작은 기존 iOS 17.2+ push-to-start 토큰 등록/APNs 구성을 사용한다.
- 출발 전 Activity가 있다면 유지·전환한다. 없어도 등록된 기기의 토큰으로 새로 시작할 수 있다.
- 기기 토큰, ActivityKit 지원 또는 허용 설정이 없으면 앱 안의 수동 안내만 동작한다.
- 서버 승인과 APNs/잠금 화면 반영은 동시에 끝나지 않을 수 있다. OS 전달과 실기기 검증이 필요하다.
- 구형 네이티브 빌드에 플래그만 켜서 배포하지 않는다. 앱 네이티브 업데이트 후 파일럿을 연다.

## 자동 검증 결과

2026-10-03 새 작업 폴더 기준:

- FE 전체 Jest: 260 suites / 1,906 tests 통과
- 전체 TypeScript 검사 통과, 전체 ESLint 오류 0 (기존 경고 있음), 신규 여정 파일 ESLint 경고 0
- Swift 정책 테스트: 27개 통과. 모델·위젯·코디네이터·Intent의 iOS 17.2 simulator SDK 타입 검사 통과
- BE 관련 회귀: 25개 클래스 / 166개 테스트 통과 (신규 여정 28개 포함)
- 두 저장소 `git diff --check` 통과

위 자동 검증 이후 전체 Xcode 빌드와 아래 Simulator UI 검증을 추가로 완료했다.
실제 APNs 전달과 MySQL 마이그레이션 실행은 포함하지 않았다.
새 구현의 커밋·푸시·배포는 아직 수행하지 않았다.

## 독립 Simulator UI E2E — 2026-10-03

Xcode 27에서 새 `NoLate Journey E2E 20261003`(iPhone 17 Pro, iOS 26.5,
UDID `4A6ADD7F-3CA9-4FF8-966F-3CD70952F63E`)의 **분리된 독립 창**을 직접 조작했다.
Device Hub 관리 화면이나 기존 Widget Preview / XCUITest 기기로 대체하지 않았다.
창 식별자는 `deviceWindow-AppWindow-6`이며, Xcode 27에서는 독립 창도
`com.apple.dt.Devices` 프로세스 소유로 표시된다.

### 환경과 범위

- 최신 FE 소스와 Expo native bridge / Live Activity extension을 전체 Debug 빌드했다.
  빌드 exit 0, ad-hoc 서명 검증 및 Simulator Keychain entitlement 확인.
- 전용 Metro `8088`, 실제 Spring/JPA + 메모리 H2 `15542`, 전용 Redis `16542`를 사용했다.
  가상 계정과 일정만 사용하며 운영 데이터·외부 제공자·Firebase/APNs 발송은 비활성화했다.
- FE/BE 길안내 플래그를 모두 켰다. `.env`를 읽거나 복사·수정하지 않았다.
- UI는 `internal/journey-preview`가 아니라 실제 로그인 및 `/schedule/journey` 화면으로 검증했다.
  첫 일정은 캘린더 → 일정 상세 → 길안내 시작 버튼으로 진입했다.
- 격리 node_modules 경로의 Metro lazy-import 오류는 실행 옵션 `EXPO_NO_METRO_LAZY=1`로 해결했다.
  제품 Metro 설정은 변경하지 않았다. Pod 설치가 바꾼 tracked iOS 생성 파일도 검증 후 원복했다.
  테스트 산출물은 Pod 설치 중 갱신된 GoogleDataTransport 10.1.1 / GoogleUtilities 8.1.3을 사용한다.
  저장소 lock의 기존 10.1.0 / 8.1.0은 보존했으며, 정확히 같은 lock으로 만든 배포 빌드 검증은 별도다.

### 통과 항목

- [x] 테스트 계정 로그인, 일정 목록·상세 조회, 길안내 진입 및 명시적 시작.
- [x] 도보 → 271번 버스 대기/탑승/하차 → 도보 환승 → 2호선 대기/탑승/하차 → 최종 도보 → 도착.
- [x] 각 단계의 현재 구간·완료 구간·다음 안내 문구 변경. 도착 시 5/5 완료와 진행/종료 버튼 제거.
- [x] 버스 탑승 상태에서 화면 이탈·재진입 후 같은 상태 복원.
- [x] 환승 중 앱 프로세스 종료·재실행·일정 링크 재진입 후 2/5 환승 상태 복원.
- [x] 두 번째 일정에서 종료 확인창 취소 후 계속 진행 가능.
- [x] 종료 확정 후 진행 버튼 제거, 앱 프로세스 재실행 후 STOPPED 상태 유지.
- [x] 별도 API 계정으로 실제 HTTP 24요청 통과: 전체 단계, 도착/종료, 복원, 중복 멱등,
  잘못된 순서·종료 이후 진행 409, 타회원 404, 미인증·로그아웃 이후 401.

### 관찰 사항과 미검증 항목

- **APNs 원격 생성/갱신/종료와 잠금 화면·Dynamic Island의 여정 표시는 미검증**이다.
  네이티브 빌드 성공이나 앱 내부 UI 통과를 Live Activity 전체 E2E 성공으로 간주하지 않는다.
- GPS 자동 출발·위치 기반 진행·음성·실시간 버스 대기시간·새 안내 푸시는 아직 미구현이다.
- 진행 버튼이 전체 경로 아래에 있어 스크롤이 필요하다. 후속 UX 검토에서는 하단 고정 버튼을 고려한다.
  종료 후에도 “아래 버튼으로 직접 확인” 설명이 남으므로 종료 상태용 문구를 다듬을 여지가 있다.
- 로그인 직후 공유 Keychain 저장 `OSStatus -25299` 경고 1건을 관찰했다.
  앱 로그인 유지·재실행 복원은 통과했지만, 공유 확장 인증 동작은 별도 확인이 필요하다.
- 큰 글자·VoiceOver·다크 모드, 네트워크 응답 유실/오프라인, 버튼 연타 UI,
  권한 회수·일정 삭제·플래그 OFF 및 실제 기기 배터리/백그라운드 검증은 남아 있다.

### 로컬 증빙

- 앱: `/private/tmp/nolate-journey-e2e-20261003/Build/Products/Debug-iphonesimulator/NoLateFE.app`
- 빌드 로그: `/private/tmp/nolate-journey-e2e-20261003-build.log`
- API 재현 harness와 결과: `/private/tmp/nolate-journey-e2e.xEx2LL/`
- 독립 창 스크린샷: `/private/tmp/nolate-journey-e2e-01-detail.png`부터
  `/private/tmp/nolate-journey-e2e-09-arrived-restored.png`까지 단계별 보관.
  임시 경로이므로 장기 보관 전 별도 복사해야 한다.

## 실기기 통합 검증 — 아직 필요

- [ ] 기존 출발 전 Live Activity에서 시작 → 현재 구간·안내 문구 갱신
- [ ] 출발 전 Activity가 없는 상태에서 시작 → 원격 생성
- [ ] 버스 → 도보 환승 → 지하철 → 최종 도보 → 도착 후 종료
- [ ] 탑승/하차 버튼 연타·네트워크 응답 유실·재진입에도 단계 일치
- [ ] 앱 종료/재실행, 잠금 화면 링크, 다크 모드·큰 글자·VoiceOver
- [ ] 로그아웃·일정 삭제·공유 권한 회수·서버 플래그 OFF 후 종료
- [ ] 오래된 출발 알림 액션이 진행 중 여정을 종료하지 않음
- [ ] ActivityKit 비허용·토큰 미등록에서도 앱 진행 가능

## 다음 구현 순서

1. 위 실기기 수동 흐름과 라이프사이클을 검증한다.
2. 전경 위치와 저장 경로 매칭을 추가해 수동 상태 전이를 자동화한다.
3. 백그라운드 권한/배터리/개인정보 고지를 준비하고 자동 출발·음성 안내를 연결한다.
4. 활성 승차·환승 구간에 한해 최신 실시간 도착 정보를 조회하고 중복 없는 안내 푸시를 붙인다.

자동 출발, 위치 기반 정거장 판단, TTS, 실시간 버스 대기시간, 새 환승 푸시, Android 지속 알림은
이번 버전에 포함하지 않는다. 종료된 세션의 재시작 UI와 오프라인 진행 큐도 후속 범위다.
