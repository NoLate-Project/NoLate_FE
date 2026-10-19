# P2-3c2b 검증된 노선 표시·비례 경로 바

검증일: 2026-10-05. 표시 정책과 3구간 DEBUG 독립 시뮬레이터 E2E 검증 완료. 긴 경로 실화면·전체 접근성 검증은 남아 있다. 운영 기본 OFF 유지.

## 구현

- 저장 경로 입력 v1에 optional `display`를 추가했다. 노선명·6자리 HEX 색상·예정 소요시간·구간 거리만 전달하며, 서버가 본인 저장 경로의 원본 값과 대조한다. display 없는 기존 입력도 허용하지만 새 표시 정보를 임의로 붙이지 않는다.
- 이름/색상/숫자 제한과 정규화를 JS·Kotlin·Swift에 적용했다. 원본 구간 순서와 digest/session/generation/revision 검사를 유지한다. 표시 정보가 탑승·방면·정류장 증거로 승격되지는 않는다.
- 모든 구간에 시간이 있으면 TIME, 없으면 모든 구간의 거리가 있을 때 DISTANCE, 둘 다 아니면 EQUAL을 사용한다. 서로 다른 단위를 섞거나 누락값을 추정하지 않는다. 바는 예정 경로의 비율이지 실시간 ETA나 전체 여정 완료율이 아니다.
- 상세 카드·축소 상세·잠금/확장 Live Activity가 같은 native 검증 메타데이터를 소비한다. 위치 화살표는 같은 GPS의 첫 도보 진행값을 새 구간 폭에 투영하며 대기에서는 첫 도보 끝/승차 경계에 머문다. 시간 경과로 움직이지 않는다.
- 최대 32개 원본 구간을 유지한다. Activity의 정적 legs JSON이 2,200 bytes를 넘으면 새 노선 표시 필드를 전 구간에서 함께 제거하고 동일 폭/이동수단명으로 fallback한다. RN도 같은 budgeted 결과를 받아 화면 간 비율이 어긋나지 않게 한다. 실제 최대 원격 APNs payload 검증은 별도 게이트다.
- 상세 범례 줄바꿈과 원본 구간 순서의 접근성 설명을 추가했다. 안내 문구의 글자 확대는 유지하고 장식용 화살표만 확대 상한 1로 설정했다.

## 자동 검증

- FE 전체: **289 suites / 2,625 tests PASS**, `/private/tmp/nolate-c2b-fe-arrow-final.log`.
- Swift 정책: **262 tests PASS**, `/private/tmp/nolate-c2b-swift-final.log`.
- BE journey 관련: **8 suites / 48 tests PASS**, `/private/tmp/nolate-c2b-be-final.log` 및 Gradle XML reports.
- TypeScript typecheck PASS, `/private/tmp/nolate-c2b-typecheck-arrow.log`. 변경 journey 표시 파일 lint 오류/경고 0.
- 실제 pod install 및 앱/Live Activity 확장 빌드 PASS, `/private/tmp/nolate-c2b-build-final.log`.
- TIME 2:5:2, DISTANCE fallback, 혼합/누락 단위 EQUAL, legacy, 필드 변조·알 수 없는 키·중복 키, session fence, 잘못된 topology, 32구간 순서/범례, budget fallback, stale 마커 숨김을 검사했다.

초기 새 테스트에서는 불완전한 binding fixture와 Kotlin deepCopy 호출 타입 오류가 발견되어 테스트 코드를 수정했다. 큰 글자 E2E에서는 화살표 잘림을 발견해 수정하고 새 JS 번들로 재검증했다. 최종 전체 테스트 결과는 수정 이후의 결과다.

## 독립 시뮬레이터 E2E

대상: `NoLate Journey P0 Isolated 20261004`, iOS 26.5, `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`.
Computer Use로 매번 대상 이름·독립 window ID·`Show in Device Hub`를 확인하고 detached phone window만 조작했다. 관리 패널 내부 phone controls는 사용하지 않았다.
합성 인증 loopback harness와 CoreSimulator GPS replay를 사용했다. phase/bridge 위치를 강제 주입하지 않았다. 실제 공급자/로그인/지도 타일 시험이 아니다.

1. 준비 ARMED·출발 감지 0회에서 GPS 이동으로 ACTIVE·출발 감지 1회가 됐다.
2. 실제 상세 컴포넌트에 `합성 버스`와 주황색 원본 색상, 예정 2/5/2분, TIME 폭 2:5:2가 표시됐다. 도보 약 60m의 화살표는 첫 구간 안에 위치했다.
3. 축소 상세에서 동일 비례 바·도보 거리·신선한 지도 GPS 점을 확인했다.
4. 로컬 잠금 Activity에 동일 노선명/색상/비례 기준과 도보 위치를 확인했다. 잠금 중 GPS 이동+dwell 후 버스 대기 문구와 첫 구간 끝 2/9 경계 화살표를 확인했다. 상세의 현재 행도 첫 도보에서 버스 대기 행으로 바뀌었다.
5. `accessibility-extra-large` 설정에서 상세 문구/범례가 줄바꿈됐다. 최초 화살표 잘림을 수정한 새 번들로 도보 GPS 시험을 다시 수행해 아이콘 정상 표시를 확인했다. 기존 상세 상단 제목/오프라인 지도 설명의 잘림은 별도 개선 항목이며 전체 페이지 접근성 PASS로 처리하지 않는다. 잠금 카드의 고정 크기 글자는 유지되므로 완전한 Dynamic Type 지원을 주장하지 않는다.
6. GPS 종료/clear 후 15초 만료에서 현재 마커·거리·현재 행은 숨기고 정적 노선명/색상/비례 정보는 유지했다.
7. 최종 STOPPED·오류 없음·서버 STOPPED·card 제거를 확인했다. 두 시험 세션 합계 departure/activation 각 2회, cross-origin trap 0회, real push provider OFF였다.

증거: [스크린샷 폴더](evidence/journey-p2-3c2b-20261005).

- `01-weighted-expanded-walk.jpeg`: 상세 노선명/예정 시간 비례/도보 거리.
- `02-weighted-compact-walk-map.jpeg`: 축소 비례 바와 지도 GPS 점.
- `03-weighted-lock-walk.jpeg`: 로컬 잠금 Activity의 노선명·색상·GPS 도보 위치.
- `04-large-text-lock.jpeg`: 큰 글자 설정 중 GPS+dwell 이후 잠금 대기 경계.
- `05-large-text-detail-waiting.jpeg`: 큰 글자 범례 줄바꿈과 최초 화살표 잘림, 실패 관측 기록.
- `07-stale-weighted-route.jpeg`: 만료 시 위치 숨김/정적 정보 유지.
- `08-large-text-arrow-fixed.jpeg`: 새 번들의 화살표 수정 재검증.
- `09-final-stopped.jpeg`: 최종 종료·오류 없음.

`06-standard-detail-waiting.jpeg`는 폰트 설정을 복원한 직후 캡처로 화면 반영이 늦어 큰 글자가 남아 있다. 표준 폰트 성공 증거로 사용하지 않는다. 최종 simctl 조회에서 원래 설정 `large` 복원을 확인했다.

## 남은 범위와 정리

32구간은 자동 테스트로 순서/표시 보존과 payload budget 정책을 확인했지만, 32구간+긴 노선명+최대 글자+VoiceOver의 독립 실화면 검증은 남아 있다. 거리 비례도 정책 테스트 완료이고 이번 GPS E2E 경로는 TIME이다. 모든 노선색의 대비 검증도 남아 있다.

첫 도보·승차 정류장 접근/대기 지원만 유지한다. 버스 실제 탑승/하차·한 정류장 전·환승·최종 도착·음성 안내는 구현 완료가 아니다. 실제 APNs 전달은 개발 Firebase 설정 미지정으로 미검증이며 이번 작업은 로컬 ActivityKit 표시 검증이다.

시험용 Info.plist opt-in/background, Podfile.lock, Xcode 프로젝트를 작업 시작 시점 전체 내용과 정확히 일치하도록 복원했다. plist 문법 검사 PASS. Pods/Manifest.lock은 위조하지 않았다. GPS clear·폰트 설정 복원·세션 종료·fixture 초기화 후 이번 Metro와 loopback harness만 정리했다. .env·실기기·다른 시뮬레이터 작업과 기존 미커밋 작업은 건드리지 않았고 커밋/푸시는 하지 않았다.

다음은 P2-3c2b 잔여 접근성/긴 경로 시각 게이트를 통과시킨 후 P2-3d의 화면 밖 credential/소유권·실제 본인 일정 및 APNs 개발 환경 연결이다. 실제 버스 이동 증거와 하차 안내는 별도 엔진 완주 단계로 유지한다.
