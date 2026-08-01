# 빠른 일정 원본 미디어 신뢰도 검증

서버의 추출 텍스트 벤치마크와 별도로, 릴리스 후보 앱에서 원본 사진·음성을 실제로 통과시킨 종단 간 결과를 측정한다. 개인정보가 들어간 원본 미디어와 정답지는 저장소에 커밋하지 않는다.

## 릴리스 기준

- TEXT, PHOTO, VOICE 각각 300건 이상
- 사진·음성은 iOS와 Android 각각 100건 이상 포함
- 날짜·시간·목적지가 동시에 맞는 비율: 전체, 채널별, Android/iOS 미디어별 모두 **95% Wilson 신뢰구간 하한이 90% 이상**
- `HIGH` 표시 결과도 정밀도의 95% Wilson 하한이 90% 이상이며 잘못된 `HIGH` 결과는 0건
- 표시 신뢰도와 실제 정답률의 expected calibration error 10% 이하
- 조도, 기울기, 회전, 흐림, 작은 글씨, 소음, 억양, 빠른 발화, 숫자·상대 날짜를 층화해 포함

## 결과 JSONL 계약

한 줄에 한 표본을 기록한다. `mediaAssetId`는 비공개 데이터셋의 임의 ID이며 파일 경로나 원문은 결과 파일에 넣지 않는다.

```json
{"id":"photo-a-0001","mediaAssetId":"opaque-0001","channel":"PHOTO","platform":"ANDROID","expected":{"date":"2026-08-03","time":"19:00","destination":"강남역"},"actual":{"date":"2026-08-03","time":"19:00","destination":"강남역"},"confidence":{"overall":0.94,"level":"HIGH","recognition":0.92},"attemptCount":2,"appVersion":"1.2.0","confidenceVersion":"quick-schedule-v1"}
```

TEXT 표본도 같은 계약을 쓰며 `platform`은 실제 실행 플랫폼을 기록한다. PHOTO/VOICE의 `actual`은 네이티브 인식 결과를 서버 파서에 전달한 최종 미리보기 값이어야 한다.

## 실행

1. 릴리스 후보 빌드를 iOS·Android 실기기에 설치한다. 측정 전용 RC는 `EXPO_PUBLIC_ENABLE_QUICK_SCHEDULE_BENCHMARK=true`로 빌드하고, 일반 운영 빌드에서는 이 값을 넣지 않는다. 개발 빌드는 별도 설정 없이 활성화된다.
2. 로그인 후 `nolate://internal/quick-schedule-benchmark` 딥링크를 연다. Android는 `adb shell am start -a android.intent.action.VIEW -d nolate://internal/quick-schedule-benchmark`, iOS Simulator는 `xcrun simctl openurl booted nolate://internal/quick-schedule-benchmark`로 열 수 있다. 실기기는 Safari/Chrome 주소 입력 또는 QA용 딥링크로 연다.
3. 비공개 정답 manifest JSON을 붙여넣는다. 러너가 TEXT는 자동 분석하고, PHOTO는 표시된 `mediaAssetId`에 해당하는 사진을 선택받아 운영 OCR을 실행하며, VOICE는 표시 문장을 운영 실시간 음성 인식으로 수집한다.
4. 각 표본의 사용자 수정 전 날짜·시간·목적지, OCR 시도 횟수, 서버 신뢰도가 단말에 체크포인트로 저장된다. 완료 후 `JSONL 내보내기`로 공유한다. 결과에는 원문, 전사문, 파일 URI가 포함되지 않는다.
5. 다음 명령이 성공해야 출시할 수 있다.

```sh
npm run evaluate:quick-schedule-media -- /secure/path/results.jsonl
```

manifest 형식은 다음과 같다. `referenceDate`를 넣으면 상대 날짜 표본을 반복 가능하게 측정할 수 있다.

```json
{
  "version": 1,
  "cases": [
    {
      "id": "text-0001",
      "channel": "TEXT",
      "sourceText": "내일 오후 3시 강남역 회의",
      "referenceDate": "2026-08-01",
      "expected": { "date": "2026-08-02", "time": "15:00", "destination": "강남역" }
    },
    {
      "id": "photo-a-0001",
      "channel": "PHOTO",
      "mediaAssetId": "opaque-photo-0001",
      "expected": { "date": "2026-08-03", "time": "19:00", "destination": "서울역" }
    },
    {
      "id": "voice-a-0001",
      "channel": "VOICE",
      "mediaAssetId": "opaque-voice-0001",
      "prompt": "8월 4일 오후 두 시 코엑스 전시 일정 추가해줘",
      "referenceDate": "2026-08-01",
      "expected": { "date": "2026-08-04", "time": "14:00", "destination": "코엑스" }
    }
  ]
}
```

소규모 예제 파일은 통계 신뢰도를 증명하지 못한다. 러너/JSONL 계약만 점검할 때는 다음처럼 검증 전용 모드를 쓴다.

```sh
npm run evaluate:quick-schedule-media -- quality/quick-schedule-media-results.example.jsonl --validate-only
```

기본 300건 채널에서는 281건 이상이 정확해야 Wilson 하한 90%를 넘는다. 30/30의 단순 100%도 하한은 약 88.6%이므로 운영 인증으로 통과하지 않는다.

운영 분석에는 서버의 90일 content-free telemetry를 사용한다. 원본 미디어, OCR/STT 원문, 제목, 메모, 장소명은 서버 품질 로그에 저장하지 않는다.
