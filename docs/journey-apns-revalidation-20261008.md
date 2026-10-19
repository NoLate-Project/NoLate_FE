# 실제 APNs 재검증 — 2026-10-08

## 판정

**단일 시험 설치의 원격 UPDATE·잠금 화면 새 내용 수신·앱 미실행 원격 END/카드 제거 PASS.**
provider 수락 16건 모두의 개별 단말 전달, 운영 준비, 실기기 GPS·버스 완주 성공을 의미하지 않는다.
R1 후속의 로컬 ActivityKit 시험과 구분하여 수행한 실제 외부 전달 시험이다.

## 격리

- `NoLate Journey P0 Isolated 20261004`, iOS 26.5, UDID `2847D4CF-88EA-4DA1-87E9-FD1948F58E01`.
  detached `deviceWindow-AppWindow-8`과 `Show in Device Hub`를 확인한 독립 창만 CUA로 조작했다.
- 기존 사용자 승인 Firebase `nolate-cbdf2`의 실제 자격증명은 원래 BE 경로에서만 읽었다.
  프로젝트 일치/형식/키 존재 boolean만 확인했고 원문·FCM/Activity token·JWT를 출력하거나 문서에 저장하지 않았다.
- 시험 앱에서 genuine APNs 등록과 설치 SHA-256을 새로 확인했다. 그 설치 지문 한 개로 서버 발송을 제한했다.
  다른 기기·운영 일정/DB·Apple/Firebase 콘솔·`.env`는 변경하지 않았다.
- loopback `authenticatedJourneyApnsHarness`(15544/15545), dotenv 비활성 Metro(8088), 기존 signed DEBUG 앱을 사용했다.
  JWT/일정/경로/도착정보는 합성, GPS는 CoreSimulator 입력이다. 외부 발송만 실제 Firebase→APNs다.
- 원격 pilot에서는 최초 카드 생성 이후 `Activity.update`를 실행하지 않는다.
  초기 카드만으로 수신을 판정하지 않고, 잠금 상태의 구분 가능한 새 문구를 확인했다.
- `simctl push`, 가짜 push token, 단계 전환 bridge는 사용하지 않았다. 제품 코드 변경·native 재빌드 없이 재검사했다.

## 실제 관측

| 순서 | 결과 |
| --- | --- |
| 설치 확인·명시 provider 연결·경로 검사·동의·준비 | ARMED, 출발 0회, Activity token 대기 |
| `marker-walk` GPS | ACTIVE, 출발 1회, ACKNOWLEDGED, 실제 provider 수락 |
| 시험 기기를 잠근 뒤 `marker-finish` | 잠금 카드가 초기 도보 약 60m와 다른 **승차 지점 근처**로 변경 |
| 잠금 중 `dwell` | **합성 정류장 1 / 버스 대기·도착하면 탑승 준비 / 도착까지 1분** 및 승차 경계 화살표 확인 |
| GPS 입력 중단·clear/앱 terminate | app service 0/running target app 0을 확인. 잠금 카드가 위치 확인 중·위치 업데이트 필요로 표시되고 화살표/도착시간 제거 |
| 앱 재실행 전 명시 원격 END | providerAccepted=true, duplicate=false, 서버 STOPPED. 잠금 카드 제거를 스크린샷으로 확인 |
| 같은 END 재요청 | duplicate=true, provider 전송 계수 16 유지, END 수락 1 유지 |

원격 대기 안내 수신은 로컬 UPDATE가 꺼진 상태의 새 내용으로 구분했다.
위치 만료의 화면 전환도 관측했지만 두 invalidation 각각의 OS 수신과 OS stale 처리의 기여를 분리 측정한 것은 아니다.
END 전에는 앱 terminate 뒤에도 카드가 있었고, END 뒤 앱을 직접 재실행하기 전에 카드가 사라졌다.
END 이후 OS가 앱 프로세스를 생성하지 않았다는 보장은 하지 않는다.

최종 서버 집계(reset 없이 동일 프로세스):

```json
{
  "lastState": "STOPPED",
  "prepareCount": 1,
  "departureCount": 1,
  "activationCount": 1,
  "guidancePushProviderAttemptCount": 16,
  "guidancePushAcceptedCount": 16,
  "guidancePushProviderRejectedCount": 0,
  "guidancePushInvalidationAcceptedCount": 2,
  "guidancePushEndAcceptedCount": 1,
  "guidancePushFailureCode": "NONE",
  "trapRequests": 0,
  "trapAuthorizationSeen": false
}
```

수신 증거는 이 작업의 CUA 스크린샷/AX 출력이다. 별도 PNG를 저장했다고 기록하지 않는다.
readiness의 자동 `deviceVerified=false`를 육안 관측 때문에 수동 true로 바꾸지 않았다.

## 남은 범위·정리

END 뒤 cold 재진입을 추가 시도했지만 CUA drag가 `noWindowsAvailable`로 실패했다.
앱 재시작 후 자동 정리/재생성 방지를 이번 실행의 PASS로 세지 않는다.
이전 재시작/durable DB 증거는 과거 기록이며 이번 재검사에 합산하지 않는다.
초기 locked openurl 115/서버 미실행 fixture unavailable도 진입 준비 과정의 실패로 구분하고,
실제 전송 실패 건수로 집계하지 않았다.

종료·카드 제거·중복 END 검증 후 합성 GPS를 clear했다.
이번 harness JVM PID 19448과 Metro PID 18583의 BE/FE cwd를 각각 확인해 TERM으로 종료했다.
서버 실행 중 BE 회귀 빌드는 하지 않았다. 자격증명·사용자 데이터·다른 기기는 삭제하지 않았다.
로그는 `/private/tmp/nolate-apns-recheck-harness-20261008.log`, `/private/tmp/nolate-apns-recheck-metro-20261008.log`다.
마지막에 대상 시험 앱 프로세스도 종료했고 8088/15544/15545 listener 없음과 FE·BE diff whitespace PASS를 확인했다.

후속 코드 변경 뒤 자동 검사도 재실행했다: BE 교통/여정/Live Activity 51 suites / 368 tests,
Swift 285 tests, QA END/replay/readiness 15 tests 모두 PASS. 자동 검사는 위 실제 수신 관측과 별개다.
FE 전체 Jest/TypeScript와 새 native 빌드는 이번 턴에 재실행하지 않았다.

이 재검증 후 다음 R1 slice인 **정류장 occurrence–노선 형상 매핑**을 구현·시험했다.
[후속 결과](journey-r1-stop-shape-validation-20261008.md): BE 368건·Swift 285건·QA 15건 PASS.
실제 7016은 매핑 모호성을 해소하지 못해 차단을 유지했다.
실제 도보 geometry·도로 구간/방면 crosswalk·차량 동행 Runtime·R3/R5/R6은 여전히 별도 미완료다.
