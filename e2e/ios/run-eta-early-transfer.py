#!/usr/bin/env python3
"""Synthetic early-train Worker -> API -> pinned installed-app regression; never map accuracy."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import urllib.request
from eta_pinned_app import DEVICE, reset_private_navigation, restore_private_endpoint, open_private_test_endpoint

WORKSPACE = Path(__file__).resolve().parents[3]
BE, FE = WORKSPACE / 'NoLate_BE', WORKSPACE / 'NoLate_FE'
BASE, TITLE = 'http://127.0.0.1:5523', 'ETA E2E isolated fixture'


def instant(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def verify_prediction(worker, public, phase='early-transfer'):
    assert worker['classification'] == 'SYNTHETIC_PROVIDER_WORKER'
    assert worker['providersMocked'] is True and worker['database'] == 'H2_MEMORY_ONLY'
    assert worker['physicalTransitHttpCalls'] == 0 and worker['productionDatabaseModified'] is False
    assert worker['phase'] == phase and worker['processed'] == worker['historyCount'] == 1
    assert public['scheduleId'] == worker['evaluationHistory']['scheduleId'] == 363
    assert worker['evaluationHistory']['memberId'] == 296
    assert worker['clockMode'] == 'FIXED_PRIVATE_BACKEND_SNAPSHOT_CLOCK'
    assert worker['alertMode'] == 'STANDARD' and worker['alarmStates'] == []
    assert worker['retryCount'] == 0 and worker['workerFailure'] is None
    assert worker['savedScheduleInput'] == worker['savedScheduleAfterEvaluation']
    assert worker['effectiveSnapshot']['accepted'] is (phase != 'transfer-first-unobserved')
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
    assert public['confidence'] == ('MEDIUM' if phase == 'transfer-observed' else 'HIGH')
    assert worker['failureCode'] is public['failureReason'] is None
    epoch = instant(worker['epoch'])
    at = lambda seconds: epoch + dt.timedelta(seconds=seconds)
    assert instant(worker['recommendedDepartureAt']) == instant(public['recommendedDepartureAt']) == at(0)
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
    assert instant(worker['predictedArrivalAt']) == instant(public['predictedArrivalAt']) == at(2452)
    route = public['effectiveTransitRoute']
    assert route == worker['effectiveSnapshot']['effectiveTransitRoute']
    assert route['totalMinutes'] == public['travelMinutes'] == 41
    # The public departure recommendation is minute-rounded; the preserved route starts 26s later.
    assert instant(route['departureAt']) == at(26) and instant(route['arrivalAt']) == at(2452)
    assert public['routeChanged'] is False and public['onTimeArrivalPossible'] is True
    walks = [s for s in route['segments'] if s['kind'] == 'WALK']
    assert [s['durationSeconds'] for s in walks] == [111, 243, 171]
    first, onward = [s['rideTiming'] for s in route['segments'] if s['kind'] == 'SUBWAY']
    assert first['timetable']['trainNumber'] == '4012' and onward['timetable']['trainNumber'] == '2012'
    for timing, board, arrival, predicted_board, predicted_arrival in (
        (first, 330, 1530, 197, 1397), (onward, 1800, 2281, 1800, 2281),
    ):
        assert instant(timing['timetable']['boardingAt']) == at(board)
        assert instant(timing['timetable']['arrivalAt']) == at(arrival)
        assert instant(timing['predictedBoardingAt']) == at(predicted_board)
        assert instant(timing['predictedArrivalAt']) == at(predicted_arrival)
    queries = [instant(q['notBefore']) for q in worker['timetableQueries'] if q['line'] == 'LINE_2']
    assert at(1833) in queries and at(1700) in queries  # Both include the same 243s walk + 60s margin.
    observation = public['firstBoardingObservation']
    assert observation['trainNumber'] == '4012'
    assert instant(observation['expectedBoardingAt']) == at(197)
    assert instant(observation['readyAt']) >= at(171)
    age = (instant(worker['evaluatedAt']) - instant(observation['sourceUpdatedAt'])).total_seconds()
    assert -60 <= age <= 120
    return {'result': 'PASSED', 'syntheticImprovementSeconds': 300,
            'walkingAndMarginPreserved': True, 'actualTripAccuracyVerified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', required=True)
    parser.add_argument('--phase', choices=('early-transfer', 'transfer-observed', 'transfer-first-unobserved', 'planned-postdeparture'), default='early-transfer')
    args = parser.parse_args()
    phase = args.phase
    root = Path(tempfile.mkdtemp(prefix='nolate-eta-mock-e2e.', dir='/private/tmp')).resolve()
    server = metro = None
    report = {'classification': 'SYNTHETIC_' + phase.upper().replace('-', '_') + '_SIMULATOR_E2E', 'result': 'PARTIAL',
              'providersMocked': True, 'database': 'H2_MEMORY_ONLY', 'physicalTransitHttpCalls': 0,
              'productionDatabaseModified': False, 'actualTripAccuracyVerified': False,
              'mapAccuracyWithinTwoMinutesVerified': False, 'nativeAlarmDeliveryVerified': False}

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
                   '--only', method, '--title', TITLE, '--target-arrival', target, '--api-base', BASE] + extra
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

    try:
        emit(state='starting', evidenceRoot=str(root))
        free(5523)
        free(8086)
        with log('compile.log') as output:
            subprocess.run(['./gradlew', '-I', 'e2e/eta-fixture.init.gradle', 'etaSimulatorFixtureClasspath',
                '-PetaFixtureOutput=' + str(root), '--console=plain'], cwd=BE, stdout=output,
                stderr=subprocess.STDOUT, check=True, timeout=300)
        with log('server.log') as output:
            server = subprocess.Popen([args.java, '-Xmx1536m', '-Dnolate.eta.simulator-fixture=true',
                '-Dnolate.eta.native-delivery-lead-seconds=' + ('60' if phase in ('transfer-observed', 'transfer-first-unobserved', 'planned-postdeparture') else '600'),
                '-classpath', (root / 'classpath.txt').read_text(),
                'com.noLate.eta.simulator.EtaSimulatorFixtureServer', str(root)], cwd=BE,
                stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        def ready():
            with urllib.request.urlopen(BASE + '/health/readiness', timeout=2) as response:
                return response.headers.get('X-NoLate-Eta-Fixture') == 'h2-memory-only' and json.loads(response.read())['status'] == 'UP'
        wait(ready, server)
        first_phase = 'transfer-observed' if phase == 'planned-postdeparture' else phase
        server.stdin.write(first_phase + '\n')
        server.stdin.flush()
        # The fixture writes this file after the Worker commits; existence can
        # precede the final byte, so wait for a complete JSON document.
        wait(lambda: json.loads((root / (first_phase + '.json')).read_text()) is not None, server, 60)
        if phase == 'planned-postdeparture':
            first = json.loads((root / 'transfer-observed.json').read_text())
            assert first['effectiveSnapshot']['accepted'] is True
            server.stdin.write('planned-postdeparture\n')
            server.stdin.flush()
            wait(lambda: json.loads((root / 'planned-postdeparture.json').read_text()) is not None, server, 60)
        worker = json.loads((root / (phase + '.json')).read_text())
        if phase == 'planned-postdeparture':
            assert worker['classification'] == 'SYNTHETIC_POST_DEPARTURE_WORKER'
            assert worker['processed'] == 1 and worker['historyCount'] == 2
            assert worker['recommendedDepartureAt'] == worker['beforeRecommendedDepartureAt']
            assert worker['provisionalPrediction']['basis'] == 'MATCHED_TRAIN_REALTIME'
            assert instant(worker['provisionalPrediction']['predictedArrivalAt']) == instant(worker['beforeArrivalAt']) + dt.timedelta(seconds=120)
            assert worker['plannedArrivalObservation']['routeIdentity'] == worker['inProgressPlanIdentity']
        else:
            assert worker['effectiveSnapshot']['accepted'] is (phase != 'transfer-first-unobserved')
        target = instant(worker['targetArrivalAt']).astimezone(dt.timezone(dt.timedelta(hours=9))).isoformat()
        env = dict(os.environ, EXPO_PUBLIC_LOCAL_API_BASE_URL=BASE, EXPO_PUBLIC_TRANSIT_PROVIDER='tmap',
                   REACT_NATIVE_PACKAGER_HOSTNAME='127.0.0.1', CI='1')
        with log('metro.log') as output:
            metro = subprocess.Popen(['npx', 'expo', 'start', '--dev-client', '--localhost', '--port', '8086'],
                cwd=FE, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        def metro_ready():
            with urllib.request.urlopen('http://127.0.0.1:8086/status', timeout=2) as response:
                return response.read() == b'packager-status:running'
        wait(metro_ready, metro)
        reset_private_navigation(DEVICE)
        open_private_test_endpoint(DEVICE)
        ui('testLoginDedicatedEtaAccount', 'ui-login', target, ['--credentials', str(root / 'credentials.json')])
        if phase == 'planned-postdeparture':
            # The private Worker advanced its logical clock to a future due time. Wait until
            # the device wall clock reaches that observation; never relax the app's source-age gate.
            seconds_until_observation = (instant(worker['evaluatedAt']) - dt.datetime.now(dt.timezone.utc)).total_seconds()
            assert seconds_until_observation < 180
            if seconds_until_observation > 0:
                time.sleep(seconds_until_observation + 2)
        ui('testVerifyIsolatedEtaFixture', 'ui-' + phase, target,
           ['--schedule-id', '363', '--existing-title', TITLE, '--fixture-phase', phase,
            '--fixture-evidence', str(root / (phase + '.json'))])
        public = json.loads((root / (phase + '-status.json')).read_text())
        if phase == 'planned-postdeparture':
            assert public['plannedJourneyArrivalPrediction']['basis'] == 'MATCHED_TRAIN_REALTIME'
            assert instant(public['plannedJourneyArrivalPrediction']['predictedArrivalAt']) == instant(worker['provisionalPrediction']['predictedArrivalAt'])
            assert instant(public['recommendedDepartureAt']) == instant(worker['beforeRecommendedDepartureAt'])
            report['predictionAudit'] = {'result': 'PASSED', 'sameTrainProvisionalOnly': True,
                                          'departureAlarmUnchanged': True, 'actualTripAccuracyVerified': False}
        else:
            report['predictionAudit'] = verify_prediction(worker, public, phase)
        report['result'] = 'PASSED'
    except Exception as error:
        report['failureKind'] = type(error).__name__
    finally:
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
