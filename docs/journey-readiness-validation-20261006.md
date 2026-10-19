# 주요 안정성 항목 개발·검증 기록

기준 2026-10-06 Asia/Seoul. 전체 내비게이션 완성/전체 접근성 합격/실기기 합격 문서가 아니다. 운영 default-off 유지.

후속 변경: 사용자가 기존 개발·운영 Firebase 시험 사용을 승인했다. 초기 환경 불일치와 [Sandbox UPDATE 재검증](journey-apns-sandbox-validation-20261006.md) 이후 [위치 만료·실제 END 검증](journey-apns-end-validation-20261006.md)에서 온라인 stale 제거·회복·앱 미실행 END 수신·재시작 미재생성을 확인했다. 최신 [종료 기록 자동 정리 검증](journey-checkpoint-reconciliation-validation-20261006.md)에서 동일 인증 세대 terminal 정리·조회 장애 보존/회복을 통과했다. 오프라인 fallback·운영 영속 소유권·새 로그인 세대/ACTIVE TTL은 남아 있다. 아래 설정 누락 결과는 이전 시점의 negative 검사 기록이다.

## 구현

- 종료 intent를 token/coordinate-free 별도 AsyncStorage outbox에 보존한다. 최대 8개/32KiB, 직렬 처리, 동일 binding 중복 제거, 유효한 identity-fenced 서버 stop receipt 이후에만 제거한다.
- 인증 source가 메모리에 없는 cold stop도 native를 먼저 정리한 뒤 intent를 보존한다. 같은 origin/member/login generation의 인증이 돌아오면 mount/foreground/명시적 재시도/새 준비 preflight에서 재전송한다.
- 저장 실패 시 원 binding을 보존한다. unreadable binding은 원격 종료 성공으로 표시하지 않는다. 해결되지 않은 binding/종료 큐를 새 준비로 덮어쓰거나 복구하지 않는다.
- prepare 실패 뒤 원격 cleanup도 best-effort 단발 전송 대신 같은 종료 큐를 이용한다.
- native STOPPED/EXPIRED event가 현재 세션과 일치하면 동일 종료 흐름으로 처리한다. JS가 완전히 멈춘 상태의 native-only durable 종료 handoff 또는 서버 ACTIVE TTL worker를 구현한 것은 아니다.
- 상세 타임라인에 검증된 원본 index/kind와 일치하는 전체 노선명을 표시한다. 예정 시간과 현재 행 설명을 AX label로 제공하고 disabled 행도 이름을 노출한다. 전체 이름은 말줄임을 사용하지 않는다.
- 타임라인 Text 고정 lineHeight를 정리하고 일부 배지/clock 고정 높이를 minHeight로 바꿨다. 장식 clock/badge의 글자 상한은 유지하며 전체 정보는 행 AX/본문에 둔다. 밝은 노선색 글자/아이콘은 대비가 큰 검정/흰색을 선택한다.
- `internal/journey-readiness` 읽기 전용 DEBUG 화면과 안전한 loopback 서버 상태 CLI를 추가했다. 미검증/미지원은 성공으로 표시하지 않는다. 상세 runbook은 [실기기 오류·검증 절차](journey-device-validation-runbook.md)에 있다.

## 자동 테스트

- FE 최종 전체 **294 suites / 2,655 tests PASS**: `/private/tmp/nolate-readiness-all-tests-ultimate.log`. TypeScript typecheck PASS: `/private/tmp/nolate-readiness-typecheck-ultimate.log`. 새 UI 테스트의 mock host 문자열 타입 오류를 수정한 뒤 다시 실행한 최종 결과다.
- Swift 기존 순수 정책 **263 tests PASS**: `/private/tmp/nolate-readiness-swift-tests.log`.
- BE 자동 길안내 **9 suites / 50 tests PASS**, `--rerun-tasks` 실행: `/private/tmp/nolate-readiness-be-rerun.log`. 실제 DB/교통 공급자/APNs 연결 성공이 아니다.
- 상태 CLI **3 tests PASS**: `/private/tmp/nolate-readiness-cli-tests.log`.
- APNs 설정 누락 negative 실행은 **예상대로 실패/외부 전송 차단**: `/private/tmp/nolate-readiness-apns-config-negative.log`. `Test Firebase credentials configuration is missing.`이며 실제 전달 성공 시험이 아니다.
- 변경 runtime/진단/새 UI 테스트 lint 오류 0: `/private/tmp/nolate-readiness-lint-terminal.log`. 전체 변경 UI 대상 lint는 오류 0/inline-style 경고 19개: `/private/tmp/nolate-readiness-lint.log`. 모든 앱 lint가 경고 없이 통과했다는 뜻은 아니다.

## 독립 시뮬레이터 E2E

`NoLate Journey P0 Isolated 20261004` iOS 26.5, `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, detached `deviceWindow-AppWindow-8`을 사용했다. Computer Use 스킬에 따라 이름·window ID·`Show in Device Hub`를 확인했다. Device Hub 관리 패널 embedded 화면·실기기·다른 시뮬레이터는 조작하지 않았다.

합성 JWT/test-source 서버/오프라인 지도와 CoreSimulator GPS replay 시험이다. UI의 준비는 출발이 아니며 출발/단계 전환을 강제하는 버튼이나 bridge 위치 주입은 없다.

1. 3구간 GPS 이동 → ACTIVE/출발 1회/ACKNOWLEDGED, 서버 departure/activation 1회.
2. 앱 process 재시작 → 복구하지 않고 종료 → native IDLE, 종료 큐 1건/RETRY_WAIT, 서버 ACTIVE 유지. 원격 종료 실패를 성공으로 숨기지 않았다.
3. 다시 process 재시작 → 동일 합성 인증 연결 → **별도 단계 전환 없이** 종료 큐 자동 재전송, 서버 STOPPED/큐 0건. 중간 fixture reset으로 잔류를 감추지 않았다.
4. 읽기 전용 진단 화면 mount/새로고침. 서버 요청 카운터 18 유지, server STOPPED 유지. 미발급/UNVERIFIED APNs와 UNSUPPORTED 승차 후 기능을 구분한다.
5. 긴 노선명/밝은 노선색의 두 번째 세션에서 GPS ACTIVE, 상세의 현재 도보 행·도보 약 60m·전체 긴 노선명 AX label과 예정 시각을 확인했다.
6. 최대 글자에서 주요 안내의 재배치를 확인했다. 그러나 coordinate drag/scroll이 `noWindowsAvailable` 또는 AX root unknown으로 실패했다. 전체 타임라인/전체 범례를 끝까지 스크롤해 시각적으로 읽는 검증은 **미완료**다. AX 조회/버튼 조작 성공을 스크롤 성공으로 대체하지 않는다.
7. 잠금 중 로컬 Activity에서 stale 상태 후 GPS monitor 갱신으로 현재 화살표/도보 약 60m/합성 버스 도착 1분을 확인했다. **원격 APNs 수신 증거가 아니다.**
8. 두 번째 세션은 10분 만료 후 native EXPIRED/server ACTIVE 잔류를 발견했다. 명시적 stop으로 server STOPPED를 확인한 뒤 terminal-event 종료 흐름을 추가했다. 세 번째 세션은 02:24:40(KST)부터 실제 10분을 기다렸다. 시계/phase 주입 없이 GPS 출발 후 **종료 버튼을 누르지 않고** 02:35:03에 native EXPIRED·출발 1회·동기화 IDLE·종료 큐 0건·오류 없음과 server STOPPED를 확인했다. JS가 실행되는 foreground 조건의 만료 cleanup 증거다.
9. 최종 카운터 prepare/departure/activation 각각 3, authenticated requests 179, validation 126, arrival 22, refresh 2, trap 0/authorization false, 실제 push provider OFF/accepted 0. 상태 CLI `--expect-stopped`가 ACTIVE에서 exit 1, 최종 STOPPED에서 exit 0으로 동작했다.

증거: [캡처 폴더](evidence/journey-readiness-20261006). `01` cold stop pending, `02` 다음 재시작 뒤 queue clear, `03` 진단 화면, `04` 표준 상세 GPS, `05` 최대 글자 설정의 로컬 잠금 GPS, `06` 만료 재검증 시작 상태, `07` 버튼 없는 만료 cleanup 완료.

## 아직 열린 주요 게이트

| 항목 | 이번 상태 | 남은 작업 |
| --- | --- | --- |
| 전체 접근성 | 상세 전체 이름/현재 행 AX·레이아웃 정책 보완 | 최대 글자 전체 스크롤, 실제 VoiceOver 낭독·초점, dark 전체 화면/잠금 AX |
| 실제 APNs | 설정 누락 차단·기존 pilot 회귀 시험 | 사용자 지정 개발 Firebase/인증/설치 allowlist, 실제 UPDATE/END 수신·토큰 rotation |
| 재시작 종료 | cold intent 보존/재시작 재전송 E2E | native-only handoff, JS 중단/새 로그인 generation/서버 ACTIVE TTL reconciliation |
| 실제 일정/지도/공급자 | 기존 상세 컴포넌트 합성 시험 | 실제 본인 개발 계정/저장 일정/타일/공급자 E2E |
| 승차·하차·환승·도착 | 아직 미지원, 진단에 명시 | 차량/방면/정류장 occurrence 증거 기반 판정, 완주 replay·현장 확인 |
| 음성/무음 알림 | 진단 probe와 기능 연결을 구분 | 실제 이벤트 중복/우선순위/TTS 큐·일반 알림 연결·청취/무음/이어폰 |
| 이탈·장시간·배터리 | runbook 재현 기준 마련 | reroute revision 폐기·현장 배터리/열·30~60분 완주 |
| 긴 경로 제한 | 기존 32구간 회귀 자동 검사 포함 | 이번 turn 32구간 UI 재주행은 하지 않음; 잠금 metadata fallback/매우 작은 구간 제한 유지 |

실제 APNs는 개발 프로젝트/인증 파일 경로를 요청한 상태다. VoiceOver는 시험 시뮬레이터 설정을 켜기 위한 action-time 허용을 요청한 상태이며 아직 켜지 않았다. 실기기는 추후 별도 범위 확정 후에만 시험한다.

시험 앱/위젯 native 바이너리는 이전 빌드를 재사용했다. 이번에는 Swift/Info.plist/Podfile/Xcode 프로젝트·.env·실기기를 변경하지 않았다. 기존 미커밋 작업은 보존하고 커밋/푸시는 하지 않았다. 최종 server STOPPED/queue 0 확인 이후 GPS clear·font large 복원을 완료하고, 이번 Metro/loopback 서버만 종료했다. 다른 실행 중인 서버/시뮬레이터는 종료하지 않았다.
