# 위치 만료·실제 APNs END 검증

기준: 2026-10-06, `feature/transit-guidance-v1`의 미커밋 작업 기준. 이전 [Sandbox UPDATE 시험](journey-apns-sandbox-validation-20261006.md)의 실패 항목을 후속 수정했다. 운영 완료 기록이 아니다.

후속 [종료 기록 자동 정리 검증](journey-checkpoint-reconciliation-validation-20261006.md)에서 동일 인증 세대 terminal checkpoint의 수동 복구 필요 문제를 수정했다. 아래 표의 checkpoint 잔류/명시 복구는 이 문서 시험 당시의 이력이며, 새 로그인 세대·운영 durable sender는 여전히 열린 게이트다.

## 구현 범위

- GPS 만료 상태가 전송 정책에서 함께 차단되던 문제를 수정했다. 기존 관측 시각/만료를 유지하면서 위치 확인 필요·불확실 상태로 전환하고, 위치 진행값과 도착정보를 제거하는 요청만 허용한다. 오래된 좌표를 새 관측으로 포장하지 않는다.
- TEST-source sender에 실제 END를 추가했다. 서버가 이미 고정한 설치/Activity/소유자/로그인 세대/경로 revision과 digest만 사용한다. 종료 API는 토큰을 받지 않으며 임의 설치로 재지정하지 못한다.
- 서버 STOPPED를 provider 호출 전에 확정하고 이후 UPDATE를 차단한다. END는 최신 벽시계 timestamp와 과거 dismissal-date를 사용한다. 수락한 동일 END는 중복 receipt만 반환한다. 같은 초의 역전, 다른 binding, 회수된 인증, 모호한 provider 실패 뒤 무조건 재전송은 차단한다.
- 일반 시험 `/stop`도 이미 고정된 push lane이 있으면 END로 연결한다. `journey-apns-end.mjs --send-end`는 고정 loopback·단일 pinned lane 전용 명시 실행 도구다. JWT는 메모리에서만 사용하며 출력/파일 저장하지 않는다.

## 독립 시뮬레이터 E2E

대상: `NoLate Journey P0 Isolated 20261004`, iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`. detached `deviceWindow-AppWindow-8` / `Show in Device Hub`를 확인한 창만 조작했다. embedded Device Hub·실기기·다른 시뮬레이터는 조작하지 않았다.

합성 JWT·일정·3구간 경로·버스 도착정보를 사용했다. 위치는 CoreSimulator→실제 CoreLocation 입력 replay이며 이동 단계 강제 주입이 아니다. 외부 전송은 사용자가 승인한 Firebase 프로젝트의 단일 설치 SHA-256 allowlist로 제한했다. 로컬 Activity UPDATE를 차단해 새 잠금 내용이 원격 전송에서 비롯됐음을 구분했다.

| 시험 | 관측 결과 |
| --- | --- |
| 준비→GPS 이동 | ARMED에서는 출발 0회, GPS 이동 후 ACTIVE/ACK·출발 1회 |
| 원격 대기 안내 | 잠금 화면에서 화살표·합성 정류장 대기·버스 도착 1분 확인 |
| GPS 중단·clear | 약 20초 뒤 잠금 카드가 위치 확인 중으로 변경. 화살표·도착시간 제거. 상세도 정밀 진행/현재 행 숨김 |
| GPS 회복 | 상세의 대기 경계 화살표·현재 행 및 원격 잠금 카드의 대기/1분 안내 회복 |
| 앱 미실행 원격 END | 잠금 중 앱을 terminate하고 해당 app service가 없는 상태를 확인. END 수락 뒤 앱 재실행 전에 잠금 카드 제거 확인 |
| 동일 END 반복 | duplicate=true, 추가 provider 전송 없음 |
| 재시작 | 엔진 IDLE·종료 큐 0·서버 STOPPED, 잠금 카드 미재생성. 단, 기존 checkpoint가 남아 새 준비는 CHECKPOINT_RESTORE_OR_STOP_REQUIRED로 차단됨 |
| 명시 복구 시도 | 종료된 서버 세션은 AUTOMATIC_SERVER_REJECTED로 거절, 추적 재개 없음. checkpoint 정리 뒤 새 준비 가능. 자동 terminal 재조정/오류 문구 개선은 후속 항목 |
| 앱 정상 종료 통합 | 복구 거절 시 provider 설정도 OFF가 됨을 확인. OFF 새 세션을 종료한 뒤 provider를 다시 명시 선택하여 새 GPS 세션 ACTIVE/ACK. UI 종료로 END 수락 카운터 1→2, 서버 STOPPED·큐 0·잠금 카드 없음 |

첫 원격 END/중복 시험 종료 시 provider 시도 26회·수락 26회·실패 0회(만료 제거 2회, END 1회). 출발/활성화 1회·서버 STOPPED, trap 요청 0회·인증 유출 없음. 수락 26건 전부의 개별 OS 수신을 주장하지 않는다. 자동 readiness의 `apnsDelivery=UNVERIFIED`는 그대로 두며 육안 수신 증거와 구분한다.

같은 서버를 reset하지 않고 후속 두 GPS 세션까지 수행한 최종 카운터는 시도/수락 33회·실패 0회, 만료 제거 3회·END 2회, 준비/출발/활성화 각각 3회, STOPPED다. 각 세션 출발은 1회이며 추가 두 출발은 새 세션이지 재시작 중복이 아니다. 의도적 무인증 검사는 401 두 건, trap 요청 0·Authorization 유출 false다. 정상 UI stop은 로컬 종료도 동반하므로 원격-only 제거 증거는 앱 미실행 첫 END 시험을 따른다.

### 화면 증거

- [원격 새 대기 안내](evidence/journey-apns-end-20261006/03-lock-remote-waiting-fresh.png)
- [원격 위치 만료 시 정밀 정보 제거](evidence/journey-apns-end-20261006/04-lock-remote-location-expired.png)
- [상세 위치 만료](evidence/journey-apns-end-20261006/06-detail-location-expired.png)
- [상세 GPS 회복](evidence/journey-apns-end-20261006/07-detail-gps-recovered.png)
- [잠금 GPS 회복](evidence/journey-apns-end-20261006/08-lock-gps-recovered.png)
- [앱 미실행·END 전 카드](evidence/journey-apns-end-20261006/09-app-not-running-lock-before-end.png)
- [실제 END 후 카드 제거](evidence/journey-apns-end-20261006/10-remote-end-card-removed.png)
- [재시작 읽기 전용 진단·IDLE/큐 0](evidence/journey-apns-end-20261006/12-restart-readiness-idle-queue-zero.png)
- [재시작 잠금 카드 미재생성](evidence/journey-apns-end-20261006/13-restart-lock-no-resurrection.png)
- [이전 checkpoint 새 준비 차단](evidence/journey-apns-end-20261006/14-restart-checkpoint-blocks-new-prepare.png)
- [종료된 세션 복구 거절](evidence/journey-apns-end-20261006/15-restart-restore-rejected-no-resume.png)
- [정상 종료·큐 0](evidence/journey-apns-end-20261006/18-ui-stop-queue-zero.png)
- [정상 종료 뒤 잠금 카드 없음](evidence/journey-apns-end-20261006/19-ui-stop-lock-card-absent.png)

## 자동 검사·빌드

- FE Jest: 295 suites / 2,673 tests PASS. TypeScript 검사 PASS.
- Swift 순수 검사: 267 tests PASS, 위치 만료 제거/회복·precision 잔류 차단·확정 거절 fence 추가.
- BE: pilot 17 + Firebase sender 3 = 20 tests PASS. END 소유권/중복/지연 UPDATE/같은 초/불확실 실패/만료 세션 cleanup 포함.
- Node QA: END 5 + GPS replay 7 + readiness 3 + plugin 8 = 23 tests PASS. 새 mjs의 ES2022/Node 범위 ESLint PASS(전체 프로젝트 lint 성공 주장은 아님).
- 앱/위젯 signed simulator build PASS. unsigned 빌드에서는 APNs 등록 및 Keychain 접근 실패가 재현됐고, ad-hoc simulator 서명 후 같은 설치 등록 성공. simulator entitlement는 build의 `NoLateFE.app-Simulated.xcent`에서 `aps-environment=development`를 확인했다. 빈 `codesign` entitlement 출력만으로 simulator 권한 부재를 단정하지 않는다.
- 시험 빌드에서만 opt-in을 넣었고 소스 Info.plist는 원래 default-off로 복원했다. `.env`, Apple/Firebase 콘솔, 인증 키 원문은 변경하지 않았다. 커밋/푸시 없음.
- 마무리: 서버 STOPPED·종료 큐 0·잠금 카드 없음 확인 뒤 대상 GPS를 clear했다. PID와 작업 디렉터리를 확인한 이번 시험 서버/Metro만 종료했다. 다른 시뮬레이터/서버·사용자 데이터는 보존했다.

## 아직 열린 게이트

1. 이번 만료 제거는 **온라인에서 명시적 invalidation이 전달된 경우**다. 네트워크 단절·앱 미실행·provider 미전달에서 OS staleDate만으로 화살표가 제거되는지 미검증이다. 로컬/원격 fallback에는 소유권과 timestamp 역전 방지가 필요하다.
2. END lane은 시험 서버 메모리만 사용한다. 운영용 token 소유권·회전·durable terminal outbox·server restart·모호한 수락 복구는 미완료. 지연 UPDATE는 서버 단위 검사로 차단했으며 실제 망에서 패킷 순서를 바꾼 E2E는 아니다.
3. 재시작 후 checkpoint 자동 terminal 재조정·새 로그인 세대·ACTIVE TTL, 최대 글자 전체 스크롤/VoiceOver, 실제 본인 일정/지도/교통 공급자 연결은 남아 있다.
4. 탑승 확정·승차 후 진행·하차 한 정류장 전 안내·지하철/환승·음성/무음 알림·실기기/배터리 현장 시험은 아직 지원/검증 완료가 아니다.

원격 UPDATE/END와 dismissal 규칙은 [Firebase Live Activity](https://firebase.google.com/docs/cloud-messaging/customize-messages/live-activity), [Apple ActivityKit push](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications)를 따른다. provider receipt와 잠금 육안 관측은 별도 증거다.
