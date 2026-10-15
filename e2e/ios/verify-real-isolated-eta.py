#!/usr/bin/env python3
"""Audit actual-feed isolated Worker -> API -> installed app, not map/trip accuracy."""
import argparse
import datetime as dt
import importlib.util
import json
import math
from pathlib import Path
import subprocess
from eta_timetable_preview import preview_exclusion

DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'
walking_spec = importlib.util.spec_from_file_location('walking_audit', Path(__file__).with_name('verify-eta-walking-boundaries.py'))
walking_audit = importlib.util.module_from_spec(walking_spec)
walking_spec.loader.exec_module(walking_audit)

def instant(value):
    result = dt.datetime.fromisoformat(value)
    assert result.tzinfo is not None
    return result


def missing_ui_result(worker):
    # Missing an app result is not a provider rejection if the Worker accepted it.
    accepted = (worker.get('source') == 'LIVE_PROVIDER' and worker.get('stale') is False
                and worker.get('failureReason') is None
                and (worker.get('effectiveSnapshot') or {}).get('accepted') is True)
    return 'ACCEPTED_UI_NOT_VERIFIED' if accepted else 'NOT_ACCEPTED'


def verification_exit_code(result):
    # A completed diagnostic execution is not a completed E2E acceptance gate.
    return 0 if result['result'] == 'PASSED' else 1


def longest_accepted_ui_streak(results):
    # Two successes separated by a degraded/missing UI evaluation do not prove
    # consecutive stability. Missing evaluation numbers also break the streak.
    longest = streak = 0
    previous = None
    for item in results:
        index = int(item['index'])
        assert index > 0 and (previous is None or index > previous)
        if item['result'] == 'PASSED':
            streak = streak + 1 if previous is not None and index == previous + 1 else 1
        else:
            streak = 0
        longest = max(longest, streak)
        previous = index
    return longest


def verify_evaluation_cadence(previous, worker):
    # Audit persisted due times independently of the runner's own assertions.
    assert worker['targetArrivalAt'] == previous['targetArrivalAt']
    assert worker['memberId'] == previous['memberId'] == 296
    assert worker['scheduleId'] == previous['scheduleId'] == 363
    assert worker['journeyProvider'] == previous['journeyProvider']
    assert worker['historyCount'] == previous['historyCount'] + 1
    assert instant(worker['evaluatedAt']) >= instant(previous['nextCheckAt'])


def verify_expired_observation_read(worker, public):
    """A read-time diagnostic must not be recorded as a failed Worker evaluation."""
    assert worker['source'] == 'LIVE_PROVIDER' and worker['stale'] is False
    assert worker['failureReason'] is None and worker['effectiveSnapshot']['accepted'] is True
    observation = worker['effectiveSnapshot']['firstBoardingObservation']
    expiry = max(instant(observation[k]) for k in ('sourceUpdatedAt', 'evaluatedAt')) + dt.timedelta(seconds=120)
    window = public['_isolationReadWindow']
    start, end = instant(window['startedAt']), instant(window['finishedAt'])
    assert expiry < start <= end and (end - start).total_seconds() <= 10
    assert worker['scheduleId'] == public['scheduleId'] == 363
    assert public['source'] == worker['source'] and public['stale'] is True and public['confidence'] == 'LOW'
    assert public['failureReason'].startswith('TRANSIT_ARRIVAL_SOURCE_STALE:')
    for key in ('recommendedDepartureAt', 'travelMinutes', 'evaluatedAt'):
        assert public[key] == worker[key]
    for key in ('predictedArrivalAt', 'onTimeArrivalPossible', 'effectiveTransitRoute',
                'transitTimingBasis', 'firstBoardingWaitMinutes', 'firstBoardingObservation', 'futureTimetablePrediction'):
        assert public[key] is None
    assert public['routeChanged'] is False
    return {'result': 'PASSED', 'classification': 'READ_TIME_OBSERVATION_EXPIRY_NOT_NEW_WORKER_EVALUATION',
            'workerRemainsAccepted': True, 'protectedDeparturePreserved': True,
            'expiredLiveJourneyHidden': True, 'actualReadStartedAt': window['startedAt']}


def verify_future_visibility(worker, public, route):
    # evaluatedAt is a lower bound for the later API read. A preview already
    # departed, or arriving after the frozen target, must remain hidden.
    if preview_exclusion(worker, route) is not None:
        assert public['futureTimetablePrediction'] is None
        return False
    window = public.get('_isolationReadWindow')
    if window is not None:
        start, end = instant(window['startedAt']), instant(window['finishedAt'])
        assert instant(worker['evaluatedAt']) <= start <= end
        assert (end - start).total_seconds() <= 10
        departure = instant(route['departureAt'])
        if public['futureTimetablePrediction'] is None:
            # API 평가 도중 경계를 넘었을 수도 있다. 실제 조회 끝보다 출발이 과거인
            # 경우만 만료를 허용하며, 시간 증거 없는 누락은 여전히 실패한다.
            assert departure < end
            return False
        assert departure >= start
    assert public['futureTimetablePrediction'] == route
    return True


def verify_diagnostic_values(worker, public, seed, selected):
    """Actual ODsay rejection delivered to the app; never a normal ETA success."""
    assert worker['classification'] == 'REAL_PROVIDER_ISOLATED_WORKER'
    assert worker['database'] == 'H2_MEMORY_ONLY' and worker['providersMocked'] is False
    assert worker['clockMode'] == 'SYSTEM_WALL_CLOCK' and worker['journeyProvider'] == 'odsay'
    assert worker['memberId'] == 296 and worker['scheduleId'] == public['scheduleId'] == 363
    assert worker['processed'] == 1 and type(worker['historyCount']) is int and worker['historyCount'] >= 1
    assert worker['stale'] is public['stale'] is True and worker['failureReason']
    assert (worker.get('effectiveSnapshot') or {}).get('accepted') is not True
    for key in ('source', 'failureReason', 'recommendedDepartureAt', 'predictedArrivalAt', 'travelMinutes'):
        assert worker[key] == public[key]
    assert (public.get('effectiveTransitRoute') or {}).get('provider') in (None, 'odsay')
    verify_odsay_selection(seed, selected)
    future_verified = False
    timetable_verified = False
    if worker['source'] == 'TIMETABLE_PROVIDER':
        route = worker['effectiveSnapshot']['effectiveTransitRoute']
        assert worker['effectiveSnapshot']['transitTimingBasis'] == 'TIMETABLE_ONLY'
        # Public fresh-ETA fields remain closed; the timetable-only route is separate.
        assert public['transitTimingBasis'] is None
        assert public['effectiveTransitRoute'] is None
        assert worker['predictedArrivalAt'] is None
        verify_odsay_selection(seed, selected, route)
        for ride in [s for s in route['segments'] if s['kind'] == 'SUBWAY']:
            timing = ride['rideTiming']
            assert timing['basis'] == 'TIMETABLE' and timing['timetable']['provider'] == 'seoul-timetable'
            assert timing['predictedBoardingAt'] == timing['timetable']['boardingAt']
            assert timing['predictedArrivalAt'] == timing['timetable']['arrivalAt']
        assert verify_odsay_minute_walking(route)['timingResult'] == 'PASSED'
        timetable_verified = True
    if worker['failureReason'].startswith('TRANSIT_TRAIN_NOT_YET_OBSERVED:'):
        assert timetable_verified
        future_verified = verify_future_visibility(worker, public, route)
    else:
        # Late/failed journeys must not reappear as an eligible future preview.
        assert public.get('futureTimetablePrediction') is None
    return {'evaluatedAt': worker['evaluatedAt'], 'failureCode': worker['failureReason'].split(':')[0],
            'journeyProvider': 'odsay', 'selectedProviderIdsPreserved': True,
            'futureTimetablePredictionVerified': future_verified,
            'expiredTimetablePreviewHidden': (timetable_verified and public.get('futureTimetablePrediction') is None and
                (instant(route['departureAt']) < instant(worker['evaluatedAt']) or
                 ('_isolationReadWindow' in public and instant(route['departureAt']) <
                  instant(public['_isolationReadWindow']['finishedAt'])))),
            'futurePreviewExclusion': preview_exclusion(worker, route) if timetable_verified else None,
            'timetableJourneyVerified': timetable_verified,
            'acceptedEtaVerified': False, 'stationInteriorCoverageVerified': False}


def verify_odsay_selection(seed, selected, route=None):
    assert seed['provider'] == selected['provider'] == selected['routeInfo']['provider'] == 'odsay'
    assert selected['providerTimeBasis'] == 'route_estimate'
    rides = [leg for leg in seed['legs'] if leg['mode'] == 'SUBWAY']
    saved = [leg for leg in selected['transitLegs'] if leg['kind'] == 'SUBWAY']
    assert len(rides) == len(saved) == 2
    assert [(leg['from']['name'], leg['to']['name']) for leg in rides] == [('노원', '사당'), ('사당', '신림')]
    for before, after in zip(rides, saved):
        assert before['from']['providerStopId'] == after['startID']
        assert before['to']['providerStopId'] == after['endID']
        assert before['line']['providerRouteId'] == after['providerRouteId']
    if route is not None:
        effective = [s for s in route['segments'] if s['kind'] == 'SUBWAY']
        assert route['provider'] == 'odsay' and len(effective) == len(rides)
        for before, after in zip(rides, effective):
            assert (after['fromName'], after['toName']) == (before['from']['name'], before['to']['name'])
            assert after['lineName'] == before['line']['name']
            table = after['rideTiming']['timetable']
            assert table['line'] == before['line']['seoulSubwayLine']
            if before['directionCode'] is not None:
                assert table['directionCode'] == before['directionCode']
            else:
                # Circular-line direction is proven by Seoul's same-train next-stop order,
                # never by copying ODsay wayCode into INOUT_TAG.
                assert before['line']['seoulSubwayLine'] == 'LINE_2' and before['nextStopName']
            assert table['serviceClass'] == before['line']['serviceClass']

def verify_walking_diagnostics(value):
    """Safe optional-refinement telemetry is distinct from normal ETA acceptance."""
    assert set(value) == {'provider', 'httpCalls', 'cacheHits', 'unavailableCalls', 'cacheEntries',
                          'failureCounts', 'lastFailure'}
    assert value['provider'] == 'odsay-walking'
    for field in ('httpCalls', 'cacheHits', 'unavailableCalls', 'cacheEntries'):
        assert type(value[field]) is int and value[field] >= 0
    assert value['cacheEntries'] <= 256
    allowed = {'HTTP_AUTH', 'HTTP_QUOTA', 'HTTP_SERVER', 'HTTP_CLIENT', 'PROVIDER_APPLICATION_ERROR',
               'EMPTY_RESPONSE', 'INVALID_RESPONSE', 'PATH_COUNT_MISMATCH', 'NO_PATH', 'ENDPOINT_MISMATCH',
               'DISTANCE_MISMATCH', 'DURATION_MISMATCH', 'LINK_COUNT_MISMATCH', 'LINK_DISTANCE_MISMATCH',
               'LINK_COORDINATES_MISMATCH', 'TIMEOUT', 'TRANSPORT', 'DEADLINE', 'CIRCUIT_OPEN', 'BULKHEAD',
               'INTERRUPTED', 'UNEXPECTED'}
    failures = value['failureCounts']
    assert set(failures) <= allowed
    assert all(type(count) is int and count > 0 for count in failures.values())
    assert sum(failures.values()) == value['unavailableCalls']
    last = value['lastFailure']
    assert set(last) == {'reason', 'observedAt', 'httpStatus', 'providerCode'}
    if failures:
        assert last['reason'] in failures
        instant(last['observedAt'])
        assert last['httpStatus'] is None or (type(last['httpStatus']) is int and 400 <= last['httpStatus'] <= 599)
        code = last['providerCode']
        assert code is None or (isinstance(code, str) and 1 <= len(code.lstrip('-')) <= 6
                                and code.lstrip('-').isascii() and code.lstrip('-').isdigit()
                                and '-' not in code[1:])
    else:
        assert all(item is None for item in last.values())
    return {'result': 'PASSED', 'httpCalls': value['httpCalls'], 'rejectedRefinements': value['unavailableCalls'],
            'failureCounts': failures, 'lastFailure': last,
            'optionalFailureIsNotNormalEtaFailure': True}


def verify_values(worker, public):
    assert worker['classification'] == 'REAL_PROVIDER_ISOLATED_WORKER'
    assert worker['database'] == 'H2_MEMORY_ONLY' and worker['providersMocked'] is False
    assert worker['clockMode'] == 'SYSTEM_WALL_CLOCK'
    assert worker['memberId'] == 296 and worker['scheduleId'] == public['scheduleId'] == 363
    assert worker['processed'] == 1 and worker['source'] == public['source'] == 'LIVE_PROVIDER'
    assert worker['stale'] is public['stale'] is False
    assert worker['failureReason'] is public['failureReason'] is None
    snapshot = worker['effectiveSnapshot']
    assert snapshot['accepted'] is True
    assert snapshot['transitTimingBasis'] == public['transitTimingBasis'] == 'FIRST_BOARDING_REALTIME_FUTURE_TIMETABLE'
    route = snapshot['effectiveTransitRoute']
    provider = worker.get('journeyProvider', 'tmap')
    assert provider in ('tmap', 'odsay')
    assert route['provider'] == public['effectiveTransitRoute']['provider'] == provider
    assert public['effectiveTransitRoute'] == route
    assert instant(worker['recommendedDepartureAt']) == instant(public['recommendedDepartureAt'])
    assert instant(worker['predictedArrivalAt']) == instant(public['predictedArrivalAt']) == instant(route['arrivalAt'])
    assert instant(worker['predictedArrivalAt']) <= instant(worker['targetArrivalAt'])
    assert worker['travelMinutes'] == public['travelMinutes'] == route['totalMinutes']
    observation = snapshot['firstBoardingObservation']
    # The Worker may retain an earlier safe alert time instead of postponing it.
    # Do not conflate that alert recommendation with the new journey's departure.
    route_departure = instant(route['departureAt'])
    recommendation = instant(worker['recommendedDepartureAt'])
    assert recommendation <= route_departure
    assert route_departure == instant(observation['departureAt'])
    assert observation['provider'] == 'seoul-openapi' and observation['trainNumber']
    age = (instant(observation['evaluatedAt']) - instant(observation['sourceUpdatedAt'])).total_seconds()
    assert -60 <= age <= 120
    assert instant(observation['readyAt']) <= instant(observation['expectedBoardingAt'])
    assert instant(observation['evaluatedAt']) <= instant(worker['evaluatedAt']) + dt.timedelta(seconds=15)
    rides = [s['rideTiming'] for s in route['segments'] if s['kind'] == 'SUBWAY']
    assert len(rides) >= 2
    for index, timing in enumerate(rides):
        table = timing['timetable']
        assert table['provider'] == 'seoul-timetable' and table['trainNumber']
        assert table['directionCode'] in ('UP', 'DOWN') and table['serviceClass'] in ('LOCAL', 'EXPRESS')
        assert table['fromStationCode'] and table['toStationCode'] and table['fromStationCode'] != table['toStationCode']
        assert instant(table['fetchedAt']) <= instant(worker['evaluatedAt']) + dt.timedelta(seconds=15)
        boarding, arrival = instant(timing['predictedBoardingAt']), instant(timing['predictedArrivalAt'])
        raw_boarding, raw_arrival = instant(table['boardingAt']), instant(table['arrivalAt'])
        assert raw_arrival > raw_boarding and arrival - boarding == raw_arrival - raw_boarding
        if index == 0:
            assert timing['basis'] == 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE'
            assert observation['trainNumber'] in (table['trainNumber'], table.get('realtimeTrainNumber'))
            assert boarding == instant(observation['expectedBoardingAt'])
        else:
            assert timing['basis'] == 'TIMETABLE' and boarding == raw_boarding and arrival == raw_arrival
    walks = [s for s in route['segments'] if s['kind'] == 'WALK']
    assert {s['walkingScope'] for s in walks} == {'ACCESS', 'TRANSFER', 'EGRESS'}
    # Current real-feed runs must carry the new metadata through snapshot/API equality above.
    # A polyline or an entrance mention must not be upgraded to platform coverage.
    for walk in walks if provider == 'tmap' else []:
        assert walk['durationSeconds'] is not None and walk['durationSeconds'] >= 0
        geometry = walk['walkingGeometry']
        assert geometry['endpointBasis'] == 'PROVIDER_LEG_ENDPOINTS'
        evidence = geometry['pathEvidence']
        assert evidence['provider'] == 'tmap' and evidence['stationInteriorCoverage'] == 'UNKNOWN'
        assert evidence['status'] in ('PROVIDED', 'UNAVAILABLE', 'INVALID', 'LIMIT_EXCEEDED')
        assert bool(evidence['steps']) == (evidence['status'] == 'PROVIDED')
    # Exact seconds/ride timestamps must balance before this UI run can count as accepted.
    # A pass here confirms arithmetic only, never entrance/platform coverage or map accuracy.
    walking = walking_audit.audit_route(route) if provider == 'tmap' else verify_odsay_minute_walking(route)
    assert walking['timingResult'] == 'PASSED'
    return {'evaluatedAt': worker['evaluatedAt'], 'recommendedDepartureAt': worker['recommendedDepartureAt'],
            'effectiveRouteDepartureAt': route['departureAt'],
            'recommendationLeadSeconds': (route_departure - recommendation).total_seconds(),
            'predictedArrivalAt': worker['predictedArrivalAt'], 'travelMinutes': worker['travelMinutes'],
            'trainNumber': observation['trainNumber'], 'sourceAgeSeconds': age, 'rides': rides,
            'journeyProvider': provider,
            'walkingMetadataPreserved': True, 'stationInteriorCoverageVerified': False,
            'walkingBoundaryAudit': walking}


def verify_odsay_minute_walking(route):
    """Audit minute fallback / explicit full-path WALK seconds without assuming platform coverage."""
    segments = route['segments']
    assert [s['sequence'] for s in segments] == list(range(len(segments)))
    cursor = instant(route['departureAt'])
    ride_indices = [i for i, s in enumerate(segments) if s['kind'] == 'SUBWAY']
    assert len(ride_indices) >= 2
    walking_minutes = 0
    refined_seconds = []
    previous_arrival = None
    pending_walk = 0
    for index, segment in enumerate(segments):
        if segment['kind'] == 'WALK':
            minutes = segment['durationMinutes']
            assert type(minutes) is int and minutes >= 0
            seconds = segment.get('durationSeconds')
            timing_evidence = segment.get('walkingTiming')
            if seconds is not None:
                assert type(seconds) is int and seconds > 0 and math.ceil(seconds / 60) == minutes
                assert type(timing_evidence) is dict
                assert timing_evidence['source'] == 'ODSAY_FULL_PATH_SECONDS'
                assert timing_evidence['sameOrderedPathVerified'] is True
                assert timing_evidence['movementSeconds'] == seconds
                assert instant(timing_evidence['fetchedAt']) <= instant(route['departureAt'])
                assert timing_evidence['originalDurationMinutes'] == minutes
                refined_seconds.append(seconds)
            else:
                seconds = minutes * 60
                if timing_evidence is not None:
                    assert timing_evidence['source'] == 'ROUTE_MINUTES'
                    assert timing_evidence['movementSeconds'] == seconds
            if timing_evidence and timing_evidence.get('transferReference'):
                reference = timing_evidence['transferReference']
                assert reference['application'] == 'REFERENCE_ONLY_DIRECTION_AND_PATH_UNVERIFIED'
                assert reference['provider'] == 'seoulmetro' and reference['datasetDate'] == '2025-03-31'
            geometry = segment.get('walkingGeometry')
            if geometry is not None:
                assert geometry['endpointBasis'] == 'UNKNOWN'
                assert geometry.get('from') is None and geometry.get('to') is None
                meters = geometry.get('distanceMeters')
                assert meters is None or (type(meters) is int and meters >= 0)
                evidence = geometry.get('pathEvidence')
                assert type(evidence) is dict
                assert evidence['provider'] == 'odsay' and evidence['stationInteriorCoverage'] == 'UNKNOWN'
                assert evidence['status'] in ('PROVIDED', 'UNAVAILABLE', 'INVALID', 'LIMIT_EXCEEDED')
                steps = evidence['steps']
                assert type(steps) is list and len(steps) <= 32
                assert bool(steps) == (evidence['status'] == 'PROVIDED')
                count = 0
                for step in steps:
                    points = step['coordinates']
                    assert type(points) is list and 2 <= len(points) <= 128
                    count += len(points)
                    for point in points:
                        assert type(point['lat']) in (int, float) and math.isfinite(point['lat']) and -90 <= point['lat'] <= 90
                        assert type(point['lng']) in (int, float) and math.isfinite(point['lng']) and -180 <= point['lng'] <= 180
                assert count <= 512
            scope = 'ACCESS' if index < ride_indices[0] else 'EGRESS' if index > ride_indices[-1] else 'TRANSFER'
            assert segment['walkingScope'] == scope
            cursor += dt.timedelta(seconds=seconds)
            pending_walk += seconds
            walking_minutes += minutes
        else:
            assert segment['kind'] == 'SUBWAY'
            timing = segment['rideTiming']
            boarding, arrival = instant(timing['predictedBoardingAt']), instant(timing['predictedArrivalAt'])
            assert boarding >= cursor + dt.timedelta(seconds=60) and arrival > boarding
            audit = segment.get('transferTiming')
            if previous_arrival is not None and audit is not None:
                assert instant(audit['previousArrivalAt']) == previous_arrival
                assert audit['walkingSeconds'] == pending_walk
                margin = max(audit['bufferSeconds'], audit['confidenceMarginSeconds'])
                assert margin == audit['requiredMarginSeconds'] == 60
                assert instant(audit['physicalReadyAt']) == cursor
                assert instant(audit['confidenceReadyAt']) == cursor + dt.timedelta(seconds=margin)
                assert instant(audit['boardingAt']) == boarding
                assert audit['remainingSlackSeconds'] == (boarding - instant(audit['confidenceReadyAt'])).total_seconds()
            cursor = arrival
            previous_arrival = arrival
            pending_walk = 0
    assert cursor == instant(route['arrivalAt'])
    total = (cursor - instant(route['departureAt'])).total_seconds()
    assert math.ceil(total / 60) == route['totalMinutes']
    return {'classification': 'MIXED_RESOLUTION_WITH_FULL_PATH_REFINEMENT_EVIDENCE' if refined_seconds else 'MINUTE_RESOLUTION_WALKING_MODEL_NOT_EXACT_SOURCE_SECONDS',
            'timingResult': 'PASSED', 'sourceWalkingResolutionSeconds': None if refined_seconds else 60,
            'walkingMinutes': walking_minutes, 'adoptedFullPathWalkingSeconds': refined_seconds,
            'exactSourceWalkingSecondsVerified': False,
            'stationInteriorCoverageVerified': False, 'realWorldAccuracyVerified': False}

def verify_comparison_export(worker, prediction):
    """Independently bind exported clocks/IDs to this accepted Worker evaluation."""
    route = worker['effectiveSnapshot']['effectiveTransitRoute']
    assert prediction['kind'] == 'APP_PREDICTION' and prediction['mocked'] is False
    assert prediction['id'] == f"worker-{worker['scheduleId']}-{worker['latestHistoryId']}"
    assert prediction['observedAt'] == worker['evaluatedAt']
    assert prediction['requestedDepartureAt'] == prediction['departureAt'] == route['departureAt']
    assert prediction['arrivalAt'] == route['arrivalAt'] == worker['predictedArrivalAt']
    assert prediction['protectedAlarmDepartureAt'] == worker['recommendedDepartureAt']
    assert prediction['realWorldAccuracyVerified'] is prediction['simulatorE2eVerified'] is False
    assert prediction['arrivalClockEvidence'] == {'resolutionSeconds': 1, 'rounding': 'EXACT',
        'evidence': prediction['evidence'] + '#effectiveSnapshot.effectiveTransitRoute.arrivalAt'}
    source_walks = [s for s in route['segments'] if s['kind'] == 'WALK']
    for field, walk, endpoint in (('originBoundary', source_walks[0], 'from'),
                                  ('destinationBoundary', source_walks[-1], 'to')):
        coordinate = (walk.get('walkingGeometry') or {}).get(endpoint)
        expected = f"coordinate:{coordinate['lat']},{coordinate['lng']}" if coordinate else 'UNKNOWN'
        assert prediction[field] == expected
    rides = [s['rideTiming'] for s in route['segments'] if s['kind'] == 'SUBWAY']
    assert len(prediction['rides']) == len(rides) > 0
    for ride, timing in zip(prediction['rides'], rides):
        table = timing['timetable']
        assert ride['boardingAt'] == timing['predictedBoardingAt']
        assert ride['arrivalAt'] == timing['predictedArrivalAt']
        assert [ride[k] for k in ('line', 'from', 'to', 'direction', 'serviceClass')] == [
            table[k] for k in ('line', 'fromStationCode', 'toStationCode', 'directionCode', 'serviceClass')]
        assert [ride['trainIdentity'][k] for k in ('namespace', 'serviceDate', 'number')] == [
            table[k] for k in ('provider', 'serviceDate', 'trainNumber')]
        assert ride['trainIdentity']['evidence'] == prediction['evidence']
    walks = prediction['walkingBoundaryEvidence']
    assert [w['scope'] for w in walks] == ['ACCESS'] + ['TRANSFER'] * (len(rides) - 1) + ['EGRESS']
    assert all(w['stationInteriorCoverage'] == 'UNKNOWN' for w in walks)
    # Nominal station coordinates must not be exported as a proven platform.
    assert all(w[k]['kind'] != 'STATION_PLATFORM' for w in walks for k in ('from', 'to'))
    return {'result': 'PASSED', 'mapAgreementVerified': False, 'actualTripAccuracyVerified': False}


def verify(root, require_comparison_evidence=False):
    root = root.resolve(strict=True)
    assert str(root).startswith('/private/tmp/nolate-eta-real-e2e.')
    results = []
    previous = None
    for path in sorted(root.glob('evaluation-*.json'), key=lambda p: int(p.stem.split('-')[-1])):
        worker = json.loads(path.read_text())
        index = path.stem.split('-')[-1]
        assert worker['historyCount'] == int(index)
        if previous is not None:
            verify_evaluation_cadence(previous, worker)
        previous = worker
        walking_diagnostic = worker.get('walkingRefinement')
        walking_diagnostic_audit = (verify_walking_diagnostics(walking_diagnostic)
                                    if walking_diagnostic and 'failureCounts' in walking_diagnostic else None)
        ui = root / ('ui-evaluation-' + index)
        if not ui.is_dir():
            diagnostic_ui = root / ('ui-diagnostic-' + index)
            if diagnostic_ui.is_dir():
                public = json.loads((root / ('ui-status-' + index + '.json')).read_text())
                record = verify_diagnostic_values(worker, public,
                    json.loads((root / 'odsay-seed-journey.json').read_text()),
                    json.loads((root / 'selected-route.json').read_text()))
                if walking_diagnostic_audit is not None:
                    record['walkingRefinementAudit'] = walking_diagnostic_audit
                summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results',
                    'summary', '--path', str(diagnostic_ui / 'result.xcresult')]))
                assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
                assert summary['failedTests'] == summary['skippedTests'] == 0 and summary['devicesAndConfigurations']
                assert all(x['device']['deviceId'] == DEVICE for x in summary['devicesAndConfigurations'])
                metadata = json.loads((diagnostic_ui / 'metadata.json').read_text())
                assert metadata['realIsolated'] is True and metadata['apiBase'] == 'http://127.0.0.1:5523'
                assert metadata['method'] == 'testVerifyIsolatedRealProviderDiagnostic' and metadata['allowSave'] is False
                assert 'ETA_REAL_DIAGNOSTIC_UI_VERIFIED: ' in (diagnostic_ui / 'run.log').read_text()
                results.append({'index': index, 'result': 'DIAGNOSTIC_UI_PASSED_NOT_ETA_ACCEPTANCE', **record})
                continue
            results.append({'index': index, 'result': missing_ui_result(worker),
                            'failureCode': (worker.get('failureReason') or '').split(':')[0]})
            continue
        public = json.loads((root / ('ui-status-' + index + '.json')).read_text())
        record = verify_values(worker, public)
        if walking_diagnostic_audit is not None:
            record['walkingRefinementAudit'] = walking_diagnostic_audit
        prediction_path = root / ('prediction-observation-' + index + '.json')
        if require_comparison_evidence or prediction_path.exists():
            record['comparisonExportAudit'] = verify_comparison_export(worker, json.loads(prediction_path.read_text()))
        if record['journeyProvider'] == 'odsay':
            verify_odsay_selection(json.loads((root / 'odsay-seed-journey.json').read_text()),
                json.loads((root / 'selected-route.json').read_text()), public['effectiveTransitRoute'])
            record['selectedProviderIdsPreserved'] = True
        summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results',
                                                      'summary', '--path', str(ui / 'result.xcresult')]))
        assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
        assert summary['failedTests'] == summary['skippedTests'] == 0
        assert all(x['device']['deviceId'] == DEVICE for x in summary['devicesAndConfigurations'])
        metadata = json.loads((ui / 'metadata.json').read_text())
        assert metadata['realIsolated'] is True and metadata['apiBase'] == 'http://127.0.0.1:5523'
        assert metadata['method'] == 'testVerifyIsolatedRealProviderEta' and metadata['allowSave'] is False
        assert 'ETA_REAL_ISOLATED_UI_VERIFIED: ' in (ui / 'run.log').read_text()
        results.append({'index': index, 'result': 'PASSED', 'resultBundle': str(ui / 'result.xcresult'), **record})
    passed = sum(x['result'] == 'PASSED' for x in results)
    streak = longest_accepted_ui_streak(results)
    return {'classification': 'REAL_PROVIDER_WORKER_API_SIMULATOR_E2E',
            'date': instant([item for item in results if item['result'] == 'PASSED'][-1]['evaluatedAt'])
                    .astimezone(dt.timezone(dt.timedelta(hours=9))).date().isoformat()
                    if passed else None,
            'result': 'PASSED' if streak >= 2 else 'PARTIAL', 'acceptedUiCases': passed,
            'longestConsecutiveAcceptedUiCases': streak,
            'diagnosticUiCases': sum(x['result'] == 'DIAGNOSTIC_UI_PASSED_NOT_ETA_ACCEPTANCE' for x in results),
            'productionDatabaseModified': False, 'productionServerModified': False,
            'pushAcknowledgementMocked': True, 'fcmDeliveryVerified': False,
            'physicalIphoneVerified': False, 'mapAccuracyWithinTwoMinutesVerified': False,
            'actualTripAccuracyVerified': False, 'cases': results}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--require-comparison-evidence', action='store_true')
    args = parser.parse_args()
    result = verify(args.root, require_comparison_evidence=args.require_comparison_evidence)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(verification_exit_code(result))
