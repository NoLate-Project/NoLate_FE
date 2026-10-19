# Live Activity 단계 중심 디자인 개선

검증일: 2026-10-05. DEBUG·독립 시뮬레이터·로컬 ActivityKit 시험. 운영 기본 OFF 유지.

## 변경 범위

사용자 요청에 따라 Live Activity의 퍼센트/진단 중심 레이아웃을 단계·지점·다음 행동 중심으로 바꿨다.
제공된 네이버 화면의 색상 경로 바와 현재 위치 화살표라는 구조를 참고하되 SwiftUI로 직접 구성했다.

- 큰 승차 지점명, 이동 수단 아이콘, 잔여 도보 거리/대기 행동, 전체 경로 바, 도착정보 순서.
- 회색 도보/녹색 버스/청색 지하철 구간의 둥근 경로 바와 수단 아이콘 노드, 파란 현재 위치 화살표.
- 퍼센트/‘위치 안내 시험’ 제목은 Live Activity에서 제거. 예: ‘구로역까지 · 도보 약 100m’, ‘구로역 · 버스 대기’.
- 큰 문자열은 한 줄 제한/축소로 대응. 8개 초과 구간은 겹칠 수 있는 수단 노드만 생략하며 원본 구간 바는 유지한다.
- 잠금 화면과 확장 Dynamic Island가 같은 카드/표현 정책을 사용하며 축소 Island도 단계/거리를 사용한다.
- 이번 변경은 Live Activity 중심이다. 기존 React 상세/진단 화면의 퍼센트 문구는 별도 후속 개선이며 이미 변경됐다고 주장하지 않는다.

## 근거와 계약

첫 도보의 검증된 geometry 길이와 같은 fresh GPS의 walkProgress로 잔여 **경로상** 거리를 계산한다.
직선 거리/남은 시간/전체 여정 진행률은 사용하지 않는다. GPS 정밀도를 과장하지 않도록 ‘약’과 10m 단위 올림을 사용한다.
progress=1만으로 도착을 확정하지 않고 ‘승차 지점 근처’로 표시한다. 검증된 dwell 이후 WAITING에서만 버스 대기 문구를 사용한다.

Activity attributes의 정적 구간 메타데이터에 첫 도보 길이와 첫 버스 승차 정류장명을 선택적으로 추가했다.
지점명은 정상 bus shape/정류장 순서/방면/도보 끝 연결이 통과한 입력에서만 추출한다.
새 선택 필드가 없는 이전 attributes는 decode 가능하고 이름·거리 없는 안전한 표현으로 돌아간다.
실시간 좌표·주소·인증정보를 추가하지 않았다. APNs content-state v1과 단일 원격 발행 규칙은 변경하지 않았다.

위치/Activity stale, 불확실, 탑승 후보, 미지원 RIDING이면 거리/마커를 숨기고 ‘위치 확인 중’으로 표시한다.
도착 카운트다운은 fresh 위치와 WAITING_INFORMATION, 미래 expectedAt/유효한 provider timestamp/만료 조건이 모두 성립할 때만 보인다.
버스 탑승 확정·한 정류장 전 하차·‘다음 정류장에서 탑승’은 아직 구현되지 않아 꾸며내지 않는다.
실제 노선색/거리 비례 구간 폭은 후속이며 현재는 이동 수단별 색상/동일 폭이다.

## 자동 검증

- Swift 전체 정책 **257 tests PASS**: `/private/tmp/nolate-guidance-design-swift-final.log`.
- 새 6개 테스트: 남은 거리/반올림/지점명, 대기≠탑승, 이전 메타데이터 호환/잘못된 값, stale/후보 차단, 도착 footer freshness, normalizer의 검증된 geometry/승차 연결.
- 앱·Live Activity 확장 빌드 PASS: `/private/tmp/nolate-guidance-design-build.log`.
- GPS replay **7 tests PASS**: `/private/tmp/nolate-guidance-design-replay-tests.log`.
- React/BE 제품 코드는 이번 디자인 변경에서 수정하지 않았다.

## 독립 시뮬레이터 E2E

대상: `NoLate Journey P0 Isolated 20261004`, iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`.
Computer Use로 detached phone window `deviceWindow-AppWindow-1`을 조작했다. Device Hub 관리 패널/실기기는 조작하지 않았다.
서버는 loopback 합성 인증 harness, GPS는 CoreSimulator 위치 변경이며 엔진 phase/bridge 강제 주입은 사용하지 않는다.

E2E 증거: [스크린샷 폴더](evidence/journey-live-design-20261005).

- `01-lock-walking-distance.png`: 자동 출발 1회/ACK 후, 잠금 화면 ‘합성 정류장 1까지 · 도보 약 60m’, 위치 화살표, 전체 경로, 합성 버스 도착 카운트다운 확인. 잘림 없음.
- `02-lock-stop-waiting.png`: fresh GPS+dwell의 WAITING 확인 후, 잠금 화면 ‘합성 정류장 1 · 버스 대기 · 도착하면 탑승 준비’, 승차 경계 화살표/도착 카운트다운 확인. 탑승 중으로 표시하지 않음.
- `03-lock-stale-hidden.png`: 관측 만료 시 ‘위치 확인 중’, 마커·거리·도착 카운트다운 숨김, 전체 경로 유지 확인. 재수신 이후 동일 세션 WAITING 회복 확인.
- 첫 대기 캡처는 이미 만료된 화면이어서 성공으로 기록하지 않고 stale 증거로 분류했다. 지속 GPS 재수신 후 fresh 대기 화면을 다시 검증했다.
- 합성 서버의 출발/활성화 각각 1회, cross-origin trap 0회, 실제 push provider 비활성. 단계 전환 버튼은 사용하지 않았다.

실제 운행/운영 로그인/실제 APNs 전달을 검증한 결과가 아니다. 확장/축소 Dynamic Island는 컴파일 검증이며 별도 시각 E2E가 남아 있다.
접근성 큰 글자/긴 지점명/32구간의 전체 시각 검증도 남아 있다.

## 정리

시험용 Info.plist opt-in/background 설정과 실제 pod install이 만든 임시 프로젝트/lock 변경은 작업 시작 상태로 복원했다.
세 파일이 작업 시작 시점 전체 내용과 정확히 일치함을 재확인했다. 합성 GPS 입력/위치 추적/Activity를 종료하고 시험 fixture를 초기화했다.
Pods/Manifest.lock을 거짓으로 수정하지 않았으며 이후 네이티브 빌드도 실제 pod install을 사용해야 한다.
기존 미커밋 작업/.env는 보존하고 커밋/푸시는 하지 않는다.
