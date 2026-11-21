"""Validate explicit actual service metadata; never infer timetable number aliases."""
import datetime as dt
import re


def station(value):
    if not isinstance(value, str):
        return ''
    value = re.sub(r'\([^)]*\)', '', value)
    value = re.sub(r'\s+', '', value)
    for suffix in ('종착', '방면', '행', '역'):
        value = value.removesuffix(suffix)
    return value


def observed_service(leg):
    timing = leg['rideTiming']
    service = timing.get('observedService')
    if service is None:
        if timing['basis'] in ('OBSERVED_SUBWAY_SERVICE_REALTIME', 'REPORTED_BOARDING_AND_ALIGHTING_REALTIME'):
            raise ValueError('Missing actual service identity')
        return None
    table = timing['timetable']
    names = [service.get(k) for k in ('terminalName', 'boardingStationName', 'alightingStationName')]
    stops = [station(name) for name in leg.get('orderedStopNames', [])]
    if (service.get('provider') != 'seoul-openapi' or leg['kind'] != 'SUBWAY' or
            any(service.get(k) != table.get(k) or not service.get(k) for k in
                ('line', 'serviceDate', 'directionCode', 'serviceClass')) or
            service.get('directionCode') not in ('UP', 'DOWN') or service.get('serviceClass') not in ('LOCAL', 'EXPRESS') or
            not re.fullmatch(r'[A-Z]?[0-9]{1,12}', service.get('trainNumber') or '') or
            not re.search('[1-9]', service['trainNumber']) or
            any(not isinstance(name, str) or not name.strip() or name != name.strip() or len(name) > 100 or
                any(ord(c) < 32 or ord(c) == 127 for c in name) for name in names) or
            not station(service['terminalName']) or station(service['terminalName']) != station(table.get('terminalName')) or
            service['boardingStationName'] != (leg.get('fromName') or '').strip() or
            service['alightingStationName'] != (leg.get('toName') or '').strip() or
            not 2 <= len(stops) <= 512 or not all(stops) or len(set(stops)) != len(stops) or
            (stops[0], stops[-1]) != tuple(station(n) for n in names[1:]) or
            timing['basis'] not in ('OBSERVED_SUBWAY_SERVICE_REALTIME', 'REPORTED_BOARDING_AND_ALIGHTING_REALTIME',
                                   'PLANNED_RIDE_BASELINE', 'PLANNED_RIDE_ALIGHTING_REALTIME')):
        raise ValueError('Conflicting actual service identity')
    dt.date.fromisoformat(service['serviceDate'])
    return service


def reported_boarding_evidence(leg, route, evaluated_at):
    """Validate a historical state without calling its old source a fresh forecast."""
    timing = leg['rideTiming']
    record = timing.get('reportedBoarding')
    if record is None:
        if timing['basis'] == 'REPORTED_BOARDING_AND_ALIGHTING_REALTIME':
            raise ValueError('Missing reported boarding state')
        return None
    def instant(value):
        parsed = dt.datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError('Missing evidence offset')
        return parsed
    source, checked, received = (instant(record[k]) for k in ('sourceUpdatedAt', 'checkedAt', 'recordedAt'))
    now = instant(evaluated_at) if isinstance(evaluated_at, str) else evaluated_at
    if (record['service'] != observed_service(leg) or record['routeIdentity'] != route['identity'] or
            instant(record['routeDepartureAt']) != instant(route['departureAt']) or record['segmentSequence'] != leg['sequence'] or
            source != instant(timing['predictedBoardingAt']) or source < instant(route['departureAt']) or
            not 0 <= (checked - source).total_seconds() <= 120 or
            not 0 <= (received - source).total_seconds() <= 120 or received > checked + dt.timedelta(seconds=5) or
            checked > now or received > now and checked != now or
            timing['basis'] not in ('REPORTED_BOARDING_AND_ALIGHTING_REALTIME', 'PLANNED_RIDE_BASELINE', 'PLANNED_RIDE_ALIGHTING_REALTIME') or
            timing.get('boardingObservationSourceUpdatedAt') is not None and
                instant(timing['boardingObservationSourceUpdatedAt']) != source or
            timing['basis'] == 'REPORTED_BOARDING_AND_ALIGHTING_REALTIME' and timing.get('boardingObservationSourceUpdatedAt') is None):
        raise ValueError('Detached or invalid historical boarding state')
    return record


def _prove_recorded_boarding(frames, current, leg, record, worker_finished_at):
    """Require the exact earlier captured ARRIVED row and its persisted result."""
    service = observed_service(leg)
    checked = dt.datetime.fromisoformat(record['checkedAt'])
    received = dt.datetime.fromisoformat(record['recordedAt'])
    source = dt.datetime.fromisoformat(record['sourceUpdatedAt'])
    previous = [f for f in frames if dt.datetime.fromisoformat(f['evaluatedAt']) == checked]
    if len(previous) != 1 or received > worker_finished_at:
        return False
    frame, = previous
    if (frame.get('incomplete') or frame.get('departurePlan') != current.get('departurePlan') or
            record not in (frame.get('result') or {}).get('reportedBoardings', []) or
            frame is not current and record not in (current.get('previousUpdate') or {}).get('reportedBoardings', [])):
        return False
    reads = [r for r in frame['stations'] if station(r['station']) == station(leg['fromName']) and
             r['line'] == {'LINE_2': '2호선', 'LINE_4': '4호선'}.get(service['line']) and r['directionCode'] == service['directionCode']]
    if len(reads) != 1:
        return False
    rows = [r for r in reads[0]['rows'] if r.get('trainNumber') == service['trainNumber'] and
            station(r.get('stationName')) == station(leg['fromName']) and
            r.get('subwayLineId') == {'LINE_2': '1002', 'LINE_4': '1004'}.get(service['line'])]
    if not rows or max(dt.datetime.fromisoformat(r['sourceUpdatedAt']) for r in rows) != source:
        return False
    latest = [r for r in rows if dt.datetime.fromisoformat(r['sourceUpdatedAt']) == source]
    return all(r.get('provider') == 'seoul-openapi' and r.get('kind') == 'SUBWAY' and r.get('realtime') is True and
               r.get('freshnessEvidence') == 'PROVIDER_SOURCE_TIMESTAMP' and r.get('arrivalStatus') == 'ARRIVED' and
               r.get('waitSeconds') == 0 and dt.datetime.fromisoformat(r['expectedAt']) == source and
               dt.datetime.fromisoformat(r['observedAt']) == received and
               station(r.get('destinationName')) == station(service['terminalName']) and
               r.get('express') == (service['serviceClass'] == 'EXPRESS') and
               any(word in (r.get('direction') or '') for word in
                   (('상행', '내선') if service['directionCode'] == 'UP' else ('하행', '외선'))) for r in latest)


def selected_train_number(leg):
    service = observed_service(leg)
    return service['trainNumber'] if service else leg['rideTiming']['timetable']['trainNumber']


def fresh_observed_service_connection(worker, observation):
    """Prove newly bound pairs against this exact refresh's captured endpoint rows, using HTTP zero."""
    try:
        if (observation or {}).get('basis') != 'OBSERVED_SERVICE_CONNECTION':
            return None
        now = dt.datetime.fromisoformat(worker['evaluatedAt'])
        frames = (worker.get('plannedRefreshReplay') or {}).get('frames', [])
        count = worker.get('historyCount')
        # 이 격리 실행은 첫 평가에 계획을 만들고 이후 평가마다 refresh를 한 번 기록한다.
        # refresh의 evaluatedAt은 시작시각, Worker의 evaluatedAt은 저장 완료시각이므로
        # 시각의 동등성 대신 현재 평가 번호·마지막 프레임·저장된 결과를 함께 대조한다.
        if type(count) is not int or count not in (2, 3) or len(frames) != count - 1:
            return None
        starts = [dt.datetime.fromisoformat(f['evaluatedAt']) for f in frames]
        if any(a >= b for a, b in zip(starts, starts[1:])) or starts[-1] > now:
            return None
        frame = frames[-1]
        decision_at = starts[-1]
        snapshot = worker['effectiveSnapshot']
        original = snapshot['inProgressPlannedRoute']
        if (frame.get('incomplete') or frame.get('departurePlan') != original or
                frame.get('result') != snapshot.get('plannedRouteUpdate') or
                any(frame['plan'].get(key) != original.get(key) for key in ('identity', 'provider', 'departureAt')) or
                (frame.get('result') or {}).get('route') != observation['effectiveTransitRoute']):
            return None
        selected = []
        for leg in observation['effectiveTransitRoute']['segments']:
            timing = leg.get('rideTiming') or {}
            if timing.get('basis') not in ('OBSERVED_SUBWAY_SERVICE_REALTIME', 'REPORTED_BOARDING_AND_ALIGHTING_REALTIME') and not (
                    timing.get('basis') == 'PLANNED_RIDE_ALIGHTING_REALTIME' and timing.get('reportedBoarding')):
                continue
            service = observed_service(leg)
            historical = reported_boarding_evidence(leg, observation['effectiveTransitRoute'], decision_at)
            if historical and not _prove_recorded_boarding(frames, frame, leg, historical, now):
                return None
            endpoints = (
                    (leg['fromName'], 'predictedBoardingAt', 'boardingObservationSourceUpdatedAt'),
                    (leg['toName'], 'predictedArrivalAt', 'observationSourceUpdatedAt'))
            for name, expected_field, source_field in endpoints[1:] if historical else endpoints:
                source = dt.datetime.fromisoformat(timing[source_field])
                expected = dt.datetime.fromisoformat(timing[expected_field])
                if (not -5 <= (now - source).total_seconds() <= 120 or
                        not -5 <= (decision_at - source).total_seconds() <= 120 or expected <= now):
                    return None
                read = [r for r in frame['stations'] if station(r['station']) == station(name) and
                        r['line'] == {'LINE_2': '2호선', 'LINE_4': '4호선'}.get(service['line']) and
                        r['directionCode'] == service['directionCode']]
                if len(read) != 1:
                    return None
                def matches(row):
                    direction = row.get('direction') or ''
                    direction_matches = any(word in direction for word in
                        (('상행', '내선') if service['directionCode'] == 'UP' else ('하행', '외선')))
                    if (row.get('provider') != 'seoul-openapi' or row.get('kind') != 'SUBWAY' or row.get('realtime') is not True or
                            row.get('trainNumber') != service['trainNumber'] or station(row.get('stationName')) != station(name) or
                            row.get('subwayLineId') != {'LINE_2': '1002', 'LINE_4': '1004'}.get(service['line']) or
                            not direction_matches or station(row.get('destinationName')) != station(service['terminalName']) or
                            row.get('express') != (service['serviceClass'] == 'EXPRESS') or
                            row.get('freshnessEvidence') != 'PROVIDER_SOURCE_TIMESTAMP' or
                            row.get('arrivalStatus') not in ('APPROACHING', 'ARRIVED', 'PREVIOUS_STOP', 'IN_TRANSIT') or
                            dt.datetime.fromisoformat(row['sourceUpdatedAt']) != source):
                        return False
                    direct = dt.datetime.fromisoformat(row['expectedAt']) if row.get('expectedAt') else None
                    wait = row.get('waitSeconds')
                    if wait is not None and (type(wait) is not int or wait < 0):
                        return False
                    from_wait = source + dt.timedelta(seconds=wait) if wait is not None else None
                    if historical and (not row.get('observedAt') or dt.datetime.fromisoformat(row['observedAt']) > now):
                        return False
                    return (direct or from_wait) == expected and (direct is None or from_wait is None or direct == from_wait)
                same_vehicle = [row for row in read[0]['rows'] if row.get('trainNumber') == service['trainNumber'] and
                                station(row.get('stationName')) == station(name) and
                                row.get('subwayLineId') == {'LINE_2': '1002', 'LINE_4': '1004'}.get(service['line'])]
                if not same_vehicle:
                    return None
                newest = max(dt.datetime.fromisoformat(row['sourceUpdatedAt']) for row in same_vehicle)
                latest = [row for row in same_vehicle if dt.datetime.fromisoformat(row['sourceUpdatedAt']) == newest]
                if not all(matches(row) for row in latest):
                    return None
            selected.append(dict(sequence=leg['sequence'], trainNumber=service['trainNumber'],
                comparisonTimetableTrainNumber=timing['timetable']['trainNumber'],
                predictedBoardingAt=timing['predictedBoardingAt'], predictedAlightingAt=timing['predictedArrivalAt'],
                **({'reportedBoarding': historical} if historical else {})))
        return {'classification': ('REPORTED_BOARDING_AND_FRESH_ALIGHTING_NOT_PASSENGER_CONFIRMATION'
                                  if any('reportedBoarding' in service for service in selected) else
                                  'TWO_ENDPOINT_ACTUAL_SERVICE_CONNECTION_NOT_TIMETABLE_ALIAS'), 'services': selected,
                'refreshEvaluatedAt': frame['evaluatedAt'], 'workerFinishedAt': worker['evaluatedAt'],
                'historyCount': count, 'physicalArrivalVerified': False} if selected else None
    except (KeyError, TypeError, ValueError):
        return None
