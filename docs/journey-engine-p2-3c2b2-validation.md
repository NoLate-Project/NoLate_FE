# P2-3c2b2 긴 경로·확대 글자·표시 대비 검증

검증 세션: 2026-10-05~06 (Asia/Seoul). 32구간 GPS 상세/축소/로컬 잠금 표시와 안내 카드 글자 재배치를 검증했다. **전체 페이지 접근성 또는 P2 전체 완료가 아니다.** 운영 기본 OFF 유지.

## 구현 범위

- 경로 바 범례의 2줄 제한을 제거하고 전체 노선명·원본 구간 번호·예정 시간을 접근성 설명으로 제공했다.
- 축소 요약을 스크롤 가능하게 만들고 글자 배율에 따라 최소 높이를 늘렸다. GPS 안내는 상세 펼치기 버튼 바깥에 배치해 별도 접근성 요소로 노출한다.
- 안내 카드와 헤더의 고정 줄 높이를 정리했다. 글자 배율 변경 시 표시 subtree만 다시 측정한다. 엔진 관측 hook·세션·GPS 판정은 재시작하지 않는다. 헤더는 시각적 말줄임을 유지하되 전체 제목을 접근성 설명으로 제공한다.
- 안내 행동 문구의 light/dark 대비를 보완하고 밝은 노선색에 경로 바 외곽선을 추가했다. Live Activity의 이동수단 아이콘은 원본 HEX 색상의 상대 휘도로 검정/흰색을 선택한다. 노선색 자체는 바꾸지 않는다.
- Live Activity 주요 문구에 semantic font와 전체 접근성 label을 적용했다. 카드 크기 제약 때문에 Dynamic Type 상한은 `xxxLarge`이며 최대 accessibility 글자까지 무제한 확장하는 구현은 아니다.
- test-source loopback harness에 `long-name`, `32-legs` 합성 저장 경로를 추가했다. 32구간 후속 좌표는 연결돼 있지만 정류장/차량/방면/탑승 증거는 추가하지 않았다. 실제 공급자 연결이나 후속 구간 판정 지원 확대가 아니다. QA 요청 크기만 64KiB로 늘렸고 운영 입력 제한은 변경하지 않았다.
- QA 상세의 총 소요시간은 저장 경로 원본을 사용한다. 32구간 합성 경로는 38분이며 기존 3구간은 9분이다.

## 자동 검증

- FE 전체: **290 suites / 2,629 tests PASS**, `/private/tmp/nolate-c2b2-fe-final-pass.log`.
- Swift 순수 정책: **263 tests PASS**, `/private/tmp/nolate-c2b2-swift.log`.
- BE journey 관련: **9 suites / 50 tests PASS**, `/private/tmp/nolate-c2b2-be-final.log` 및 Gradle XML reports.
- TypeScript typecheck PASS, `/private/tmp/nolate-c2b2-typecheck-final.log`.
- 변경 파일 lint: 오류 0, 기존 QuickSummary inline-style 경고 2개. `/private/tmp/nolate-c2b2-lint-last.log`.
- 실제 pod install 및 앱/Live Activity 확장 빌드 PASS, `/private/tmp/nolate-c2b2-build-final.log`.
- 전체 긴 노선명/32개 순서, 안내의 Pressable ancestor 분리, fontScale 변경 시 표시 재측정, light/dark 행동 문구 대비 4.5 이상, 216개 RGB 표본의 아이콘 대비 4.5 이상, 합성 경로의 연결성과 증거 부재를 검사했다.

초기 새 테스트의 mock import 문제와 font hook spy 대상 문제를 수정했다. 최종 전체 결과는 수정 후 실행이다. 대비 시험은 안내 문구와 native 이동수단 아이콘 정책의 검사이지 앱 전체 색상 감사가 아니다.

## 독립 시뮬레이터 GPS E2E

대상: `NoLate Journey P0 Isolated 20261004`, iOS 26.5, `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`.
Computer Use skill의 대상 확인 절차를 적용해 이름·독립 window ID·`Show in Device Hub`를 확인하고 detached phone window를 조작했다. 관리 패널의 embedded phone controls는 사용하지 않았다. Xcode 27의 창 소유 프로세스 이름이 Device Hub라는 점과 독립 기기 창 조작은 구분한다.

합성 JWT 서버와 CoreSimulator GPS replay를 사용했다. phase 강제 변경이나 bridge 위치 주입은 없었다. 실제 로그인·공급자·지도 타일·원격 APNs 시험은 아니다.

1. 최초 32구간 fixture가 연결성 검사에서 차단됐다. 검증 조건을 완화하지 않고 fixture 좌표 연결만 수정했다. 후속 구간 탑승 증거는 여전히 없다.
2. 수정한 32구간에서 ARMED·출발 0회 → GPS 이동으로 ACTIVE·출발 1회를 확인했다. 상세의 도보 약 60m와 현재 행, 축소 경로 바, 지도 GPS 점이 같은 관측을 사용했다.
3. 32구간은 기존 2,200-byte 정적 metadata budget에 의해 노선 표시 필드를 함께 제거한다. 상세와 잠금 화면 모두 동일 폭/이동수단명 fallback을 사용하고 원본 32구간 순서는 유지했다. 짧은 경로의 2:5:2 시간 비례와 혼동하지 않는다.
4. 최대 `accessibility-extra-extra-extra-large`에서 안내 카드 주요 문구 재배치와 축소 요약의 현재 안내를 확인했다. 최초 실시간 font 변경의 높이 캐시/잘림을 발견해 표시 subtree 재측정을 추가하고 수정 번들로 재검증했다.
5. 로컬 잠금 Activity에서 32구간 바와 도보 GPS 위치 화살표·도보 약 60m를 확인했다. GPS 만료 후에는 화살표·정밀 거리 대신 위치 확인 중을 표시한다.
6. 3구간 긴 노선명/밝은 `#FFF5A0` fixture에서 전체 노선명 AX 설명과 표준 글자 범례의 줄바꿈, 2:5:2 비례 바를 확인했다. 실행 중 최대 글자 변경 후에도 안내 제목·거리·바는 재배치됐다. GPS 접근+dwell로 버스 대기와 첫 도보 끝 경계 마커가 로컬 잠금 화면에 표시됐다.
7. 최종 두 세션의 서버 departure/activation은 각각 2회, trap 0회, 실제 push provider OFF였다. 종료 후 앱과 서버 STOPPED·오류 없음·안내 카드 제거를 확인했다. 중간 번들 재시작 전에 수행한 첫 32구간 시험은 별도 fixture reset 전 결과다.

증거: [스크린샷 폴더](evidence/journey-p2-3c2b2-20261005).

| 파일 | 관측 |
| --- | --- |
| `01-32-maxfont-prepare-state.jpeg` | 불완전한 초기 fixture 차단 기록, 성공 증거 아님 |
| `02-32-maxfont-route.jpeg` | 32구간 표준 크기 표시. 이름과 달리 최대 글자 적용 전 캡처 |
| `03-32-maxfont-expanded.jpeg` | 수정 전 실시간 글자 변경 잘림, 실패 기록 |
| `04-32-maxfont-remeasured-detail.jpeg` | 수정 후 최대 글자 안내 제목·도보 거리·32구간 바 |
| `06-32-maxfont-compact.jpeg` | 최대 글자 축소 요약의 바·현재 안내와 별도 AX 요소 |
| `08-32-maxfont-local-lock.jpeg` | 32구간 로컬 잠금 stale 표시 |
| `09-32-maxfont-local-lock-gps.jpeg` | 잠금 중 GPS 갱신 이후 도보 거리·위치 화살표 |
| `10-long-name-standard-detail.jpeg` | 표준 크기 전체 긴 노선명 줄바꿈·밝은 색·TIME 비례 |
| `11-long-name-maxfont-live-change.jpeg` | 실행 중 최대 글자 변경 후 안내 문구 재배치 |
| `13-long-name-maxfont-full-legend.jpeg` | 이름과 달리 기존 타임라인 스크롤 관측. 아래 잔여 잘림 기록 |
| `17-long-name-local-lock-waiting.jpeg` | 긴 노선명/밝은 색 로컬 잠금 대기·첫 도보 끝 경계 |
| `18-final-stopped.jpeg` | 최종 STOPPED·오류 없음·카드 제거 |

## 남은 게이트와 정리

- VoiceOver 실제 낭독/초점 이동은 실행하지 않았다. AX 전체 이름 노출을 낭독 성공으로 간주하지 않는다. 잠금 Widget의 AX 내용도 이번 도구에서 충분히 노출되지 않았다.
- 기존 상세 타임라인의 노선명 축약, 일부 예정 시간/보조 문구 잘림과 최대 글자 재측정은 남아 있다. 오프라인 QA 지도 제목도 커진 헤더와 겹친다. 전체 페이지 접근성 PASS가 아니다.
- 최대 글자에서 긴 범례의 전체 길이를 스크롤하며 시각적으로 읽는 게이트는 미완료다. 표준 크기의 전체 줄바꿈 및 최대 크기 AX 전체 문구/렌더링 정책 검증과 구분한다. 32구간 바는 잠금 공간에서 개별 구간이 작으므로 클릭 대상/개별 안내 UI로 쓰지 않는다.
- 번들 재시작 후 기존 세션의 인증 source가 없는 상태에서 종료 요청이 `AUTOMATIC_AUTH_REQUIRED`로 실패했고, native는 IDLE이지만 서버 ACTIVE가 남는 경우를 관측했다. 해당 합성 fixture만 명시적으로 reset하고 재시험했다. 이후 정상 연결 세션은 서버 STOPPED까지 확인했다. 화면 밖 credential/종료 handoff는 **P2-3d의 재현·수정 게이트**이며 해결 완료로 처리하지 않는다.
- 실제 APNs 전달은 개발 Firebase 설정 미지정으로 미검증이다. 실제 버스 탑승/하차·한 정류장 전·환승·최종 도착·음성 안내도 후속 엔진 단계다. 현재 지원은 첫 도보·승차 접근/대기다.

시험용 Info.plist opt-in/background, Podfile.lock, Xcode 프로젝트는 작업 시작 시점 전체 내용과 정확히 일치하도록 복원하고 plist 검사에 통과했다. Pods/Manifest.lock은 위조하지 않았다. GPS replay 중지/clear·폰트 `large` 복원·세션 종료·fixture 초기화 후 이번 Metro와 loopback harness만 종료했다. 중복/이름이 부정확한 중간 캡처 5개는 `/private/tmp/nolate-c2b2-redundant-evidence.4KoSCp`로 옮겨 저장소에서 정리했다(복구 가능). .env·실기기·다른 시뮬레이터 작업과 기존 미커밋 작업은 보존했다. 커밋/푸시는 하지 않았다.

다음은 **P2-3c2b3: 기존 상세 타임라인 확대 글자/전체 노선명·VoiceOver 및 전체 범례 스크롤 검증**이다. 그 뒤 P2-3d의 cold credential/종료 handoff·기기 소유권·실제 본인 일정 연결을 진행한다. APNs 개발 환경 연결은 별도 게이트로 유지한다.
