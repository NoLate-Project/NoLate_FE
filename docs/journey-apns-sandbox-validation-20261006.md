# Sandbox 키 수정 후 실제 APNs 재검증 — 2026-10-06

판정: **실제 원격 UPDATE와 독립 시뮬레이터 잠금 화면의 새 내용 수신 확인. 위치 만료 표시 게이트는 실패. 원격 END는 미검증.**

후속: 이 실패 기록은 보존한다. 이후 [위치 만료·실제 END 수정 검증](journey-apns-end-validation-20261006.md)에서 온라인 원격 만료 표시 제거·앱 미실행 END 수신/카드 제거·재시작 미재생성을 확인했다. 오프라인 stale 표시와 운영 durable ownership은 아직 열린 게이트다.

## 변경·시험 범위

- 사용자가 Firebase 개발 APNs 인증 키 설정을 완료했다고 알린 뒤 같은 시험 설치로 재검증했다. 앞서 제공된 화면에서는 개발 슬롯과 프로덕션 슬롯이 같은 Production 전용 키를 가리켰다. 새 키 원문·ID는 읽지 않았으며 콘솔 설정은 직접 변경하지 않았다. 사용자 작업 이후 환경 불일치 오류가 사라진 것을 실제 전송으로 확인했다.
- 기존 Firebase `nolate-cbdf2`의 단일 허용 설치, 합성 저장 경로·JWT·버스 도착정보만 사용했다. 운영 일정/DB·다른 설치·실기기는 시험하지 않았다.
- `NoLate Journey P0 Isolated 20261004`, iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`. detached 창 `deviceWindow-AppWindow-8`과 `Show in Device Hub`를 확인하여 독립 창만 조작했다. 다른 시뮬레이터 알람으로 포커스가 바뀌면 조작을 멈추고 대상 창을 다시 확인했다. 사용자가 대상 창을 앞으로 가져와 주었다.
- loopback APNs harness 15544와 Metro 8088. 실제 외부 전송은 Firebase/APNs만이며 합성 GPS를 CoreLocation에 입력했다. 이동 단계를 강제로 바꾸거나 `simctl push`로 수신을 대체하지 않았다.
- 앱/엔진 코드는 이번 재검증에서 수정하지 않았다. 운영 기본 OFF·DEBUG/SIMULATOR·최대 10분 제한을 유지했다. 기존 미커밋 변경을 보존했으며 커밋·푸시는 하지 않았다.

## 구분 가능한 원격 수신 증거

`NoLateAutomaticGuidanceActivity.apply`는 원격 pilot일 때 최초 카드를 로컬 생성하되 이후 `Activity.update`를 실행하지 않는다. 따라서 서버 수락 숫자나 초기 카드만으로 원격 수신 성공을 판단하지 않았다.

1. 준비 후 GPS `marker-walk` 입력으로 자동 출발 1회, 서버 ACKNOWLEDGED를 확인했다.
2. 첫 로컬 카드의 도보 약 60m와 다른 **승차 지점 근처** 안내가 잠금 화면에 나타났다.
3. 화면을 잠근 채 정류장 좌표의 `waiting-monitor` 입력을 유지했다. 잠금 카드가 **합성 정류장 1 / 버스 대기·도착하면 탑승 준비 / 버스 도착까지 1분**으로 바뀌었다. 경로 바의 현재 위치 화살표도 대기 경계에 표시됐다.
4. 로컬 UPDATE가 꺼진 상태의 구분 가능한 단계 전환이므로 해당 UPDATE의 실제 잠금 화면 수신을 인정한다. 모든 24건의 개별 전달 성공·실시간 교통 정보 정확도·버스 승차 이후 진행 성공을 의미하지는 않는다.

| 검사 | 결과 |
| --- | --- |
| 실제 provider 호출 | attempts=24, accepted=24, rejected=0, failureCode=NONE |
| GPS 자동 출발 | prepare=1, departure=1, activation=1. 단계 전환 버튼 없음 |
| 잠금 중 원격 UPDATE | 접근 안내 → 버스 대기·합성 도착까지 1분, 시각 관측 통과 |
| 위치 만료 | GPS replay 중단·clear 후 앱은 위치 확인 중으로 변경됐지만 잠금 카드는 이전 대기/1분/화살표 유지. 실패·미해결 |
| 정상 종료 | 앱 STOPPED·서버 종료 대기 0건, 서버 STOPPED, 잠금 카드 제거 |
| 종료 후 앱 프로세스 재시작 | 시험 화면 IDLE·APNs OFF·종료 큐 0. 서버 STOPPED와 전송 수 24 유지. 잠금 카드 재생성 없음 |
| 인증 경계 | refresh=1, rejectedRequests=0, trapRequests=0, trapAuthorizationSeen=false |

`journey-readiness-check.mjs --expect-stopped`는 종료 상태를 통과했지만 `apnsDelivery=UNVERIFIED`를 유지한다. 이 도구는 UI 수신을 자동 확인하지 않으므로 값을 수동 성공으로 바꾸지 않았다. 잠금 수신 판정은 아래 시각 증거와 별도로 기록한다.

## 증거

- [서버 수락 이후 시험 앱](evidence/journey-apns-sandbox-20261006/01-sandbox-provider-accepted.png)
- [원격 접근 안내 잠금 카드](evidence/journey-apns-sandbox-20261006/02-remote-lock-boarding-approach.png)
- [잠금 중 원격 대기·도착 안내](evidence/journey-apns-sandbox-20261006/03-remote-lock-waiting-arrival.png)
- [위치 만료 뒤 남은 잠금 안내 — 실패 증거](evidence/journey-apns-sandbox-20261006/04-location-expired-lock-retained.png)
- [같은 시험의 앱 위치 만료](evidence/journey-apns-sandbox-20261006/05-app-location-expired.png)
- [STOPPED·종료 큐 0](evidence/journey-apns-sandbox-20261006/06-stopped-zero-outbox.png)
- [종료 후 잠금 카드 제거](evidence/journey-apns-sandbox-20261006/07-stopped-lock-card-removed.png)
- [재시작 후 IDLE·재활성 없음](evidence/journey-apns-sandbox-20261006/08-restart-no-reactivation.png)
- [재시작 후 잠금 카드 없음](evidence/journey-apns-sandbox-20261006/09-restart-lock-no-card.png)

## 남은 게이트와 다음 순서

1. 원격 전용 상태에서 위치/도착정보 만료 표시를 수정하고 무수신·네트워크 단절·provider 거절 각각 독립 잠금 E2E로 재검증한다. `staleDate`/`context.isStale` 코드 존재만으로 통과하지 않는다. 로컬·원격 소유권/순서 정책 없이 로컬 갱신을 켜서 실패를 숨기지 않는다.
2. 현재 시험 sender는 UPDATE-only다. **원격 END를 구현·검증**하고, 잠금 수신 → 원격 END → 앱 재시작 → 지연 UPDATE 역전 방지를 별도로 시험한다. 이번 앱 종료는 로컬 `Activity.end`이므로 원격 END 수신 성공이 아니다.
3. token 회전·장시간/background·실기기·프로덕션 빌드, 전체 접근성/VoiceOver, 서버 ACTIVE TTL 및 JS 중단/다른 로그인 세대 종료 재조정은 미완료다.
4. 실제 본인 일정·지도/교통 공급자 연결과 버스 승차/하차/환승·지하철·음성은 별도 구현 게이트다. 합성 1분 안내를 실제 버스 도착 정보로 표현하지 않는다.

시험 종료·서버 STOPPED·잠금 카드 제거·재시작 후 재활성 없음 확인 후 GPS를 clear했다. 이번에 띄운 시험 서버와 Metro만 종료하고 독립 시뮬레이터 및 다른 기기는 보존했다.

이전 환경 불일치 실패와 자동 검사 이력은 [앞선 연결 검증](journey-apns-connected-validation-20261006.md)에 보존한다. 이번에는 동일 코드의 실제 재시도·화면 E2E 및 문서 변경 검사만 수행했으며 앞선 전체 단위 테스트를 새로 실행한 것으로 주장하지 않는다.
