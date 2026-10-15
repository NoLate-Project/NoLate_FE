"""Independent expected UI warnings for rejected actual-provider evaluations."""


def diagnostic_warning(failure_reason):
    # Distinct failures intentionally have distinct user guidance. A late route
    # must not be mistaken for a generic saved-route fallback by the UI test.
    code = failure_reason.split(':', 1)[0]
    return {
        'TRANSIT_TRAIN_NOT_YET_OBSERVED': '미래 열차 실시간 미확인 · 시간표 예측 단계',
        'TRANSIT_ON_TIME_ARRIVAL_UNAVAILABLE': '현재 확인된 경로로 정시 도착 불가',
        'TRANSIT_TRANSFER_MISSED': '환승 불가 · 경로 재확인 필요',
        'TRANSIT_ITINERARY_REFRESH_UNSUPPORTED': '재조회 미지원 · 경로 재선택 필요',
        'TRANSIT_INTERCITY_TIMETABLE_UNAVAILABLE': '시외 운행시각 미확인 · 예매편 확인 필요',
        'TRANSIT_ARRIVAL_SOURCE_STALE': '차량 관측정보 오래됨 · 저장 경로 기준',
        'TRANSIT_ARRIVAL_SOURCE_UNVERIFIED': '차량 관측시각 검증 불가 · 저장 경로 기준',
        'TRANSIT_ARRIVAL_RATE_LIMITED': '도착정보 API 한도 초과 · 저장 경로 기준',
        'TRANSIT_ARRIVAL_API_TIMEOUT': '도착정보 API 응답 지연 · 저장 경로 기준',
        'TRANSIT_ARRIVAL_API_ERROR': '도착정보 API 오류 · 저장 경로 기준',
        'TRANSIT_ARRIVAL_UNAVAILABLE': '실시간 도착정보 없음 · 저장 경로 기준',
        'TRANSIT_ARRIVAL_OUT_OF_HORIZON': '실시간 조회 범위 밖 · 저장 경로 기준',
    }.get(code, '운행시각 미확인 · 저장 경로 기준')
