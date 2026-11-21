#!/usr/bin/env python3
"""Synthetic early-train Worker -> API -> pinned installed-app regression; never map accuracy."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
import traceback
import urllib.request
from eta_pinned_app import DEVICE, restore_private_endpoint, open_private_client_with_xcuitest
from eta_metro_preparation import prepare_private_metro_bundle

WORKSPACE = Path(__file__).resolve().parents[3]
BE, FE = WORKSPACE / 'NoLate_BE', WORKSPACE / 'NoLate_FE'
TITLE = 'ETA E2E isolated fixture'


def instant(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def calendar_smoke_title(text):
    titles = re.findall(r'^SYNTHETIC_SCHEDULE_EDITED_TITLE (XCUITest [0-9]+ edited)$', text, re.MULTILINE)
    assert len(titles) == 1, 'Require exactly one UI-created synthetic title'
    return titles[0]


def verify_calendar_smoke_record(records):
    assert isinstance(records, list)
    created = [row for row in records if row['title'].startswith('XCUITest ') and row['title'].endswith(' edited')]
    assert len(created) == 1
    row = created[0]
    assert isinstance(row['id'], int) and row['id'] > 0 and row['id'] != 363
    assert row['ownerMemberId'] == 296 and row['allDay'] is True
    assert row.get('notificationEnabled') is not True
    return {key: row[key] for key in ('id', 'ownerMemberId', 'title', 'startAt', 'allDay')}


def verify_reported_boarding(worker, public):
    assert worker['classification'] == 'SYNTHETIC_REPORTED_BOARDING_WORKER_CHAIN'
    assert worker['database'] == 'H2_MEMORY_ONLY' and worker['providersMocked'] is True
    assert worker['physicalTransitHttpCalls'] == 0 and worker['productionDatabaseModified'] is False
    assert worker['processed'] == 1 and worker['historyCount'] == 3
    assert worker['savedScheduleInput'] == worker['savedScheduleAfterEvaluation']
    assert worker['alarmStates'] == worker['alarmBeforeEvaluation'] == []
    pending = worker['pendingUpdate']
    assert pending.get('route') is None and pending.get('failure') is None
    record, = pending['reportedBoardings']
    assert record['service']['trainNumber'] == '3202'
    assert worker['pendingPrediction']['basis'] == 'LAST_ACCEPTED_PLAN'
    prediction = public['plannedJourneyArrivalPrediction']
    assert prediction['basis'] == 'OBSERVED_SERVICE_CONNECTION'
    route = prediction['effectiveTransitRoute']
    assert route == worker['provisionalPrediction']['effectiveTransitRoute']
    assert instant(public['recommendedDepartureAt']) == instant(worker['beforeRecommendedDepartureAt'])
    assert route['departureAt'] == worker['originalPlan']['departureAt']
    assert public['stale'] is True
    for key in ('travelMinutes', 'source', 'liveFetchedAt', 'failureReason', 'predictedArrivalAt', 'effectiveTransitRoute'):
        assert public.get(key) is None, 'Conditional plan was promoted into normal ETA: ' + key
    rides = [leg['rideTiming'] for leg in route['segments'] if leg['kind'] == 'SUBWAY']
    onward = rides[-1]
    assert onward['basis'] == 'REPORTED_BOARDING_AND_ALIGHTING_REALTIME'
    assert onward['observedService']['trainNumber'] == '3202' and onward['timetable']['trainNumber'] == '2012'
    assert onward['reportedBoarding'] == record
    assert instant(onward['predictedBoardingAt']) == instant(record['sourceUpdatedAt'])
    assert instant(onward['predictedArrivalAt']) == instant(worker['evaluatedAt']) + dt.timedelta(seconds=450)
    assert instant(route['arrivalAt']) == instant(onward['predictedArrivalAt']) + dt.timedelta(seconds=171)
    assert [s for s in route['segments'] if s['kind'] == 'WALK'] == [s for s in worker['originalPlan']['segments'] if s['kind'] == 'WALK']
    assert instant(prediction['sourceUpdatedAt']) == instant(worker['evaluatedAt']) - dt.timedelta(seconds=1)
    assert instant(worker['evaluatedAt']) - instant(record['sourceUpdatedAt']) > dt.timedelta(seconds=120)
    assert '사당/2호선' in worker['pendingStations'] and '신림/2호선' in worker['queriedStations']
    return {'result': 'PASSED', 'historicalBoardingThenFreshSameVehicleAlighting': True,
            'pendingStateWasNotFreshEta': True, 'walkingAndDeparturePreserved': True,
            'actualTripAccuracyVerified': False, 'providerInputsSynthetic': True}


def verify_planned_postdeparture(worker, public):
    assert worker['classification'] == 'SYNTHETIC_POST_DEPARTURE_WORKER'
    assert worker['database'] == 'H2_MEMORY_ONLY' and worker['providersMocked'] is True
    assert worker['physicalTransitHttpCalls'] == 0 and worker['productionDatabaseModified'] is False
    assert worker['processed'] == 1 and worker['historyCount'] == 2
    prediction = public['plannedJourneyArrivalPrediction']
    assert prediction['basis'] in ('MATCHED_TRAIN_REALTIME', 'MATCHED_RIDE_AND_ONWARD_TIMETABLE')
    assert prediction['routeIdentity'] == worker['inProgressPlanIdentity']
    assert instant(prediction['predictedArrivalAt']) == instant(worker['provisionalPrediction']['predictedArrivalAt'])
    assert instant(public['recommendedDepartureAt']) == instant(worker['beforeRecommendedDepartureAt'])
    assert public['stale'] is True
    if worker.get('phase') == 'planned-first-alighting':
        assert prediction['basis'] == 'MATCHED_RIDE_AND_ONWARD_TIMETABLE'
        route = prediction['effectiveTransitRoute']
        epoch = instant(worker['epoch'])
        at = lambda seconds: epoch + dt.timedelta(seconds=seconds)
        assert instant(route['arrivalAt']) == at(1952)
        first, onward = [s['rideTiming'] for s in route['segments'] if s['kind'] == 'SUBWAY']
        assert first['basis'] == 'PLANNED_RIDE_ALIGHTING_REALTIME'
        assert first['plannedBoardingIsStationArrival'] is True
        assert instant(first['predictedArrivalAt']) == at(700)
        assert onward['timetable']['trainNumber'] == '2014'
        assert instant(onward['predictedBoardingAt']) == at(1300)
        assert instant(onward['predictedArrivalAt']) == at(1781)
        assert [s['durationSeconds'] for s in route['segments'] if s['kind'] == 'WALK'] == [111, 243, 171]
        assert -5 <= (dt.datetime.now(dt.timezone.utc) - instant(prediction['sourceUpdatedAt'])).total_seconds() <= 120
    for key in ('travelMinutes', 'source', 'liveFetchedAt', 'failureReason', 'predictedArrivalAt',
                'effectiveTransitRoute', 'firstBoardingObservation', 'futureTimetablePrediction'):
        assert public.get(key) is None, 'New-origin replan leaked into planned journey: ' + key
    diagnostic = public['originReplanDiagnostic']
    for key in ('travelMinutes', 'source', 'stale', 'failureReason'):
        assert diagnostic[key] == worker[key]
    return {'result': 'PASSED', 'sameTrainProvisionalOnly': True,
            'departureAlarmUnchanged': True, 'originReplanSeparated': True,
            'actualTripAccuracyVerified': False}


def verify_prediction(worker, public, phase='early-transfer', first_timetable_alighting=False):
    assert worker['classification'] == 'SYNTHETIC_PROVIDER_WORKER'
    assert worker['providersMocked'] is True and worker['database'] == 'H2_MEMORY_ONLY'
    assert worker['physicalTransitHttpCalls'] == 0 and worker['productionDatabaseModified'] is False
    assert worker['phase'] == phase and worker['processed'] == worker['historyCount'] == 1
    assert public['scheduleId'] == worker['evaluationHistory']['scheduleId'] == 363
    assert worker['evaluationHistory']['memberId'] == 296
    assert worker['clockMode'] == 'FIXED_PRIVATE_BACKEND_SNAPSHOT_CLOCK'
    assert worker['retryCount'] == 0 and worker['workerFailure'] is None
    assert worker['savedScheduleInput'] == worker['savedScheduleAfterEvaluation']
    assert worker['effectiveSnapshot']['accepted'] is (phase not in ('transfer-first-unobserved', 'early-transfer-risk'))
    if phase == 'early-transfer-risk':
        assert worker['alertMode'] == 'ALARM'
        assert worker['alarmStates'] == worker['alarmBeforeEvaluation']
        alarm, = worker['alarmStates']
        assert alarm['operation'] == 'UPSERT'
        assert instant(alarm['trigger_at']) == instant(worker['epoch']) + dt.timedelta(seconds=60)
        assert worker['failureCode'] == worker['evaluationHistory']['failureCode'] == 'TRANSIT_TRANSFER_TIMING_UNKNOWN'
        assert public['failureReason'].split(':', 1)[0] == worker['failureCode']
        assert instant(public['recommendedDepartureAt']) == instant(worker['recommendedDepartureAt'])
        assert instant(public['savedRouteEstimatedDepartureAt']) == instant(worker['targetArrivalAt']) - dt.timedelta(minutes=65)
        assert instant(public['savedRouteEstimatedDepartureAt']) < instant(public['recommendedDepartureAt'])
        assert worker['stale'] is public['stale'] is True and public['confidence'] == 'LOW'
        assert worker['predictedArrivalAt'] is public['predictedArrivalAt'] is None
        assert public['effectiveTransitRoute'] is None
        return {'result': 'PASSED', 'previousAlarmGenerationAndTriggerPreserved': True,
                'savedEstimateMatchesVisibleDeparture': True,
                'earlyTransferTreatedAsUncertain': True, 'actualTripAccuracyVerified': False}
    assert worker['alertMode'] == 'STANDARD' and worker['alarmStates'] == []
    if phase == 'transfer-first-unobserved':
        assert worker['source'] == 'TIMETABLE_PROVIDER' and worker['stale'] is True
        assert public['stale'] is True and public['confidence'] == 'LOW'
        assert worker['effectiveSnapshot']['transitTimingBasis'] == 'FIRST_BOARDING_TIMETABLE_TRANSFER_OBSERVED'
        assert worker['effectiveSnapshot']['effectiveTransitRoute']['segments'][3]['rideTiming']['basis'] == 'TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE'
        assert worker['evaluationHistory']['predictedArrivalAt'] is not None
        assert worker['predictedArrivalAt'] is None and public['predictedArrivalAt'] is None
        assert public['effectiveTransitRoute'] is None
        assert worker['evaluationHistory']['stale'] is True
        return {'result': 'PASSED', 'transferObservedWithoutFirstBoarding': True,
                'departureAlarmNotPromoted': True, 'actualTripAccuracyVerified': False}
    assert worker['source'] == public['source'] == 'LIVE_PROVIDER'
    assert worker['stale'] is public['stale'] is False
    # Even a directly observed first train cannot make future timetable legs
    # a whole-journey realtime guarantee (ScheduleDepartureEtaService contract).
    assert public['confidence'] == 'MEDIUM'
    assert worker['failureCode'] is public['failureReason'] is None
    epoch = instant(worker['epoch'])
    at = lambda seconds: epoch + dt.timedelta(seconds=seconds)
    assert instant(worker['recommendedDepartureAt']) == instant(public['recommendedDepartureAt'])
    if phase == 'onward-delay':
        route = public['effectiveTransitRoute']
        assert route == worker['effectiveSnapshot']['effectiveTransitRoute']
        assert instant(public['predictedArrivalAt']) == instant(worker['predictedArrivalAt']) == at(1371)
        assert route['totalMinutes'] == public['travelMinutes'] == 23
        timings = [s['rideTiming'] for s in route['segments'] if s['kind'] == 'SUBWAY']
        assert [t['timetable']['trainNumber'] for t in timings] == ['4012', '2012', '1014']
        assert [instant(t['predictedArrivalAt']) for t in timings] == [at(413), at(860), at(1200)]
        assert timings[1]['basis'] == 'TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE'
        assert timings[2]['basis'] == 'TIMETABLE'
        assert instant(timings[1]['predictedBoardingAt']) == at(740)
        assert instant(timings[2]['predictedBoardingAt']) == at(1080)
        assert [s['durationSeconds'] for s in route['segments'] if s['kind'] == 'WALK'] == [111, 60, 60, 171]
        transfers = [s['transferTiming'] for s in route['segments'] if s.get('transferTiming')]
        assert len(transfers) == 2 and all(t['requiredMarginSeconds'] == 60 for t in transfers)
        assert at(980) in [instant(q['notBefore']) for q in worker['timetableQueries'] if q['line'] == 'LINE_1']
        return {'result': 'PASSED', 'observedMiddleRideReconnectedOnwardTrain': True,
                'walkingAndMarginPreserved': True, 'actualTripAccuracyVerified': False}
    if phase == 'first-alighting-late':
        route = public['effectiveTransitRoute']
        assert route == worker['effectiveSnapshot']['effectiveTransitRoute']
        assert instant(public['predictedArrivalAt']) == instant(worker['predictedArrivalAt']) == at(1952)
        first, onward = [s['rideTiming'] for s in route['segments'] if s['kind'] == 'SUBWAY']
        assert first['basis'] == 'FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME'
        assert instant(first['predictedArrivalAt']) == at(700)
        assert onward['timetable']['trainNumber'] == '2014' and onward['basis'] == 'TIMETABLE'
        assert instant(onward['predictedBoardingAt']) == at(1300)
        assert instant(onward['predictedArrivalAt']) == at(1781)
        assert [s['durationSeconds'] for s in route['segments'] if s['kind'] == 'WALK'] == [111, 243, 171]
        transfer = route['segments'][3]['transferTiming']
        assert transfer['requiredMarginSeconds'] == 60
        assert instant(transfer['previousArrivalAt']) == at(700)
        assert at(1003) in [instant(q['notBefore']) for q in worker['timetableQueries'] if q['line'] == 'LINE_2']
        return {'result': 'PASSED', 'directAlightingReconnectedTransfer': True,
                'walkingAndMarginPreserved': True, 'actualTripAccuracyVerified': False}
    if phase == 'dwell-transfer':
        assert worker['effectiveSnapshot']['transitTimingBasis'] == public['transitTimingBasis'] == (
            'FIRST_BOARDING_REALTIME_FUTURE_TIMETABLE')
        route = public['effectiveTransitRoute']
        assert route == worker['effectiveSnapshot']['effectiveTransitRoute']
        assert instant(worker['predictedArrivalAt']) == instant(public['predictedArrivalAt']) == at(2752)
        assert instant(worker['recommendedDepartureAt']) == at(0)
        assert instant(route['departureAt']) == at(149)
        assert instant(route['arrivalAt']) == at(2752)
        assert route['totalMinutes'] == public['travelMinutes'] == 44
        first, transfer = [s['rideTiming'] for s in route['segments'] if s['kind'] == 'SUBWAY']
        table = first['timetable']
        assert [instant(table[field]) for field in ('boardingStationArrivalAt', 'boardingAt', 'arrivalAt')] == [
            at(310), at(330), at(1490),
        ]
        assert instant(first['predictedBoardingAt']) == at(320)
        assert instant(first['predictedArrivalAt']) == at(1500)
        assert transfer['timetable']['trainNumber'] == '2014'
        assert instant(transfer['predictedBoardingAt']) == at(2100)
        assert instant(transfer['predictedArrivalAt']) == at(2581)
        queries = [instant(q['notBefore']) for q in worker['timetableQueries'] if q['line'] == 'LINE_2']
        assert at(1793) in queries and at(1803) in queries
        assert public['routeChanged'] is False and public['onTimeArrivalPossible'] is True
        assert [s['durationSeconds'] for s in route['segments'] if s['kind'] == 'WALK'] == [111, 243, 171]
        return {'result': 'PASSED', 'delayedArrivalDuringScheduledDwell': True,
                'saferTransferTrainNumber': '2014', 'actualTripAccuracyVerified': False}
    assert instant(worker['recommendedDepartureAt']) == at(0)
    if phase == 'transfer-observed':
        assert worker['effectiveSnapshot']['transitTimingBasis'] == public['transitTimingBasis'] == 'FIRST_BOARDING_REALTIME_TRANSFER_OBSERVED'
        assert instant(worker['predictedArrivalAt']) == instant(public['predictedArrivalAt']) == at(1612)
        route = public['effectiveTransitRoute']
        assert route == worker['effectiveSnapshot']['effectiveTransitRoute']
        assert route['totalMinutes'] == public['travelMinutes'] == 27
        assert instant(route['arrivalAt']) == at(1612)
        assert public['onTimeArrivalPossible'] is True
        first, onward = [s['rideTiming'] for s in route['segments'] if s['kind'] == 'SUBWAY']
        assert first['basis'] == 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE'
        assert onward['basis'] == 'TRANSFER_BOARDING_REALTIME_ADJUSTED_TIMETABLE'
        assert (instant(first['timetable']['boardingAt']), instant(first['timetable']['arrivalAt']),
                instant(first['predictedBoardingAt']), instant(first['predictedArrivalAt'])) == (
                at(197), at(500), at(210), at(513))
        assert (instant(onward['timetable']['boardingAt']), instant(onward['timetable']['arrivalAt']),
                instant(onward['predictedBoardingAt']), instant(onward['predictedArrivalAt'])) == (
                at(840), at(1321), at(960), at(1441))
        assert instant(onward['observationSourceUpdatedAt']) == instant(worker['evaluatedAt'])
        assert route['segments'][2]['durationSeconds'] == 243
        assert route['segments'][3]['transferTiming']['requiredMarginSeconds'] == 60
        notifications = worker['fencedNotificationPayloads']
        assert len(notifications) == 1, 'The synthetic Worker must make one fenced departure-notification decision'
        assert instant(notifications[0]['recommendedDepartureAt']) == at(0)
        assert instant(notifications[0]['predictedArrivalAt']) == at(1612)
        assert notifications[0]['etaTimingBasis'] == 'FIRST_BOARDING_REALTIME_TRANSFER_OBSERVED'
        return {'result': 'PASSED', 'transferDelaySeconds': 120,
                'rideClocksWorkerApiAndAppConsistent': True,
                'notificationPayloadMatchesUpdatedEta': True,
                'actualTripAccuracyVerified': False}
    arrival_seconds = 2752 if first_timetable_alighting else 1702
    alighting_seconds = 800 if first_timetable_alighting else 700
    transfer_board = 2100 if first_timetable_alighting else 1050
    transfer_arrival = transfer_board + 481
    assert instant(worker['predictedArrivalAt']) == instant(public['predictedArrivalAt']) == at(arrival_seconds)
    expected_basis = ('FIRST_BOARDING_REALTIME_FUTURE_TIMETABLE' if first_timetable_alighting else
                      'FIRST_BOARDING_REALTIME_TRANSFER_OBSERVED')
    assert worker['effectiveSnapshot']['transitTimingBasis'] == public['transitTimingBasis'] == expected_basis
    route = public['effectiveTransitRoute']
    assert route == worker['effectiveSnapshot']['effectiveTransitRoute']
    assert route['totalMinutes'] == public['travelMinutes'] == (46 if first_timetable_alighting else 28)
    # The public departure recommendation is minute-rounded; the preserved route starts 26s later.
    assert instant(route['departureAt']) == at(26) and instant(route['arrivalAt']) == at(arrival_seconds)
    assert public['routeChanged'] is False and public['onTimeArrivalPossible'] is True
    walks = [s for s in route['segments'] if s['kind'] == 'WALK']
    assert [s['durationSeconds'] for s in walks] == [111, 243, 171]
    first, onward = [s['rideTiming'] for s in route['segments'] if s['kind'] == 'SUBWAY']
    assert first['timetable']['trainNumber'] == '4012'
    assert onward['timetable']['trainNumber'] == ('2014' if first_timetable_alighting else '2012')
    for timing, board, arrival, predicted_board, predicted_arrival in (
        (first, 330, 800, 197, alighting_seconds), (onward, transfer_board, transfer_arrival, transfer_board, transfer_arrival),
    ):
        assert instant(timing['timetable']['boardingAt']) == at(board)
        assert instant(timing['timetable']['arrivalAt']) == at(arrival)
        assert instant(timing['predictedBoardingAt']) == at(predicted_board)
        assert instant(timing['predictedArrivalAt']) == at(predicted_arrival)
    assert instant(first['timetable']['boardingStationArrivalAt']) == at(310)
    if first_timetable_alighting:
        assert first['basis'] == 'FIRST_BOARDING_REALTIME_TIMETABLE_ALIGHTING'
        assert first['observationSourceUpdatedAt'] is None
    else:
        assert first['basis'] == 'FIRST_RIDE_BOARDING_AND_ALIGHTING_REALTIME'
        assert instant(first['observationSourceUpdatedAt']) == instant(worker['evaluatedAt'])
    transfer = next(s['transferTiming'] for s in route['segments'] if s.get('transferTiming'))
    assert instant(transfer['previousArrivalAt']) == at(alighting_seconds)
    queries = [instant(q['notBefore']) for q in worker['timetableQueries'] if q['line'] == 'LINE_2']
    assert at(1103) in queries   # 800s + 243s walk + 60s margin.
    assert (at(1003) in queries) == (not first_timetable_alighting)
    observation = public['firstBoardingObservation']
    assert observation['trainNumber'] == '4012'
    assert instant(observation['expectedBoardingAt']) == at(197)
    assert instant(observation['readyAt']) >= at(171)
    age = (instant(worker['evaluatedAt']) - instant(observation['sourceUpdatedAt'])).total_seconds()
    assert -60 <= age <= 120
    return {'result': 'PASSED', 'syntheticImprovementSeconds': 2752 - arrival_seconds,
            'firstAlightingFromTimetable': first_timetable_alighting,
            'walkingAndMarginPreserved': True, 'actualTripAccuracyVerified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', required=True)
    parser.add_argument('--api-port', type=int, choices=(5523, 5528), default=5523)
    parser.add_argument('--phase', choices=('early-transfer', 'dwell-transfer', 'first-alighting-late', 'onward-delay', 'early-transfer-risk', 'transfer-observed', 'transfer-first-unobserved', 'planned-postdeparture', 'planned-alighting', 'planned-first-alighting', 'reported-boarding'), default='early-transfer')
    parser.add_argument('--backend-snapshot', type=Path, help='Owned read-only source copy for independent Gradle outputs')
    parser.add_argument('--calendar-smoke', action='store_true', help='Also create/edit/relaunch a synthetic all-day schedule after early-transfer verification')
    parser.add_argument('--first-alighting-risk', action='store_true',
                        help='Use a direct first-train alighting observation instead of an early connecting service')
    parser.add_argument('--first-timetable-alighting', action='store_true',
                        help='Verify preserved timetable alighting when the first train is missing at its destination')
    args = parser.parse_args()
    phase = args.phase
    if args.first_alighting_risk and phase != 'early-transfer-risk':
        parser.error('The first-alighting check requires the transfer-risk fixture')
    if args.first_timetable_alighting and phase != 'early-transfer':
        parser.error('Timetable alighting requires the early-transfer fixture')
    postdeparture = phase in ('planned-postdeparture', 'planned-alighting', 'planned-first-alighting', 'reported-boarding')
    build_be = BE
    if args.backend_snapshot:
        build_be = args.backend_snapshot.resolve(strict=True)
        if not str(build_be).startswith('/private/tmp/nolate-be-planned-build.') or not (build_be / 'gradlew').is_file():
            parser.error('Only an owned backend source snapshot is supported')
    if args.api_port != 5523 and (phase not in ('early-transfer', 'dwell-transfer', 'planned-alighting') or args.calendar_smoke):
        parser.error('The alternate port supports only the scoped reconnection and alighting assertions')
    base = f'http://127.0.0.1:{args.api_port}'
    if args.calendar_smoke and phase != 'early-transfer':
        parser.error('Calendar smoke requires the future, alarm-free early-transfer fixture')
    root = Path(tempfile.mkdtemp(prefix='nolate-eta-mock-e2e.', dir='/private/tmp')).resolve()
    server = metro = None
    report = {'classification': 'SYNTHETIC_' + phase.upper().replace('-', '_') + '_SIMULATOR_E2E', 'result': 'PARTIAL',
              'providersMocked': True, 'database': 'H2_MEMORY_ONLY', 'physicalTransitHttpCalls': 0,
              'productionDatabaseModified': False, 'actualTripAccuracyVerified': False,
              'mapAccuracyWithinTwoMinutesVerified': False, 'nativeAlarmDeliveryVerified': False}
    report['calendarSmokeRequested'] = args.calendar_smoke
    report['firstAlightingRiskRequested'] = args.first_alighting_risk
    report['firstTimetableAlightingRequested'] = args.first_timetable_alighting
    if args.backend_snapshot:
        critical = list((BE / 'src/main/kotlin/com/noLate/eta').rglob('*.kt')) + [BE / path for path in (
            'src/main/kotlin/com/noLate/schedule/application/TrafficClient.kt',
            'src/main/kotlin/com/noLate/schedule/application/EffectiveTransitRouteSnapshot.kt',
            'src/main/kotlin/com/noLate/schedule/application/PlannedTransitRouteUpdate.kt',
            'src/main/kotlin/com/noLate/schedule/application/ReportedSubwayBoardingEvidence.kt',
            'src/main/kotlin/com/noLate/schedule/application/TransitTimetablePlanEvidence.kt',
            'src/main/kotlin/com/noLate/schedule/application/TimetableDeparturePlanPolicy.kt',
            'src/main/kotlin/com/noLate/schedule/application/service/SchedulePushJobWorker.kt',
            'src/main/kotlin/com/noLate/schedule/application/service/ScheduleDepartureEtaService.kt',
            'src/main/kotlin/com/noLate/schedule/domain/ScheduleEta.kt',
            'src/test/kotlin/com/noLate/eta/simulator/EtaSimulatorFixtureServer.kt')]
        source_hashes = {}
        for path in critical:
            relative = path.relative_to(BE)
            original = path.read_bytes()
            assert (build_be / relative).read_bytes() == original, 'Backend source snapshot does not match the current ETA code'
            source_hashes[str(relative)] = hashlib.sha256(original).hexdigest()
        report['backendSourceSnapshot'] = {'path': str(build_be), 'etaSourcesIdenticalAtLaunch': True,
                                           'sourceSha256': source_hashes}

    def emit(**value):
        print(json.dumps(value), flush=True)

    def log(name):
        return os.fdopen(os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')

    def free(port):
        result = subprocess.run(['/usr/sbin/lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-t'], capture_output=True)
        if result.returncode not in (0, 1) or result.stdout.strip():
            raise RuntimeError('Occupied port; existing process preserved')

    def stop(child):
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=10)

    def wait(check, child, seconds=180):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError('Owned process exited')
            try:
                if check():
                    return
            except (OSError, ValueError):
                pass
            time.sleep(0.5)
        raise RuntimeError('Bounded wait expired')

    def ui(method, name, target, extra):
        emit(state='ui_start', case=name)
        command = ['python3', 'e2e/ios/run-eta.py', '--device', DEVICE, '--output', str(root / name),
                   '--only', method, '--title', TITLE, '--target-arrival', target, '--api-base', base] + extra
        with log(name + '-launcher.log') as output:
            child = subprocess.Popen(command, cwd=FE, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                if child.wait(timeout=360):
                    raise RuntimeError('Pinned UI test failed')
            finally:
                stop(child)
        summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results',
            'summary', '--path', str(root / name / 'result.xcresult')], timeout=30))
        assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
        assert summary['failedTests'] == summary['skippedTests'] == 0 and summary['devicesAndConfigurations']
        assert all(v['device']['deviceId'] == DEVICE for v in summary['devicesAndConfigurations'])
        (root / (name + '-summary.json')).write_text(json.dumps(summary, indent=2))
        emit(state='ui_passed', case=name)

    def calendar_ui(method, name, expected_title=None):
        assert method in ('testCalendarCreateAndEdit', 'testSavedCalendarScheduleAfterProcessRestart')
        command = ['python3', 'e2e/ios/run.py', '--device', DEVICE, '--output', str(root / name),
                   '--derived-data', '/private/tmp/nolate-eta-xcuitest-20261003',
                   '--credentials', str(root / 'credentials.json'), '--only', method]
        env = dict(os.environ)
        if expected_title is not None:
            env['TEST_RUNNER_E2E_EXPECTED_SCHEDULE_TITLE'] = expected_title
        emit(state='ui_start', case=name)
        with log(name + '-launcher.log') as output:
            child = subprocess.Popen(command, cwd=FE, env=env, stdout=output, stderr=subprocess.STDOUT,
                                     start_new_session=True)
            try:
                if child.wait(timeout=360):
                    raise RuntimeError('Pinned calendar UI test failed')
            finally:
                stop(child)
        summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results',
            'summary', '--path', str(root / name / 'result.xcresult')], timeout=30))
        assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
        assert summary['failedTests'] == summary['skippedTests'] == 0 and summary['devicesAndConfigurations']
        assert all(v['device']['deviceId'] == DEVICE for v in summary['devicesAndConfigurations'])
        (root / (name + '-summary.json')).write_text(json.dumps(summary, indent=2))
        emit(state='ui_passed', case=name)

    def fixture_api(path, payload=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = urllib.request.Request(base + path, headers=headers,
            data=None if payload is None else json.dumps(payload).encode())
        with urllib.request.urlopen(request, timeout=5) as response:
            assert response.headers.get('X-NoLate-Eta-Fixture') == 'h2-memory-only'
            return json.loads(response.read())['data']

    try:
        emit(state='starting', evidenceRoot=str(root))
        free(args.api_port)
        free(8086)
        with log('compile.log') as output:
            subprocess.run(['./gradlew', '-I', 'e2e/eta-fixture.init.gradle', 'etaSimulatorFixtureClasspath',
                '-PetaFixtureOutput=' + str(root), '--max-workers=2', '--console=plain'], cwd=build_be,
                stdout=output, stderr=subprocess.STDOUT, check=True, timeout=300)
        with log('server.log') as output:
            server = subprocess.Popen([args.java, '-Xmx1536m', '-Dnolate.eta.simulator-fixture=true',
                '-Dnolate.eta.alighting-replay=' + str(phase == 'planned-alighting').lower(),
                '-Dnolate.eta.first-alighting-replay=' + str(phase == 'planned-first-alighting').lower(),
                '-Dnolate.eta.reported-boarding-replay=' + str(phase == 'reported-boarding').lower(),
                '-Dnolate.eta.first-alighting-risk=' + str(args.first_alighting_risk).lower(),
                '-Dnolate.eta.first-timetable-alighting=' + str(args.first_timetable_alighting).lower(),
                f'-Dnolate.eta.simulator-fixture.port={args.api_port}',
                '-Dnolate.eta.native-delivery-lead-seconds=' + ('240' if phase == 'early-transfer-risk' else
                    '90' if phase in ('early-transfer', 'first-alighting-late') else
                    '60' if phase in ('onward-delay', 'transfer-observed', 'transfer-first-unobserved', 'planned-postdeparture') else '600'),
                '-classpath', (root / 'classpath.txt').read_text(),
                'com.noLate.eta.simulator.EtaSimulatorFixtureServer', str(root)], cwd=BE,
                stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        def ready():
            with urllib.request.urlopen(base + '/health/readiness', timeout=2) as response:
                return response.headers.get('X-NoLate-Eta-Fixture') == 'h2-memory-only' and json.loads(response.read())['status'] == 'UP'
        wait(ready, server)
        first_phase = 'transfer-observed' if postdeparture else phase
        server.stdin.write(first_phase + '\n')
        server.stdin.flush()
        # The fixture writes this file after the Worker commits; existence can
        # precede the final byte, so wait for a complete JSON document.
        wait(lambda: json.loads((root / (first_phase + '.json')).read_text()) is not None, server, 60)
        worker = json.loads((root / (first_phase + '.json')).read_text())
        assert worker['effectiveSnapshot']['accepted'] is (phase not in ('transfer-first-unobserved', 'early-transfer-risk'))
        target = instant(worker['targetArrivalAt']).astimezone(dt.timezone(dt.timedelta(hours=9))).isoformat()
        env = dict(os.environ, EXPO_PUBLIC_LOCAL_API_BASE_URL=base, EXPO_NO_DOTENV='1',
                   EXPO_PUBLIC_ODSAY_IOS_API_KEY='', EXPO_PUBLIC_ODSAY_ANDROID_API_KEY='',
                   EXPO_PUBLIC_ODSAY_ISOLATED_SIMULATOR_FIXTURE='1',
                   REACT_NATIVE_PACKAGER_HOSTNAME='127.0.0.1', CI='1')
        with log('metro.log') as output:
            metro = subprocess.Popen(['npx', 'expo', 'start', '--dev-client', '--localhost', '--port', '8086', '--max-workers', '2'],
                cwd=FE, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        def metro_ready():
            with urllib.request.urlopen('http://127.0.0.1:8086/status', timeout=2) as response:
                return response.read() == b'packager-status:running'
        wait(metro_ready, metro)
        report['metroPreparation'] = prepare_private_metro_bundle()
        emit(state='reset_and_open_pinned_via_xcuitest')
        report['startupTransport'] = open_private_client_with_xcuitest(DEVICE, root / 'ui-private-lifecycle')
        ui('testLoginDedicatedEtaAccount', 'ui-login', target, ['--credentials', str(root / 'credentials.json')])
        if postdeparture:
            # Evaluate after actual app preparation so source freshness is never extended for build latency.
            server.stdin.write(phase + '\n')
            server.stdin.flush()
            wait(lambda: json.loads((root / (phase + '.json')).read_text()) is not None, server, 60)
            worker = json.loads((root / (phase + '.json')).read_text())
            if phase == 'reported-boarding':
                assert worker['classification'] == 'SYNTHETIC_REPORTED_BOARDING_WORKER_CHAIN'
                assert worker['historyCount'] == 3
            else:
                assert worker['classification'] == 'SYNTHETIC_POST_DEPARTURE_WORKER'
                assert worker['processed'] == 1 and worker['historyCount'] == 2
                assert worker['recommendedDepartureAt'] == worker['beforeRecommendedDepartureAt']
                expected_basis = 'MATCHED_RIDE_AND_ONWARD_TIMETABLE' if phase == 'planned-first-alighting' else 'MATCHED_TRAIN_REALTIME'
                assert worker['provisionalPrediction']['basis'] == expected_basis
                if phase != 'planned-first-alighting':
                    delay_seconds = 30 if phase == 'planned-alighting' else 120
                    assert instant(worker['provisionalPrediction']['predictedArrivalAt']) == instant(worker['beforeArrivalAt']) + dt.timedelta(seconds=delay_seconds)
            # The private Worker advanced its logical clock to a future due time. Wait until
            # the device wall clock reaches that observation; never relax the app's source-age gate.
            seconds_until_observation = (instant(worker['evaluatedAt']) - dt.datetime.now(dt.timezone.utc)).total_seconds()
            assert seconds_until_observation < 180
            if seconds_until_observation > 0:
                time.sleep(seconds_until_observation + 2)
        ui('testVerifyIsolatedEtaFixture', 'ui-' + phase, target,
           ['--schedule-id', '363', '--existing-title', TITLE, '--fixture-phase', phase,
            '--fixture-evidence', str(root / (phase + '.json'))] +
           (['--fixture-first-timetable-alighting'] if args.first_timetable_alighting else []))
        public = json.loads((root / (phase + '-status.json')).read_text())
        if phase == 'reported-boarding':
            report['predictionAudit'] = verify_reported_boarding(worker, public)
        elif postdeparture:
            report['predictionAudit'] = verify_planned_postdeparture(worker, public)
        else:
            report['predictionAudit'] = verify_prediction(worker, public, phase, args.first_timetable_alighting)
        if args.calendar_smoke:
            # These normal UI mutations are confined to the same empty H2 member.
            # Run after ETA assertions so CRUD latency cannot invalidate their observation.
            calendar_ui('testCalendarCreateAndEdit', 'ui-calendar-create-edit')
            title = calendar_smoke_title((root / 'ui-calendar-create-edit' / 'run.log').read_text())
            # A second API login revokes the installed app's session. Prove restart
            # and authentication restoration first, without silently logging in again.
            calendar_ui('testSavedCalendarScheduleAfterProcessRestart', 'ui-calendar-relaunch', title)
            credentials = json.loads((root / 'credentials.json').read_text())
            member = fixture_api('/api/member/auth/login',
                                 {key: credentials[key] for key in ('email', 'password')})
            assert member['id'] == 296
            saved = verify_calendar_smoke_record(fixture_api('/api/schedules', token=member['accessToken']))
            assert saved['title'] == title
            report['calendarSmokeAudit'] = dict(result='PASSED', saved=saved,
                realUiCreateAndEdit=True, reloadedAfterProcessRestart=True, database='H2_MEMORY_ONLY')
        if phase == 'planned-alighting':
            assert '신림' in worker['queriedStations'] and '사당' not in worker['queriedStations']
            assert instant(worker['evaluatedAt']) > instant(worker['lastRidePredictedBoardingAt'])
            report['predictionAudit']['alightingStationSelectedAfterBoarding'] = True
        report['result'] = 'PASSED'
    except Exception as error:
        report['failureKind'] = type(error).__name__
        frame = traceback.extract_tb(error.__traceback__)[-1]
        # Do not serialize the exception message or locals: they can contain credentials.
        report['failureLocation'] = {'file': Path(frame.filename).name,
                                     'function': frame.name, 'line': frame.lineno}
    finally:
        if phase == 'early-transfer-risk' and (root / 'ui-login').exists() and server is not None and server.poll() is None:
            try:
                server.stdin.write('quota-cleanup\n')
                server.stdin.flush()
                cleanup = root / 'quota-cleanup.json'
                wait(lambda: json.loads(cleanup.read_text()) is not None, server, 30)
                subprocess.run(['xcrun', 'simctl', 'openurl', DEVICE, 'nolate://internal/eta-alarm-verification'],
                               check=True, timeout=30)
                ui('testVerifyIsolatedNativeAlarmState', 'ui-risk-alarm-cleanup', target,
                   ['--schedule-id', '363', '--existing-title', TITLE, '--native-mode', 'state',
                    '--native-evidence', str(cleanup)])
                report['nativeCleanup'] = 'PASSED'
            except Exception as error:
                report.update(result='PARTIAL', nativeCleanup=type(error).__name__)
        if metro is not None:
            report.update(restore_private_endpoint(DEVICE))
            if report.get('originalAppEndpointRestored') is not True:
                report['result'] = 'PARTIAL'
        if server is not None and server.poll() is None:
            try:
                server.stdin.write('stop\n')
                server.stdin.flush()
                server.wait(timeout=20)
            except (OSError, subprocess.TimeoutExpired):
                stop(server)
        stop(metro)
        (root / 'report.json').write_text(json.dumps(report, indent=2))
        emit(result=report['result'], evidenceRoot=str(root))
    return 0 if report['result'] == 'PASSED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
