#!/usr/bin/env python3
"""Verify private H2 + installed-app evidence, never real-world ETA accuracy."""
import argparse
import datetime as dt
import json
from pathlib import Path
import subprocess

PHASES = ('success', 'reconnect', 'missed', 'recovered', 'late')
DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'


def instant(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def verify_current_journey(public, snapshot, phase):
    """Expected values are fixed synthetic timetable inputs, not proportional saved durations."""
    route = public['effectiveTransitRoute']
    expected_minutes = [2, 22, 5, 11, 3] if phase == 'success' else [2, 25, 5, 13, 3]
    assert public['routeChanged'] is False, phase
    assert [s['kind'] for s in route['segments']] == ['WALK', 'SUBWAY', 'WALK', 'SUBWAY', 'WALK'], phase
    assert [s['durationMinutes'] for s in route['segments']] == expected_minutes, phase
    assert route == snapshot['effectiveTransitRoute'], phase


def expected_walking_geometries():
    """Independent fixed synthetic inputs, not reconstructed from Worker/API output."""
    pairs = [
        ({'lat': 37.6551, 'lng': 127.061}, {'lat': 37.655, 'lng': 127.0609}, 128),
        ({'lat': 37.4765, 'lng': 126.9816}, {'lat': 37.4766, 'lng': 126.9817}, 205),
        ({'lat': 37.484, 'lng': 126.9295}, {'lat': 37.4842, 'lng': 126.9297}, 126),
    ]
    descriptions = ['격리 테스트 출구 경유', None, '격리 테스트 도착 도보']
    middle = [{'lat': 37.6552, 'lng': 127.0611}, None, {'lat': 37.4841, 'lng': 126.9296}]
    return [{'from': start, 'to': end, 'distanceMeters': meters,
             'endpointBasis': 'PROVIDER_LEG_ENDPOINTS',
             'pathEvidence': {'provider': 'tmap', 'status': 'UNAVAILABLE' if i == 1 else 'PROVIDED',
                 'stationInteriorCoverage': 'UNKNOWN', 'steps': [] if i == 1 else [
                     {'coordinates': [start, middle[i], end], 'distanceMeters': meters, 'description': descriptions[i]}]}}
            for i, (start, end, meters) in enumerate(pairs)]


def verify_walking_metadata(public, snapshot):
    """Original synthetic WALK endpoints, not inferred entrance/platform coordinates."""
    route = public['effectiveTransitRoute']
    assert route == snapshot['effectiveTransitRoute']
    walks = [segment for segment in route['segments'] if segment['kind'] == 'WALK']
    assert [s['walkingScope'] for s in walks] == ['ACCESS', 'TRANSFER', 'EGRESS']
    assert [s['durationSeconds'] for s in walks] == [111, 243, 171]
    assert [s['walkingGeometry'] for s in walks] == expected_walking_geometries()
    assert all(segment.get(key) is None for segment in route['segments'] if segment['kind'] != 'WALK'
               for key in ('walkingScope', 'durationSeconds', 'walkingGeometry'))


def verify_egress_included_once(public, epoch, phase):
    """Fixed final train arrivals are independent fixture inputs, not computed output."""
    route = public['effectiveTransitRoute']
    walks = [s for s in route['segments'] if s.get('walkingScope') == 'EGRESS']
    assert len(walks) == 1 and route['segments'][-1] == walks[0]
    assert walks[0]['kind'] == 'WALK' and walks[0]['durationSeconds'] == 171
    alighted_at = epoch + dt.timedelta(seconds=2281 if phase == 'success' else 2581)
    expected_arrival = alighted_at + dt.timedelta(seconds=171)
    assert instant(public['predictedArrivalAt']) == instant(route['arrivalAt']) == expected_arrival
    assert instant(route['departureAt']) == epoch
    assert public['travelMinutes'] == route['totalMinutes'] == (41 if phase == 'success' else 46)


def verify_walking_boundary(root):
    root = root.resolve(strict=True)
    if not str(root).startswith('/private/tmp/nolate-eta-mock-e2e.'):
        raise ValueError('Only private fixture evidence is supported')
    phases = {}
    for index, phase in enumerate(('success', 'reconnect'), 1):
        worker = json.loads((root / f'{phase}.json').read_text())
        public = json.loads((root / f'{phase}-status.json').read_text())
        metadata = json.loads((root / f'ui-{phase}/metadata.json').read_text())
        ui = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary',
            '--path', str(root / f'ui-{phase}/result.xcresult')]))
        assert ui['result'] == 'Passed' and ui['passedTests'] == ui['totalTestCount'] == 1
        assert ui['skippedTests'] == ui['failedTests'] == 0
        assert metadata['device'] == DEVICE and metadata['apiBase'] == 'http://127.0.0.1:5523'
        assert metadata['fixturePhase'] == phase and metadata['allowSave'] is False
        assert all(item['device']['deviceId'] == DEVICE for item in ui['devicesAndConfigurations'])
        assert worker['processed'] == 1 and worker['historyCount'] == index and worker['phase'] == phase
        assert worker['savedScheduleInput'] == worker['savedScheduleAfterEvaluation']
        assert worker['effectiveSnapshot']['accepted'] is True and worker['stale'] is False
        assert worker['source'] == public['source'] == 'LIVE_PROVIDER' and public['failureReason'] is None
        assert public['stale'] is False and public['scheduleId'] == 363
        assert worker['retryCount'] == 0 and worker['workerFailure'] is None
        epoch = instant(worker['epoch'])
        seconds, minutes = (2452, 41) if phase == 'success' else (2752, 46)
        assert instant(worker['predictedArrivalAt']) == instant(public['predictedArrivalAt']) == epoch + dt.timedelta(seconds=seconds)
        assert instant(worker['recommendedDepartureAt']) == instant(public['recommendedDepartureAt']) == epoch
        assert public['travelMinutes'] == public['effectiveTransitRoute']['totalMinutes'] == minutes
        verify_current_journey(public, worker['effectiveSnapshot'], phase)
        verify_walking_metadata(public, worker['effectiveSnapshot'])
        verify_egress_included_once(public, epoch, phase)
        log = (root / f'ui-{phase}/run.log').read_text()
        assert all(label in log for label in ('접근 도보', '환승 도보', '도착 도보', '1분 51초', '4분 3초', '2분 51초'))
        assert '도착 도보는 총시간에 포함돼요' in log and '역 내부 이동 포함 범위는 확인되지 않았어요' in log
        phases[phase] = {'result': 'PASSED', 'totalMinutes': minutes,
                         'uiResultBundle': str(root / f'ui-{phase}/result.xcresult')}
    return {'classification': 'ISOLATED_MOCK_FEED_SIMULATOR_E2E', 'result': 'PASSED',
        'walkingMetadataPreserved': True, 'productionDatabaseModified': False,
        'egressIncludedExactlyOnce': True, 'unknownCoverageExplainedInApp': True,
        'stationInteriorCoverage': 'UNKNOWN', 'realWorldAccuracyVerified': False,
        'nativeAlarmDeliveryVerified': False, 'device': DEVICE, 'phases': phases}


def verify_uncertain_alarm_boundary(worker):
    assert worker['alarmQualityBoundary'] is True
    before = worker['alarmBeforeEvaluation']
    assert len(before) == 1 and before[0]['operation'] == 'UPSERT'
    assert instant(before[0]['trigger_at']) > instant(worker['evaluatedAt'])
    assert instant(worker['recommendedDepartureAt']) < instant(worker['evaluatedAt'])
    assert worker['alarmStates'] == before, 'An uncertain past ETA must not mutate the future alarm'
    assert worker['retryCount'] == 0 and worker['workerFailure'] is None


def verify(root, whole_journey=False, alarm_quality=False):
    if alarm_quality and not whole_journey:
        raise ValueError('Alarm-quality verification requires whole-journey UI evidence')
    root = root.resolve(strict=True)
    if not str(root).startswith('/private/tmp/nolate-eta-mock-e2e.'):
        raise ValueError('Only private fixture evidence is supported')
    phases = {}
    initial_count = json.loads((root / 'success.json').read_text())['historyCount']
    assert initial_count >= 1
    phase_order = ('success', 'reconnect', 'unknown', 'missed', 'recovered', 'late') if whole_journey else PHASES
    for index, phase in enumerate(phase_order, 1):
        worker = json.loads((root / f'{phase}.json').read_text())
        public = json.loads((root / f'{phase}-status.json').read_text())
        metadata = json.loads((root / f'ui-{phase}/metadata.json').read_text())
        ui = json.loads(subprocess.check_output([
            'xcrun', 'xcresulttool', 'get', 'test-results', 'summary',
            '--path', str(root / f'ui-{phase}/result.xcresult'),
        ]))
        assert ui['result'] == 'Passed' and ui['passedTests'] == 1 and ui['failedTests'] == 0, phase
        assert ui['skippedTests'] == 0 and ui['totalTestCount'] == 1, phase
        assert all(item['device']['deviceId'] == DEVICE for item in ui['devicesAndConfigurations']), phase
        assert metadata['apiBase'] == 'http://127.0.0.1:5523' and metadata['fixturePhase'] == phase, phase
        assert worker['phase'] == phase and worker['processed'] == 1 and worker['historyCount'] == initial_count + index - 1, phase
        if whole_journey:
            assert worker['clockMode'] == 'FIXED_PRIVATE_BACKEND_SNAPSHOT_CLOCK', phase
            assert worker['retryCount'] == 0 and worker['workerFailure'] is None, phase
        history = worker['evaluationHistory']
        assert history['scheduleId'] == 363 and history['memberId'] == 296, phase
        assert instant(history['targetArrivalAt']) == instant(worker['targetArrivalAt']), phase
        assert abs(instant(history['evaluatedAt']) - instant(worker['evaluatedAt'])) <= dt.timedelta(microseconds=1), phase
        snapshot = worker['effectiveSnapshot']
        epoch = instant(worker['epoch'])
        accepted = phase in ('success', 'reconnect', 'recovered')
        assert snapshot['accepted'] == accepted, phase
        assert public['scheduleId'] == 363, phase
        if accepted:
            seconds = 2452 if phase == 'success' else 2752
            minutes = 41 if phase == 'success' else 46
            # Expected times come from the synthetic timetable, not the returned ETA.
            assert instant(worker['recommendedDepartureAt']) == epoch, phase
            assert instant(worker['predictedArrivalAt']) == epoch + dt.timedelta(seconds=seconds), phase
            assert public['recommendedDepartureAt'] == epoch.isoformat().replace('+00:00', 'Z'), phase
            assert instant(public['predictedArrivalAt']) == epoch + dt.timedelta(seconds=seconds), phase
            assert public['travelMinutes'] == minutes and public['onTimeArrivalPossible'] is True, phase
            assert worker['source'] == public['source'] == 'LIVE_PROVIDER', phase
            assert public['confidence'] == 'HIGH' and public['stale'] is False, phase
            assert public['failureReason'] is None, phase
            assert snapshot['transitTimingBasis'] == public['transitTimingBasis'] == 'FIRST_BOARDING_REALTIME_FUTURE_TIMETABLE', phase
            assert snapshot['firstBoardingObservation']['trainNumber'] == '4012', phase
            assert public['effectiveTransitRoute']['totalMinutes'] == minutes, phase
            assert public['firstBoardingWaitMinutes'] == (2 if phase == 'success' else 5), phase
            assert worker['alarmStates'][0]['operation'] == 'UPSERT', phase
            if whole_journey:
                verify_current_journey(public, snapshot, phase)
                assert '현재 보정 여정' in (root / f'ui-{phase}/run.log').read_text(), phase
        else:
            code = {'missed': 'TRANSIT_TRANSFER_MISSED', 'unknown': 'TRANSIT_ROUTE_TIMING_ESTIMATE_ONLY',
                    'late': 'TRANSIT_ON_TIME_ARRIVAL_UNAVAILABLE'}[phase]
            assert worker['failureCode'] == code and public['failureReason'].startswith(code + ':'), phase
            assert public['confidence'] == 'LOW' and public['stale'] is True, phase
            if phase == 'missed':
                assert worker['predictedArrivalAt'] is None and public['predictedArrivalAt'] is None, phase
                assert worker['alarmStates'][0]['operation'] == 'CANCEL', phase
            elif phase == 'late':
                assert instant(worker['predictedArrivalAt']) - instant(worker['targetArrivalAt']) == dt.timedelta(minutes=5), phase
                assert public['onTimeArrivalPossible'] is False, phase
            elif phase == 'unknown':
                # No full onward timetable: the calculator rejects the journey before
                # first-vehicle overlay. This is estimate-only, not a confirmed miss.
                assert snapshot['transitTimingBasis'] == 'ROUTE_ESTIMATE_ONLY', phase
                assert snapshot['firstBoardingObservation'] is None, phase
                assert public['onTimeArrivalPossible'] is None, phase
                # Missing evidence is not a confirmed missed transfer: retain the previous alarm.
                if alarm_quality:
                    verify_uncertain_alarm_boundary(worker)
                else:
                    previous = json.loads((root / 'reconnect.json').read_text())['alarmStates'][0]
                    assert worker['alarmStates'][0]['operation'] == 'UPSERT', phase
                    assert worker['alarmStates'][0]['generation'] == previous['generation'], phase
        phases[phase] = {
            'result': 'PASSED', 'historyCount': worker['historyCount'],
            'workerSource': worker['source'], 'failureCode': worker['failureCode'],
            'publicTravelMinutes': public['travelMinutes'], 'publicConfidence': public['confidence'],
            'departureAt': public['recommendedDepartureAt'], 'predictedArrivalAt': public['predictedArrivalAt'],
            'alarmOperation': worker['alarmStates'][0]['operation'],
            'alarmGeneration': worker['alarmStates'][0]['generation'], 'uiResultBundle': str(root / f'ui-{phase}/result.xcresult'),
        }
    failed_alarm = json.loads((root / 'missed.json').read_text())['alarmStates'][0]
    recovered_alarm = json.loads((root / 'recovered.json').read_text())['alarmStates'][0]
    assert failed_alarm['id'] == recovered_alarm['id'], 'Recovery must resume the same automatic alarm'
    assert recovered_alarm['generation'] > failed_alarm['generation'], 'Recovery must fence the canceled alarm generation'
    return {
        'classification': 'ISOLATED_MOCK_FEED_SIMULATOR_E2E', 'result': 'PASSED',
        'device': DEVICE, 'database': 'H2_MEMORY_ONLY', 'apiBase': 'http://127.0.0.1:5523',
        'productionDatabaseModified': False, 'outboundProviderRequests': False,
        'realWorldAccuracyVerified': False, 'nativeAlarmDeliveryVerified': False,
        'wholeJourneyGuidanceVerified': whole_journey,
        'uncertainPastEtaPreservesFutureAlarmVerified': alarm_quality,
        'backendClockMode': 'FIXED_PRIVATE_BACKEND_SNAPSHOT_CLOCK' if whole_journey else 'WALL_CLOCK',
        'setupEvaluationCount': initial_count - 1,
        'phases': phases,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('--whole-journey', action='store_true')
    parser.add_argument('--alarm-quality', action='store_true')
    parser.add_argument('--walking-boundary', action='store_true')
    args = parser.parse_args()
    if args.walking_boundary and (args.whole_journey or args.alarm_quality):
        parser.error('Walking-boundary evidence is a separate scoped two-phase verification')
    result = verify_walking_boundary(args.root) if args.walking_boundary else verify(args.root, args.whole_journey, args.alarm_quality)
    print(json.dumps(result, indent=2, ensure_ascii=False))
