# NoLate 이동 중 길안내 로드맵

마지막 갱신: 2026-09-25 (Asia/Seoul)  
문서 상태: 제안 확정 전 / 구현 미착수  
우선 플랫폼: iOS 파일럿, 이후 Android 동등 기능  

## 1. 문서 목적

이 문서는 NoLate의 기존 출발 알림을 출발 이후까지 확장하여 다음 경험을 제공하기 위한
제품·기술 로드맵이다.

- 위치 이동을 이용한 자동 출발 감지
- 출발 후에도 유지되는 Live Activity
- 현재 경로 구간, 남은 정거장, 다음 행동 표시
- 도보·승차·하차·환승·도착 음성 안내
- 버스·지하철 대기시간과 환승 관련 안내 푸시
- 화면이 잠긴 상태에서도 이어지는 활성 여정 안내

핵심 목표는 네이버 지도 전체 기능을 한 번에 복제하는 것이 아니다. NoLate가 이미 알고
있는 일정과 선택 경로를 기반으로, 사용자가 놓치기 쉬운 출발·승차·하차·환승 시점을
신뢰성 있게 알려 주는 것이 1차 목표다.

## 2. 핵심 결정

1. 기능 전체를 하나의 `Journey Guidance` 도메인으로 묶는다.
2. Live Activity, 음성, 푸시가 각자 현재 상태를 추론하지 않는다.
3. 하나의 `JourneyStateMachine`이 만든 `JourneyEvent`를 세 채널이 함께 소비한다.
4. 원시 GPS는 기본적으로 기기에서 처리하고 서버에는 파생된 진행 상태만 전송한다.
5. 출발 전 `SchedulePushJob`과 출발 후 `JourneyGuidanceSession`을 분리한다.
6. 실시간 교통정보는 현재 승차 구간과 다음 환승 구간만 조회한다.
7. 최신성이 증명되지 않은 교통정보로 행동을 유도하는 안내를 만들지 않는다.
8. 모든 기능은 별도 기능 플래그로 중단할 수 있어야 한다.

```text
기기 위치 + 저장 경로 + 실시간 교통정보
                     │
                     ▼
             JourneyStateMachine
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
    Live Activity   음성 안내   안내 푸시
```

## 3. 현재 기준선

| 영역 | 현재 상태 | 로드맵에 미치는 영향 |
| --- | --- | --- |
| Live Activity | `inTransit` 상태와 원격 갱신 기반은 있으나 정적인 경로 요약만 표시 | 현재 구간·정거장·다음 행동 상태를 확장할 수 있음 |
| 출발 처리 | 출발 완료 시 FE와 BE가 Live Activity를 종료 | 종료 대신 `inTransit` 전환으로 변경 필요 |
| 위치 | 전경 권한으로 현재 위치를 한 번 조회 | 연속·백그라운드 위치 세션이 새로 필요 |
| 경로 | 원본 `TransitLegDetail`에 경로 좌표, 정류장 좌표·순서, 방면, 승강장, 환승 위치가 존재 | 기기 내 경로 매칭에 재사용 가능 |
| UI용 경로 | `RouteInfo` 변환 과정에서 통과 정류장 좌표가 제거됨 | 안내 엔진은 축약된 `RouteStep`이 아닌 원본 leg를 사용해야 함 |
| 실시간 도착 | 서울 지하철·서울 버스·비서울 TAGO 버스 지원 | 현재/다음 승차 구간 안내에 재사용 가능 |
| 실시간 ETA | 서버는 의도적으로 첫 승차만 실시간 보정 | 환승 시점마다 활성 승차 구간을 새로 조회하는 별도 로직 필요 |
| 푸시 | outbox, device delivery, ACK, 재시도, generation/fence 기반이 존재 | 새 여정 이벤트 타입과 freshness fence를 추가해 재사용 가능 |
| 음성 | TTS 없음. 기존 오디오는 반복 알람음 전용 | 별도 네이티브 길안내 TTS 모듈 필요 |
| 개인정보 | 현 정책은 ETA 개선을 위해 위치를 추가 수집하지 않는다고 명시 | 백그라운드 길안내 출시 전에 고지·정책 개정 필요 |

주요 코드 기준선:

- [현재 위치 단건 조회](../src/modules/map/currentLocation.ts)
- [대중교통 원본 leg 계약](../src/modules/map/tmapApiCore.ts)
- [UI용 경로 변환](../src/modules/schedule/routeInfo.ts)
- [Live Activity TS 계약](../src/modules/notification/liveActivity.ts)
- [Live Activity Swift 상태](../modules/nolate-live-activity/ios/NoLateLiveActivityModels.swift)
- [현재 정적 경로 바](../modules/nolate-live-activity/ios/Extension/NoLateRouteBarView.swift)
- [출발 완료 후 로컬 Activity 종료](../src/modules/schedule/scheduleDepartureCompletion.ts)
- [출발 처리와 BE Activity 종료](../../NoLate_BE/src/main/kotlin/com/noLate/schedule/application/useCase/ScheduleUseCase.kt)
- [실시간 도착 DTO](../../NoLate_BE/src/main/kotlin/com/noLate/transit/domain/TransitArrivalDto.kt)
- [실시간 도착 서비스](../../NoLate_BE/src/main/kotlin/com/noLate/transit/application/TransitArrivalService.kt)
- [첫 승차 실시간 보정](../../NoLate_BE/src/main/kotlin/com/noLate/eta/application/transit/FirstBoardingRealtimeOverlay.kt)

## 4. 제품 범위

### 4.1 iOS 파일럿 범위

- 사용자 버튼 또는 자동 출발 감지로 여정 시작
- 잠금 상태에서 위치 추적 지속
- Live Activity에 현재 구간, 진행률, 남은 정거장, 다음 행동 표시
- 도보 접근, 승차, 하차 2정거장 전, 다음 정거장 하차, 환승, 도착 음성 안내
- 현재 승차 구간의 버스·지하철 대기시간 표시
- 중요한 승차·하차·환승 이벤트 안내 푸시
- 수동 `탑승했어요`, `하차했어요`, `안내 종료` 보정
- 위치·음성·알림 권한이 없을 때 단계적 기능 축소

### 4.2 안정화 이후 범위

- Android 위치 foreground service와 지속 알림
- 경로 이탈 감지와 재탐색
- 지하철 터널에서 현재 역 추정 개선
- 놓친 버스·환승 자동 복구
- CarPlay·이어폰·Bluetooth 세부 최적화
- 사용자별 안내 상세도와 음성 스타일

### 4.3 1차 범위에서 제외

- Live Activity 안의 실시간 지도
- GPS만으로 지하철 터널의 정확한 현재 위치 보장
- 원시 위치의 서버 장기 보관
- 모든 경로 공급자에 대한 차량 단위 실시간 위치 보장
- 내비게이션 수준의 모든 골목별 도보 회전 안내

## 5. 사용자 경험과 채널 정책

### 5.1 기본 원칙

- 일상적인 진행 변화는 Live Activity가 담당한다.
- 사용자가 즉시 행동해야 하는 순간은 음성이 우선이다.
- 푸시는 앱이 잠겨 있거나 음성을 놓쳤을 때의 보조 수단이다.
- 같은 milestone은 채널별 최대 한 번만 전달한다.
- `하차·환승 > 승차 > 대기시간 변화 > 일반 진행` 순으로 우선 처리한다.

### 5.2 이벤트 매트릭스

| 이벤트 | Live Activity | 음성 | 푸시 | 기본 정책 |
| --- | --- | --- | --- | --- |
| 출발 감지 | `이동 중` 전환 | 경로 안내 시작 | 생략 | 한 번만 발생 |
| 승차 지점 접근 | 승차역·노선 표시 | 노선·방면 안내 | 선택적 | 위치 신뢰도가 충분할 때만 |
| 차량 5분/2분 전 | 대기시간 표시 | 의미 있는 변화만 | 선택적 | 매분 알리지 않음 |
| 차량 곧 도착 | `곧 도착` 강조 | 즉시 안내 | 중요 | 최신성이 검증된 값만 사용 |
| 탑승 판단 | 현재 노선 강조 | 탑승 확인 | 생략 | 불확실하면 수동 확인 제공 |
| 하차 2정거장 전 | 남은 정거장 표시 | 하차 준비 | 중요 | 현재 정거장 판정 필요 |
| 다음 정거장 하차 | 하차역 강조 | 다시 안내 | 시간 민감 | 가장 높은 우선순위 |
| 환승 | 환승 구간 강조 | 노선·방면·승강장 안내 | 중요 | 다음 승차 실시간 조회 시작 |
| 대기시간 악화 | ETA 갱신 | 큰 변화만 | 선택적 | configurable delta 적용 |
| 경로 이탈 | 확인 필요 표시 | 경로 확인 안내 | 중요 | 재탐색은 안정화 단계 |
| 목적지 도착 | 도착 표시 후 종료 | 도착 안내 | 생략 | 추적·TTS·job 모두 종료 |

Apple의 `time-sensitive` 등급은 하차 임박, 환승 실패 위험, 차량 곧 도착처럼 현재 확인할
필요가 있는 이벤트에만 사용한다. 일반 진행이나 매분 변경에는 사용하지 않는다.

## 6. 목표 아키텍처

### 6.1 기기 책임

- 활성 여정 위치 수집
- 저장 경로에 대한 map matching
- 현재 leg·stop·phase와 confidence 계산
- 로컬 `JourneyEvent` 생성
- 네이티브 TTS 실행과 음성 queue 관리
- Live Activity 로컬 갱신
- 서버에 원시 GPS가 아닌 파생 진행 상태 보고
- 사용자의 수동 보정 처리

### 6.2 서버 책임

- `JourneyGuidanceSession`의 소유권·세대·경로 버전 관리
- 현재/다음 승차 구간의 실시간 도착정보 조회
- 정류장·노선별 요청 병합과 캐시, 공급자 quota 보호
- 최신성 검증과 실패/빈 결과 구분
- 안내 푸시와 Live Activity 원격 갱신
- event dedupe, TTL, recipient/session/route fence
- 운영 지표와 기능 플래그

### 6.3 공유 계약

```text
JourneyProgress
- journeySessionId
- generation
- routeRevision
- phase
- activeLegIndex
- currentStopIndex
- remainingStops
- legProgress
- predictedArrivalAt
- nextInstruction
- confidence
- observedAt

JourneyEvent
- eventKey
- sequence
- type
- legIndex
- stopIndex
- milestone
- speechText
- pushPolicy
- sourceFreshness
- validUntil
- createdAt
```

권장 `eventKey` 구성:

```text
journeySessionId:routeRevision:generation:leg:stop:eventType:bucket
```

이 키를 음성, 푸시, Live Activity에서 공유해 재전송·앱 재시작·FCM 중복 전달에도 같은
이벤트가 반복되지 않게 한다.

## 7. 여정 상태기계

```text
READY
  └─> WALKING_TO_STOP
        └─> WAITING
              └─> RIDING
                    ├─> ALIGHTING
                    │     └─> TRANSFERRING ─> WAITING ─> RIDING
                    └─> FINAL_WALK
                           └─> ARRIVED

어느 상태에서나: STOPPED / EXPIRED / OFF_ROUTE
```

안전 규칙:

- 경로 재탐색이나 명시적 사용자 보정이 아니면 상태가 뒤로 가지 않는다.
- 낮은 정확도, 비정상적인 GPS jump, 오래된 위치는 상태 전환에 사용하지 않는다.
- 한 번의 샘플이 아니라 거리·속도·방향·이전 상태의 연속 증거로 전환한다.
- 신뢰도가 낮으면 정확한 정거장 안내 대신 일반적인 이동 상태만 표시한다.
- `ARRIVED`, `STOPPED`, `EXPIRED` 이후의 모든 늦은 이벤트를 무시한다.

## 8. 위치·경로 진행 판정

### 8.1 경로 입력

안내 엔진은 UI용 `RouteInfo.steps`가 아니라 저장된 원본 `TransitLegDetail`을 기준으로
한다. 원본에는 다음 정보가 보존되어 있다.

- leg별 polyline과 geometry 신뢰도
- 승·하차 정류장 ID와 좌표
- 전체 통과 정류장의 좌표와 순서
- 노선, 방면, 상·하행
- 승강장, 출구, 추천 승차·환승 위치

### 8.2 모드별 판정

- 도보: 현재 좌표를 polyline에 투영하고 경로상 누적 거리를 계산한다.
- 버스: 정류장 좌표, 경로 방향, 이동 속도, 실시간 도착 상태를 결합한다.
- 지하철: 지상 진입·이탈 좌표, 정거장 순서, 시간표를 결합하고 터널에서는 보수적으로
  추정한다.
- 환승: 이전 ride 종료와 다음 승차 지점 접근을 별도 walking phase로 취급한다.
- 도착: 마지막 leg, 목적지 반경, 이동 속도·체류를 함께 확인한다.

임계값은 코드에 산재시키지 않고 `JourneyProgressPolicy`로 모은다. 초기값은 합성 경로와
실기기 trace로 조정하며, 충분한 실제 표본 전에는 정확도를 `unmeasured`로 표시한다.

## 9. 음성 안내 설계

### 9.1 구현 방향

- iOS: `AVSpeechSynthesizer`
- Android: `TextToSpeech`
- React Native에는 `NoLateJourneyVoice` 형태의 작은 네이티브 브리지를 제공
- 문구 생성은 결정론적 템플릿으로 처리하고 LLM 호출에 의존하지 않음
- TTS 때문에 마이크·음성인식 권한을 요청하지 않음

기존 알람 오디오는 반복 음원과 강한 알람 의미를 가지므로 직접 재사용하지 않는다. 다만
오디오 세션의 직렬화, 이전 설정 복원, race 방지 패턴은 재사용한다.

### 9.2 queue 정책

- `ALIGHT_NOW`와 `TRANSFER_NOW`는 재생 중인 낮은 우선순위 안내를 대체한다.
- reroute, stop, arrive 시 대기 중인 과거 문구를 제거한다.
- 같은 `eventKey`는 정확히 한 번만 읽는다.
- 짧은 시간에 대기시간이 여러 번 변하면 마지막 의미 있는 값만 읽는다.
- 통화 중에는 말하지 않고 Live Activity와 푸시로 축소한다.
- TTS 엔진·한국어 음성이 없거나 실패하면 시각 안내로 degrade한다.

### 9.3 오디오 경험

- 길안내 시작 시 사용자가 음성 안내를 명시적으로 켠 경우에만 발화한다.
- 음악과 함께 사용할 때는 일시적으로 다른 오디오를 duck한다.
- 이어폰·Bluetooth·스피커 route 변경을 따른다.
- `음성 끄기`, `한 번만 다시 듣기`, `상세/간단` 설정을 제공한다.

참고 문서:

- [Apple AVSpeechSynthesizer](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer)
- [Apple duckOthers](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/duckothers)
- [Android TextToSpeech](https://developer.android.com/reference/android/speech/tts/TextToSpeech)
- [Android audio focus](https://developer.android.com/media/optimize/audio-focus)

## 10. Live Activity 설계

추가할 동적 상태:

```text
phase
activeSegmentIndex
currentStopIndex
remainingStops
segmentProgress
headline
nextInstruction
vehicleWaitMinutes
predictedArrivalAt
confidence
lastObservedAt
```

표시 규칙:

- 완료 구간: 완료 표시와 낮은 강조
- 현재 구간: 노선색과 활성 marker
- 예정 구간: 중립색
- 낮은 confidence: 정확한 정거장 대신 `이동 중` 표시
- stale 상태: `최근 위치 확인 필요` 표시
- Dynamic Island compact: 교통수단 아이콘 + 남은 정거장/분
- 잠금화면: 현재 행동 + 진행 경로 + 다음 행동

위치 샘플마다 Activity를 갱신하지 않는다. leg/stop 전환, ETA의 의미 있는 변화,
안내 문구 변경에만 갱신한다. 원격 고빈도 갱신이 실제로 필요해질 때만
`NSSupportsLiveActivitiesFrequentUpdates` 변경을 검토한다.

참고 문서:

- [Apple ActivityKit](https://developer.apple.com/documentation/activitykit)
- [Apple Live Activities HIG](https://developer.apple.com/design/human-interface-guidelines/live-activities)

## 11. 실시간 교통정보와 푸시

### 11.1 활성 구간 조회

현재 상세 화면처럼 모든 승차 leg를 45초마다 조회하지 않는다.

- 멀리 있는 미래 leg: 조회하지 않음
- 현재 도보 접근의 다음 승차 leg: 낮은 빈도
- 승차 지점 근처 또는 환승 중: 높은 빈도
- 탑승 확정 후 해당 승차 대기 조회: 종료
- 다음 환승 접근 시 다음 ride를 새 활성 승차로 전환

구체적인 polling 간격은 공급자 quota와 필드 측정으로 조정한다. 서버는 동일 정류장·노선
요청을 사용자마다 반복하지 않고 공유 캐시로 합쳐야 한다.

### 11.2 freshness 정책

- `PROVIDER_SOURCE_TIMESTAMP`가 있고 허용 시간 이내인 데이터만 행동 유도에 사용한다.
- `LOCAL_RECEIPT_TIMESTAMP_ONLY`는 정보성 표시까지만 허용하거나 숨긴다.
- 오래된 값으로 `곧 도착`, `지금 환승` 음성·푸시를 만들지 않는다.
- 공급자 장애와 실제 도착 차량 없음은 서로 다른 결과로 표현한다.
- FE 계약에도 `freshnessEvidence`, `sourceUpdatedAt`, `validUntil`을 포함한다.

### 11.3 신규 푸시 타입

- `JOURNEY_BOARDING_SOON`
- `JOURNEY_ALIGHT_SOON`
- `JOURNEY_TRANSFER_SOON`
- `JOURNEY_TRANSFER_WAIT`
- `JOURNEY_WAIT_CHANGED`
- `JOURNEY_ROUTE_CHANGED`
- `JOURNEY_OFF_ROUTE`
- `JOURNEY_ARRIVED`

모든 푸시는 다음 fence를 통과해야 한다.

```text
memberId
journeySessionId
generation
routeRevision
activeLegIndex
milestone
validUntil
```

기존 push outbox, device delivery, ACK, immutable payload, retry 구조는 재사용한다. 일반
진행은 Live Activity가 충분하면 푸시를 억제하고, 하차·환승처럼 놓치면 문제가 되는
이벤트만 병행한다.

## 12. 권한·백그라운드·개인정보

### 12.1 권한 흐름

1. 사용자가 `길안내 시작`을 선택한다.
2. 전경 위치 권한이 없으면 기능 이유와 함께 요청한다.
3. 잠금 상태 안내의 이점을 설명한 뒤 백그라운드 위치 권한을 별도로 요청한다.
4. 거부 시 전경 전용 모드로 축소한다.
5. 알림·Live Activity·음성 설정은 독립적으로 끌 수 있게 한다.

iOS에는 `location` background mode가 필요하다. Android에는 location foreground service와
지속 알림이 필요하다. Android 14 이상에 필요한 service type과 권한도 함께 선언한다.

참고 문서:

- [Expo SDK 54 Location](https://docs.expo.dev/versions/v54.0.0/sdk/location/)
- [Apple background location](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background)
- [Android location foreground service](https://developer.android.com/develop/background-work/services/fgs/service-types)

### 12.2 개인정보 원칙

- 원시 GPS는 기본적으로 기기 내 map matching 후 즉시 폐기한다.
- 서버에는 leg, stop, confidence, observedAt 같은 최소 파생 상태만 보낸다.
- 원시 GPS 업로드가 필요한 진단은 별도 명시적 동의와 짧은 보관기간을 둔다.
- metric/log tag에는 좌표, 회원, 일정, 정류장명, token, 원본 payload를 넣지 않는다.
- 회원 탈퇴 시 journey session/event/telemetry 정리 경계를 추가한다.
- 개인정보처리방침과 위치 권한 설명을 기능 출시 전에 개정한다.

## 13. 단계별 실행 계획

### Phase 0. 제품 규칙과 계약 고정

예상: 3~5일

작업:

- Journey phase와 event matrix 확정
- 자동 출발·탑승·하차·도착 판정의 초기 정책 정의
- 음성 문구와 우선순위 확정
- 데이터 계약, API, DB 초안 확정
- 위치 최소수집과 보관정책 결정
- 기능 플래그와 운영 중단 경로 정의
- 실측 전 정확도를 `unmeasured`로 표기하는 원칙 확정

완료 기준:

- FE·BE가 같은 phase/event/fence 계약에 동의
- MVP와 안정화 이후 범위가 분리됨
- 개인정보·권한 UX 문구 초안 승인

### Phase 1. 여정 세션과 Live Activity 생명주기

예상: 1~2주

작업:

- `JourneyGuidanceSession`과 start/progress/arrive/stop API 추가
- 출발 전 job 종료와 여정 세션 시작을 분리
- 출발 시 Live Activity 종료 대신 `inTransit` 업데이트
- Live Activity 진행 상태 계약과 UI 확장
- 수동 시작·탑승·하차·종료 지원
- generation, routeRevision, event sequence fence 적용

완료 기준:

- 시뮬레이션 입력으로 출발 전부터 도착까지 Live Activity가 끊기지 않음
- 종료 뒤 늦은 update가 무시됨
- 기존 출발 알림 회귀 테스트 통과

### Phase 2. 전경 진행 엔진과 trace replay

예상: 2~3주

작업:

- 원본 route snapshot 정규화
- polyline projection과 현재 leg 계산
- stop proximity, heading, speed, hysteresis 적용
- 상태기계와 confidence 계산
- 자동 출발·도착, 수동 보정 구현
- 합성·익명 trace replay harness 구축

완료 기준:

- stale/out-of-order 위치 100% 무시
- reroute·사용자 보정 외 상태 역행 0
- 동일 milestone 중복 event 0
- GPS jump·저정확도·터널 무신호 시 안전하게 degrade

### Phase 3. 백그라운드 위치와 음성 안내

예상: 1~2주, Phase 2 후반과 병행 가능

작업:

- iOS background location 세션과 권한 UX
- `NoLateJourneyVoice` 네이티브 모듈
- 음성 queue, 우선순위, dedupe, cancel 구현
- 음악 ducking, 통화·Bluetooth interruption 처리
- 앱 재시작 시 활성 세션 복구
- 음성 설정과 반복 듣기 제공

완료 기준:

- 화면 잠금 중 핵심 안내가 계속 동작
- 음소거·안내 종료 뒤 5초 이내 위치·TTS 중단
- reroute/stop 뒤 과거 음성 재생 0
- TTS 불가 시 Live Activity·푸시로 정상 축소

### Phase 4. 활성 교통 구간과 안내 푸시

예상: 2~3주

작업:

- 활성/다음 ride 전용 arrival resolver
- freshness가 포함된 FE·BE 계약
- 공급자 실패와 빈 결과 분리
- adaptive polling, shared cache, quota 보호
- 신규 journey push 타입과 화면 이동 정책
- event TTL, logical key, recipient/session/route fence
- Live Activity와 일반 push 억제 정책

완료 기준:

- stale/unverified 값 기반 행동 안내 0
- 같은 event의 중복 푸시 0
- 종료·경로 변경 뒤 late push 0
- 현재/다음 ride 외 공급자 조회 없음

### Phase 5. 현장 베타와 운영 안정화

예상: 2~3주

작업:

- 실제 버스·지하철·도보·환승 경로 field test
- 잠금화면 60~90분, 터널, 네트워크 단절 검증
- 배터리·발열·API 호출량 측정
- 정확도와 prompt latency dashboard
- 기능별 kill switch와 운영 runbook
- 개인정보처리방침, 권한 설명, 스토어 제출 문구 확정
- 직원 → 제한 베타 → 점진 확대

완료 기준은 14절의 출시 게이트를 모두 충족하는 것이다.

### Phase 6. Android 동등 기능

예상: iOS 안정화 후 3~5주

작업:

- location foreground service
- 지속 길안내 notification
- Android `TextToSpeech`와 audio focus
- 제조사별 백그라운드 제한 대응
- iOS와 같은 state/event/freshness 계약 재사용

## 14. 테스트 및 출시 게이트

아래 수치는 파일럿용 초기 후보이며 실제 표본으로 조정한다.

### 14.1 자동 테스트

- 상태기계 unit test
- 합성 좌표와 기록 trace replay
- stale·out-of-order·GPS jump·저정확도 입력
- 지하철 무신호와 네트워크 단절
- event dedupe와 cooldown
- TTS queue 우선순위와 취소
- push redelivery, ACK retry, account switch
- session generation과 route revision fence
- Live Activity payload 크기·stale·terminal 처리
- 공급자 장애와 freshness fail-closed

### 14.2 실기기 행렬

- iPhone 실제 기기에서 APNs·ActivityKit·잠금화면
- Android 실제 기기에서 foreground service
- 화면 잠금 60~90분
- 앱 background와 process recreation
- 지하철 터널과 네트워크 단절
- 버스↔지하철 환승, 놓친 하차·환승
- Bluetooth·이어폰·음악·통화·무음모드
- 정확한 위치/대략적 위치/권한 거부
- 알림·Live Activity·음성 각각 비활성화

### 14.3 초기 후보 품질 게이트

- annotated checkpoint의 현재 leg 판정 정확도 95% 이상
- 핵심 하차·환승 안내의 경계 전 전달 99% 이상
- 이미 지난 행동을 지시하는 late prompt 0
- 동일 milestone의 동일 채널 중복 0
- 종료 뒤 위치·TTS·foreground service 잔존 0
- 동일 screen-off 기준 대비 추가 배터리 소모 median 5%p/h 이하, p90 8%p/h 이하
- GPS 샘플 단위 Live Activity·푸시 갱신 0

실측 표본이 충분하지 않으면 수치 달성을 선언하지 않고 `unmeasured`로 유지한다. 단위·통합
테스트 성공을 실제 이동 정확도 증거로 대체하지 않는다.

## 15. 관측성과 운영

권장 지표:

```text
journey.sessions(outcome)
journey.location.samples(outcome=accepted|stale|low_accuracy|jump)
journey.transitions(from|to|outcome)
journey.prompts(channel=voice|push|live_activity, outcome|reason)
journey.transition.latency
journey.voice.failures(reason)
journey.push.ack(stage)
journey.provider.requests(provider|outcome)
journey.sessions.stuck
```

모든 tag는 bounded enum만 사용한다. 위치나 사용자 식별 데이터를 metric tag 또는 일반
로그에 남기지 않는다.

기능 플래그:

- `journey.tracking`
- `journey.voice`
- `journey.push`
- `journey.liveActivityProgress`
- `journey.autoDeparture`
- `journey.autoArrival`

롤아웃 순서:

```text
shadow 판정
→ 내부 직원
→ 제한 TestFlight
→ 1%
→ 5%
→ 25%
→ 100%
```

각 단계에서 최소 24시간 동안 crash, stuck session, stale guidance, provider 실패, push ACK,
음성 실패, 배터리 지표를 확인한다. 이상이 있으면 관련 기능 플래그만 끄고 기존 출발 알림은
유지한다.

## 16. 위험과 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| 지하철 GPS 단절 | 현재 역 오판 | stop sequence·시간표 기반 보수적 추정, 낮은 confidence에서 구체 안내 금지 |
| 버스 도착정보 stale | 잘못된 승차 안내 | provider source timestamp 검증, TTL과 fail-closed |
| 푸시 지연 | 이미 지난 안내 표시 | `validUntil`과 session/leg fence |
| 중복 음성·푸시 | 사용자 불편 | 공통 eventKey, 채널별 dedupe와 cooldown |
| 배터리 과소모 | 기능 이탈·스토어 리스크 | 현재/다음 leg만 추적, 정확도·polling 동적 조절 |
| 공급자 quota 증가 | 서비스 장애 | 정류장·노선 공유 캐시, adaptive polling, circuit breaker |
| 위치 권한 거부 | 잠금 안내 불가 | 전경 전용·수동 모드로 degrade |
| 앱 강제 종료 | OS가 배경 작업을 중단 | 제품 문구로 한계 고지, 서버 푸시·Live Activity를 보조 경로로 유지 |
| 경로 변경 뒤 과거 안내 | 잘못된 행동 유도 | routeRevision 증가와 과거 queue/event 폐기 |
| 개인정보 정책 불일치 | 출시 차단 | local-first, 정책·권한 문구 개정 후 출시 |

## 17. 일정과 인력 추정

기존 Live Activity, 실시간 도착 API, 푸시 신뢰성 기반을 재사용한다는 전제다.

| 구성 | 기능 파일럿 | 안정화 베타 |
| --- | --- | --- |
| 모바일 1명 + 백엔드 1명 병렬 | 약 6~8주 | 약 9~12주 |
| 개발자 1명 순차 수행 | 약 9~12주 | 약 12~16주 |
| Android 동등 기능 | iOS 안정화 후 추가 3~5주 | 제조사별 실기기 검증 포함 |

가장 효율적인 병렬화:

- 모바일: Phase 1 Live Activity 계약 → Phase 2 위치 엔진 → Phase 3 TTS
- 백엔드: Phase 1 session/API → Phase 4 arrival resolver·push·cache
- 공통: 데이터 계약, trace fixture, freshness/fence 테스트

## 18. MVP 완료 정의

다음 조건을 모두 만족해야 iOS MVP를 완료로 본다.

- 출발 감지 또는 버튼으로 정확히 한 여정 세션이 시작된다.
- 출발 뒤 Live Activity가 종료되지 않고 `inTransit`으로 전환된다.
- 현재 구간과 다음 행동이 화면·Live Activity에서 일치한다.
- 하차·환승 핵심 음성이 잠금 상태에서 전달된다.
- 현재 승차 구간의 검증된 실시간 대기시간만 표시한다.
- stale·중복·종료 뒤 늦은 안내가 사용자에게 노출되지 않는다.
- 안내 종료 후 위치, TTS, 서버 job, Live Activity가 정리된다.
- 권한 거부·공급자 장애·TTS 실패 시 기능이 안전하게 축소된다.
- 개인정보 문서와 위치 사용 고지가 실제 동작과 일치한다.
- 자동 테스트와 실기기 출시 게이트를 통과한다.

## 19. 첫 번째 실행 묶음

구현을 시작할 때 첫 작업 묶음은 아래 순서로 제한한다.

1. `JourneyPhase`, `JourneyProgress`, `JourneyEvent` 계약 작성
2. 출발 완료와 Live Activity 종료의 결합 해제
3. `JourneyGuidanceSession` DB·API 뼈대
4. Live Activity `inTransit` preview fixture와 상태 UI
5. 원본 route snapshot 정규화와 trace fixture
6. 상태기계 순수 함수와 stale/out-of-order 테스트
7. 기능 플래그와 기존 출발 알림 회귀 테스트

이 묶음이 통과하기 전에는 백그라운드 위치, TTS, 고빈도 실시간 조회를 동시에 붙이지 않는다.
먼저 생명주기와 상태 계약을 고정해야 이후 채널이 같은 사실을 표시할 수 있다.


