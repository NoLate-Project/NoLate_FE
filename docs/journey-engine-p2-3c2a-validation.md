# P2-3c2a 상세 화면 단계·거리·현재 구간 표시

검증일: 2026-10-05. 이 slice의 자동 테스트·독립 GPS E2E 통과. DEBUG·독립 iOS 시뮬레이터 시험. 운영 기본 OFF 유지.

## 구현 범위

- 상세 안내 카드와 축소 상세 경로 바를 퍼센트 대신 단계·승차 지점·잔여 도보 거리 중심으로 변경했다.
- 실제 경로 상세 타임라인의 현재 행에 파란 강조와 ‘현재 위치’ 배지를 추가했다.
- 지도에서 사용자가 선택한 행과 엔진이 판단한 현재 행을 구분한다. 사용자의 지도 선택은 진행 상태를 바꾸지 않는다.
- 신선한 첫 도보 관측에서 ‘합성 정류장 1까지 · 도보 약 60m’, 검증된 dwell 대기에서는 ‘합성 정류장 1 · 버스 대기 · 도착하면 탑승 준비’를 사용한다.
- 위치 만료·불확실·binding 불일치·미지원 단계에서는 정밀 거리/현재 행/위치 마커를 숨긴다.

네이티브가 Activity attributes와 같은 검증된 정적 route metadata를 read-only bridge로 전달한다.
session/schedule/generation/revision/digest와 모든 원본 leg index/kind가 일치할 때만 소비한다.
첫 도보 geometry 길이와 같은 GPS의 경로상 진행값으로 남은 거리를 계산하며 10m 단위로 올림한다.
시계 경과나 지도 선택으로 거리를 줄이지 않는다. 첫 승차 정류장명은 원본 입력의 첫 버스 정류장명과도 일치해야 한다.
좌표/인증정보를 정적 metadata에 추가하지 않았으며 APNs content-state v1은 변경하지 않았다.

타임라인 강조는 표시용 원본 이동 구간이 입력과 동일한 순서·종류·`leg-index` ID일 때만 적용한다.
이름 유사도/수동 선택으로 현재 행을 추측하지 않는다. 자동 안내 binding이 활성화된 목록은 기존 별도 도착 조회를 끄고 안내 엔진의 검증된 정보와 충돌하지 않게 한다.
컴포넌트 마운트/언마운트가 tracking·HTTP·단계 전환을 시작하지 않는다. 늦은 초기 snapshot이 종료 이벤트를 되살리지 않도록 차단한다.

## 자동 검증

- FE 전체 **288 suites / 2,611 tests PASS**: `/private/tmp/nolate-p23c2-fe-final.log`.
- 단계/위치/안내/UI/상세 정보 계층 집중 **5 suites / 80 tests PASS**: `/private/tmp/nolate-p23c2-focused-final.log`.
- Swift 정책 **258 tests PASS**: `/private/tmp/nolate-p23c2-swift.log`.
- TypeScript typecheck PASS: `/private/tmp/nolate-p23c2-typecheck-final.log`.
- 신규 journey 파일 lint 오류/경고 0. 변경 타임라인 관련 lint 오류 0, 기존 inline-style 경고 10개.
- 앱·Live Activity 확장 네이티브 빌드 PASS: `/private/tmp/nolate-p23c2-build-retry.log`.

첫 회귀 실행은 기존 달력 테스트 시간 초과와 컴포넌트 이름을 직접 검사하던 정보 계층 테스트 실패였다.
정보 계층 계약은 wrapper가 원본 타임라인을 유지함을 검사하도록 수정했다. 달력 코드는 수정하지 않았다.
달력 단독 재실행 76개, 최종 전체 재실행 2,611개가 통과했다. 첫 실패를 삭제하거나 timeout을 완화하지 않았다.
Xcode가 일시적으로 특정 simulator destination을 찾지 못해 첫 빌드 시도는 실패했다. 대상이 재노출된 후 실제 pod install과 네이티브 빌드를 다시 수행해 통과했다.

## 독립 시뮬레이터 E2E

대상: `NoLate Journey P0 Isolated 20261004`, iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`.
새 빌드를 설치하고 detached phone window에서만 앱 내부를 조작했다. 창 선택/분리 외에 관리 패널의 phone controls는 사용하지 않았다.
서버는 loopback test-source 합성 인증 harness이고 GPS replay는 CoreSimulator 위치만 변경한다. 엔진 phase/bridge 위치를 강제 주입하지 않았다.

확인한 내용:

1. 준비 후 ARMED·출발 감지 0회.
2. 합성 GPS 이동 후 ACTIVE·출발 감지 1회·ACKNOWLEDGED.
3. 실제 ScheduleDetail preview 진입 후 ‘합성 정류장 1까지 · 도보 약 60m’, 첫 도보 행의 파란 현재 위치 강조, 같은 fresh 지도 좌표 확인.
4. 버스 행을 직접 선택해 지도는 선택 경로를 표시하지만 실제 현재 도보 행은 유지됨을 확인. 수동 선택과 현재 행은 별도이다.
5. 축소 상세에서 ‘도보 약 60m’와 첫 구간 안의 위치 화살표, 지도 GPS 점 동시 확인.
6. 잠금 중 GPS 이동 + dwell 이후 로컬 Live Activity에 ‘합성 정류장 1 · 버스 대기 · 도착하면 탑승 준비’, 첫 도보 끝/버스 시작 경계 화살표 확인.
7. 잠금 해제 후 현재 위치 강조가 첫 도보에서 버스 대기 행으로 옮겨지고 도보 강조가 사라짐을 확인. 축소 요약도 동일 대기 문구와 경계 마커를 표시.
8. GPS replay 종료/위치 clear 후 15초 관측 만료에서 지도 점/바 마커/현재 행 강조/잔여 거리 모두 숨김. 사용자가 선택한 버스 행은 선택 상태만 유지하며 현재 행으로 오인하지 않음.
9. 위치 안내 종료 후 STOPPED·오류 없음, 상세 안내 카드 제거, 서버 STOPPED 확인.

독립 창이 다른 시뮬레이터 작업으로 전환/닫혀 identity guard가 추가 조작을 차단한 시도가 있었다.
대상 창을 재분리하고 매번 이름/독립 창 ID/‘Show in Device Hub’를 검사한 후 해당 phone window만 조작해 검증을 이어갔다.
지연된 첫 세션은 종료하고 새 10분 세션에서 동일 GPS 시험을 다시 수행했다. 출발/활성화는 두 세션 합계 각각 2회, cross-origin trap 0회, 실제 push provider 비활성.
기존 합성 인증 갱신도 1회 발생했다. 실제 로그인 갱신이나 원격 APNs 검증을 뜻하지 않는다.

증거: [스크린샷 폴더](evidence/journey-p2-3c2a-20261005).

- `03-fresh-expanded-walk.png`: 상세 단계/정류장/도보 약 60m.
- `07-fresh-compact-walk-map.png`: 지도 점과 축소 바의 같은 도보 관측.
- `08-walk-current-row-visual.png`: 실제 도보 행 현재 위치 강조. 버스 수동 선택과 분리됨을 AX에서도 확인.
- `09-lock-waiting.png`: 잠금 중 GPS+dwell 후 버스 대기/승차 경계/도착정보.
- `10-waiting-current-bus-row.png`: 도보 강조 제거, 현재 버스 대기 행 강조.
- `11-compact-waiting-boundary.png`: 축소 대기 문구와 경계 마커/지도 점.
- `02-detail-stale-no-current-row.png`: 첫 세션 GPS 관측 만료 시 거리/현재 행/지도 점 숨김.
- `12-final-stale-current-row-hidden.png`: 최종 대기 관측 만료 시 현재 행 강조 제거. 수동 버스 선택은 유지.
- `13-final-stopped.png`: 최종 시험 세션 종료·오류 없음.

초기 캡처는 행이 화면 아래에 있거나 만료되어 시각 강조 성공 증거로 취급하지 않았다.
실제 행이 보이도록 터치 스와이프한 최종 스크린샷을 별도로 기록했다.

## 한계와 다음 단계

첫 도보·승차 지점 접근/대기만 지원한다. 버스 탑승·하차·한 정류장 전 안내·환승·최종 도착·음성 안내 구현 완료가 아니다.
합성 preview와 오프라인 지도를 사용하므로 운영 로그인/실제 지도 타일/실제 운행 정확도 검증이 아니다.
로컬 ActivityKit 시험이며 실제 APNs 전달은 별도 개발 서버 설정 게이트로 남아 있다.
실제 노선명/노선색·시간/거리 비례 구간 폭·긴 경로/큰 글자 시각 검증은 P2-3c2b에서 진행한다.

## 시험 정리

시험용 Info.plist opt-in/background 설정과 실제 pod install로 바뀐 Podfile.lock/Xcode 프로젝트를 작업 시작 시점 전체 내용과 정확히 일치하도록 복원했다. plist 문법 검사와 diff whitespace 검사도 통과했다.
Pods/Manifest.lock은 위조하지 않았으며 다음 빌드도 실제 pod install을 수행해야 한다.
시험 replay 프로세스 종료, 합성 GPS clear, UI의 위치 안내 종료·STOPPED를 확인했다.
시험 fixture 초기화와 loopback 서버/이번 Metro 정리만 수행하며 다른 시뮬레이터 작업은 종료하지 않는다.
.env·실기기·기존 미커밋 작업은 변경하지 않고 커밋/푸시는 수행하지 않는다.
