# P2-3c1 전체 경로 바와 현재 위치 표시

검증일: 2026-10-05 (Asia/Seoul). DEBUG·독립 iOS 시뮬레이터 전용. 운영 기본 OFF 유지.

## 요구사항과 이번 범위

사용자가 제공한 화면 예시의 핵심은 전체 경로 바 위에서 **현재 구간 안의 내 위치가 이동**하는 것이다.
첫 도보 퍼센트 카드만을 최종 UI로 취급하지 않는다. 제공된 개인 스크린샷은 저장소에 복사하지 않았다.

이번 slice는 기존 엔진이 증명할 수 있는 첫 도보·승차 정류장 접근/대기까지만 연결한다.
버스·지하철 이동, 승하차 확정, 환승·최종 도착, 음성 안내 완성을 의미하지 않는다.

- 상세 카드와 **축소 상세 경로 바**, 잠금 Live Activity 및 확장 Dynamic Island에 전체 원본 구간을 표시한다.
- 지도 위치는 기존 native의 신선한 수용 GPS를 사용하고, 바 위치는 같은 observation의 경로상 도보 진행률에서 파생한다.
- 전체 구간 폭은 동일하다. 시간·거리 비례 진행률이 아니며 표시/접근성 문구에 이를 명시한다.
- 61% 도보라면 첫 도보 구간 안의 61% 지점이다. 3개 구간 경로에서는 전체 바 약 20.3% 위치이며 전체 여정 61%가 아니다.
- 정류장 대기는 첫 도보 끝/버스 시작 경계에 표시한다. `activeLegIndex = 1`을 버스 구간 내부의 도보 100%로 오해하지 않는다.
- 불확실·만료·탑승 후보·binding 불일치는 정밀 마커를 숨기며 전체 경로는 유지한다. 타이머는 만료만 처리한다.
- 32개 원본 구간까지 유지하고 같은 종류의 인접 구간도 병합하지 않는다. 긴 경로의 가독성/스크롤과 실제 노선색은 후속 작업이다.

## 계약과 안전성

`NoLateGuidanceRoutePositionPolicy`와 `presentSavedJourneyRoutePosition`이 동일한 첫 도보/대기 경계 규칙을 적용한다.
`SavedJourneyRouteBar`는 변경된 두 상세 화면에서 공유한다. 마운트·언마운트는 위치 추적을 시작/종료하지 않는다.

Activity의 정적인 attributes에 검증된 구간 index/kind만 추가했다. GPS·주소·인증정보를 추가하지 않았다.
기존 attributes가 구간 없이 들어오면 빈 배열로 decode하며 위치를 만들어내지 않는다.
APNs content-state v1은 그대로이므로 기존 UPDATE 파일럿과 호환된다. 원격 시험 모드의 local update 금지도 유지했다.
이번 E2E는 로컬 모드이며 provider 호출과 실제 APNs 전달 검증을 수행하지 않았다.

## 자동 테스트

- FE: **287 suites / 2,593 tests PASS** (`/private/tmp/nolate-p23c-fe-all-final.log`).
- Swift 순수 정책: **251 tests PASS** (`/private/tmp/nolate-p23c-swift.log`).
- TypeScript typecheck PASS (`/private/tmp/nolate-p23c-typecheck-final.log`).
- 신규/변경 journey 파일 lint 오류/경고 0. 기존 상세 파일의 inline-style 경고 4개는 기존 코드이며 이번에 증가시키지 않았다.
- GPS replay/config: **15 tests PASS** (`/private/tmp/nolate-p23c-config-tests-final.log`).
- 네이티브 앱 및 확장 빌드 PASS (`/private/tmp/nolate-p23c-build-final.log`).
- 새 정책 테스트: 구간 내부 0/25/60/100%, 대기 경계, 시간만 경과 시 위치 불변, stale/future/잘못된 index/후보/가짜 RIDING 차단, 32개 구간 보존.
- UI 테스트: bridge GPS 진행값 변경 시 마커 이동, stale/후보 시 숨김, compact/expanded 같은 위치, 구독 해제.

BE 기능은 이번 slice에서 수정하지 않았다. 실제 앱·확장 Swift 컴파일과 합성 인증 harness를 통해 통합을 검증했다.

## 독립 시뮬레이터 E2E

대상: `NoLate Journey P0 Isolated 20261004`, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`, iOS 26.5.
Device Hub 관리 패널이 아니라 detached phone window `deviceWindow-AppWindow-1`만 조작했다.
다른 시뮬레이터로 포커스가 이동하면 identity guard가 동작을 차단했고 Window 메뉴에서 시험 창만 재선택했다.

서버는 test-source 인증 issuer/합성 저장 경로 9001/회원 7의 loopback harness이다.
GPS는 replay 스크립트가 CoreSimulator 위치만 변경한다. phase setter나 bridge 위치 주입은 사용하지 않았다.

1. ARMED에서 전체 경로는 보이지만 마커/Activity는 없고 출발 0회.
2. 합성 GPS 이동으로 ACTIVE·출발 1회·ACK. 첫 도보 구간 내부 61%의 마커를 확인.
3. 실제 `ScheduleDetail` 컴포넌트에 합성 previewItem을 공급하여 축소 경로 바와 오프라인 지도 점을 동시 확인.
4. 잠금 화면에서 동일한 61% 마커와 전체 `도보 → 버스 → 도보` 경로를 확인.
5. 잠금 상태 GPS 이동과 dwell로 승차 정류장까지 이동. 경계 마커/대기 문구가 나타나며 탑승 미확정 유지.
6. GPS 입력 중단 시 마커 숨김, 전체 경로 유지. fresh GPS 재수신으로 회복 확인.

E2E 증거: [스크린샷 폴더](evidence/journey-p2-3c1-20261005).

- `08-final-first-walk-position.png`: 첫 도보 61%, 자동 출발 1회 ACK.
- `09-final-compact-map-and-bar.png`: 지도 점과 축소 경로 바의 같은 관측 위치.
- `10-final-lock-walk-position.png`: 잠금 화면 첫 도보 61%, 잘림 없는 수정 레이아웃.
- `12-final-lock-waiting.png`: 잠금 중 승차 지점 경계/대기, 탑승 미확정.
- `11-final-lock-stale-marker-hidden.png`: 최종 빌드에서 위치 만료 시 마커 숨김/경로 유지.
- 앞선 진단 스크린샷도 보존한다. 첫 잠금 레이아웃의 도착정보 잘림을 발견하여 수정 후 다시 빌드·검증했다.

실제 사용자 로그인/운영 저장 일정/실제 지도 타일/실제 운행 정확도를 검증한 것이 아니다.
Dynamic Island 확장 영역은 컴파일 확인만 했으며 별도 화면 E2E는 남아 있다.
기존 개발 환경의 Keychain/Expo 모듈 symlink 경고가 있어 실계정 인증·알림 품질 검증으로 승격하지 않는다.

## 시험 정리

검증 후 시험용 Info.plist 위치/background·인증 opt-in과 CocoaPods 생성 Xcode 프로젝트의 임시 변경을 복원했다.
Pods/Manifest.lock을 원본처럼 가장하지 않았으며 다음 네이티브 빌드에서도 실제 `pod install`이 필요하다.
시험 위치 입력과 fixture 서버를 정리하고 소스·증거·기존 미커밋 작업은 보존한다. 커밋/푸시는 수행하지 않는다.

## 다음 단계

P2-3c2: 실제 상세 타임라인 행에도 같은 구간 강조/위치 배지를 붙이고, 검증된 노선명·노선색·표시 폭을 연결한다.
그 다음 P2 후속 승하차 판정에서 버스 구간 내부 위치·잔여 정류장·하차 준비 안내를 확장한다.
지하철/환승의 터널 불확실성 처리는 P3에서 검증한다.
잠금 중 credential 갱신·durable 소유권·실제 APNs 개발 환경 전송은 별도 P2-3d 게이트로 남긴다.
