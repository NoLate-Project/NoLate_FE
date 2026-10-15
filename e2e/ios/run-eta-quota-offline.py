#!/usr/bin/env python3
"""Quota-independent H2 Worker/API regression. Synthetic feeds are never live accuracy evidence."""
import argparse
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import urllib.request
from eta_pinned_app import reset_private_navigation, restore_private_endpoint, open_private_test_endpoint

WORKSPACE = Path(__file__).resolve().parents[3]
BE, FE = WORKSPACE / 'NoLate_BE', WORKSPACE / 'NoLate_FE'
DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'
BASE = 'http://127.0.0.1:5523'
SEOUL = dt.timezone(dt.timedelta(hours=9))
# Probe arrival first: its first persisted due time is one full minute after baseline,
# beyond the real 15s cache TTL. A valid cache hit is not an injected quota failure.
FAULTS = {'quota-arrival': 'arrival:ERROR-337', 'quota-timetable': 'timetable:ERROR-337',
          'quota-route': 'route:HTTP_429'}
QUALITY_FAULTS = {'quality-unobserved': 'arrival:UNOBSERVED', 'quality-stale': 'arrival:STALE',
                  'quality-unverified': 'arrival:UNVERIFIED', 'quality-error': 'arrival:API_ERROR',
                  'quality-timeout': 'arrival:TIMEOUT', 'quota-arrival': 'arrival:ERROR-337'}
QUALITY_CODES = dict(zip(QUALITY_FAULTS, ('TRANSIT_TRAIN_NOT_YET_OBSERVED', 'TRANSIT_ARRIVAL_SOURCE_STALE',
    'TRANSIT_ARRIVAL_SOURCE_UNVERIFIED', 'TRANSIT_ARRIVAL_API_ERROR', 'TRANSIT_ARRIVAL_API_TIMEOUT', 'TRANSIT_ARRIVAL_RATE_LIMITED')))


def suite_commands(quality=False, optimization=False):
    if optimization:
        return ['optimization-timeout', 'quota-recovered']
    return [*QUALITY_FAULTS, 'quota-recovered'] if quality else [item for fault in FAULTS for item in (fault, 'quota-recovered')]
walking_spec = importlib.util.spec_from_file_location('walking_fixture', Path(__file__).with_name('verify-eta-fixture.py'))
walking_fixture = importlib.util.module_from_spec(walking_spec)
walking_spec.loader.exec_module(walking_fixture)


def instant(value):
    parsed = dt.datetime.fromisoformat(value.replace(' ', 'T'))
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=dt.timezone.utc)


def verify_ui_summary(summary):
    assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
    assert summary['failedTests'] == summary['skippedTests'] == 0
    assert summary['devicesAndConfigurations']
    assert all(item['device']['deviceId'] == DEVICE for item in summary['devicesAndConfigurations'])


def verify_cleanup(value):
    assert value['classification'] == 'SCOPED_H2_NOTIFICATION_DISABLED_CLEANUP'
    assert value['database'] == 'H2_MEMORY_ONLY' and value['providersMocked'] is True
    assert value['etaEvaluated'] is False and value['historyCount'] == value['historyBefore']
    assert value['processed'] == 1 and value['jobStatus'] == 'CANCELED'
    assert value['retryCount'] == 0 and value['workerFailure'] is None
    assert value['savedScheduleInput'] == value['savedScheduleAfterEvaluation']
    assert len(value['alarmStates']) == 1
    state = value['alarmStates'][0]
    assert state['member_id'] == 296 and state['schedule_id'] == 363
    assert state['operation'] == 'CANCEL' and state['trigger_at'] is None


def failure_cleanup_snapshot(root, already_cancelled, evaluate):
    if not already_cancelled:
        return evaluate('quota-cleanup', 999)
    # Replay a verified, already committed CANCEL; do not run a CANCELED job twice.
    value = json.loads((root / 'quota-cleanup.json').read_text())
    verify_cleanup(value)
    (root / 'case-999.json').write_text(json.dumps(value, indent=2))
    return value


def verify_ride_timing(value, public):
    """Independent fixture arithmetic, not expectations copied from the returned clocks."""
    route = value['effectiveSnapshot']['effectiveTransitRoute']
    assert public['effectiveTransitRoute'] == route
    segments = route['segments']
    assert len(segments) == 5
    epoch = instant(value['epoch'])
    for index, train, line, raw_board, raw_arrival, board, arrival, basis in (
        (1, '4012', 'LINE_4', 197, 1397, 210, 1410, 'FIRST_BOARDING_REALTIME_ADJUSTED_TIMETABLE'),
        (3, '2012', 'LINE_2', 1800, 2281, 1800, 2281, 'TIMETABLE'),
    ):
        timing = segments[index]['rideTiming']
        table = timing['timetable']
        assert table['provider'] == 'fixture-timetable' and table['trainNumber'] == train
        assert table['line'] == line and table['directionCode'] == 'DOWN' and table['serviceClass'] == 'LOCAL'
        assert table['fromStationCode'] != table['toStationCode']
        assert instant(table['fetchedAt']) == instant(value['evaluatedAt'])
        assert instant(table['boardingAt']) == epoch + dt.timedelta(seconds=raw_board)
        assert instant(table['arrivalAt']) == epoch + dt.timedelta(seconds=raw_arrival)
        assert instant(timing['predictedBoardingAt']) == epoch + dt.timedelta(seconds=board)
        assert instant(timing['predictedArrivalAt']) == epoch + dt.timedelta(seconds=arrival)
        assert timing['basis'] == basis
    assert all(segment.get('rideTiming') is None for segment in segments if segment['kind'] == 'WALK')


def verify_case(value, baseline, previous, public):
    # A reminder boundary can produce a due check <15s after the previous evaluation.
    # Consume real persisted due checks until the original cache expires; never clear it
    # or mislabel a cache hit as the newly injected provider response.
    cached_checks = value.get('cacheEvaluations', [])
    assert len(cached_checks) <= 3
    for cached in cached_checks:
        assert cached['classification'] == 'SYNTHETIC_PROVIDER_WORKER' and cached['providersMocked'] is True
        assert cached['database'] == 'H2_MEMORY_ONLY' and cached['physicalTransitHttpCalls'] == 0
        assert cached['processed'] == 1 and cached['historyCount'] == previous['historyCount'] + 1
        assert cached['savedScheduleInput'] == cached['savedScheduleAfterEvaluation'] == baseline['savedScheduleInput']
        assert cached['alarmStates'] == cached['alarmBeforeEvaluation'] == previous['alarmStates']
        assert instant(cached['evaluatedAt']) == instant(previous['nextCheckAt'])
        assert instant(cached['nextCheckAt']) > instant(cached['evaluatedAt'])
        assert cached['injectedFaults'] == []
        assert cached['failureCode'] == previous['failureCode'] and cached['source'] == previous['source']
        assert cached['stale'] == previous['stale']
        previous = cached
    assert value['classification'] == 'SYNTHETIC_PROVIDER_WORKER'
    assert value['database'] == 'H2_MEMORY_ONLY' and value['providersMocked'] is True
    assert value['productionDatabaseModified'] is False and value['physicalTransitHttpCalls'] == 0
    assert value['processed'] == 1 and value['jobStatus'] == 'ACTIVE'
    assert value['historyCount'] == previous['historyCount'] + 1
    assert value['savedScheduleInput'] == value['savedScheduleAfterEvaluation'] == baseline['savedScheduleInput']
    assert instant(value['evaluatedAt']) == instant(previous['nextCheckAt'])
    assert instant(value['nextCheckAt']) > instant(value['evaluatedAt'])
    assert instant(value['recommendedDepartureAt']) == instant(baseline['recommendedDepartureAt'])
    alarm = value['alarmStates'][0]
    assert alarm['member_id'] == 296 and alarm['schedule_id'] == 363 and alarm['operation'] == 'UPSERT'
    assert instant(alarm['trigger_at']) == instant(baseline['alarmStates'][0]['trigger_at'])
    assert value['alarmBeforeEvaluation'] == previous['alarmStates']
    if value['scenario'] in FAULTS or value['scenario'] in QUALITY_FAULTS:
        assert (FAULTS | QUALITY_FAULTS)[value['scenario']] in value['injectedFaults']
        assert value['stale'] is True and value['failureCode']
        assert (value.get('effectiveSnapshot') or {}).get('accepted') is not True
        assert value['alarmStates'] == value['alarmBeforeEvaluation']
        if value['scenario'].startswith('quality-'):
            assert value['failureCode'] == QUALITY_CODES[value['scenario']]
            assert public.get('predictedArrivalAt') is None and public.get('effectiveTransitRoute') is None
            preview = public.get('futureTimetablePrediction')
            if value['scenario'] == 'quality-unobserved':
                assert preview == value['effectiveSnapshot']['effectiveTransitRoute']
                assert preview and value['effectiveSnapshot']['transitTimingBasis'] == 'TIMETABLE_ONLY'
                assert all(s['rideTiming']['basis'] == 'TIMETABLE' for s in preview['segments'] if s['kind'] != 'WALK')
            else:
                assert preview is None
    else:
        if value['scenario'] == 'optimization-timeout':
            assert value['injectedFaults'] == ['route:OPTIMIZATION_TIMEOUT']
            assert len(value['routeRequests']) == 2
            assert value['routeRequests'][0]['searchDttm'] != value['routeRequests'][1]['searchDttm']
        else:
            assert value['scenario'] == 'quota-recovered' and not value['injectedFaults']
        assert value['source'] == 'LIVE_PROVIDER' and value['stale'] is False and value['failureCode'] is None
        assert value['effectiveSnapshot']['accepted'] is True
        assert instant(value['predictedArrivalAt']) == instant(value['epoch']) + dt.timedelta(seconds=2452)
        verify_ride_timing(value, public)
    assert public['scheduleId'] == 363 and public['source'] == value['source']
    assert public['stale'] == value['stale']
    history = value['evaluationHistory']
    assert history['memberId'] == 296 and history['scheduleId'] == 363
    assert history['source'] == value['source'] and history['stale'] == value['stale']
    assert history['failureCode'] == value['failureCode']
    assert instant(history['evaluatedAt']) == instant(value['evaluatedAt'])
    assert (public.get('failureReason') or '').split(':')[0] == (value['failureCode'] or '')
    assert instant(public['recommendedDepartureAt']) == instant(value['recommendedDepartureAt'])
    return {'scenario': value['scenario'], 'result': 'PASSED', 'failureCode': value['failureCode'],
            'validCacheChecks': len(cached_checks),
            'historyCount': value['historyCount'], 'physicalTransitHttpCalls': 0}


def audit_run(root):
    """Read-only acceptance gate, including results produced by an older running orchestrator."""
    root = root.resolve(strict=True)
    assert str(root).startswith('/private/tmp/nolate-eta-mock-e2e.')
    report = json.loads((root / 'report.json').read_text())
    assert report['classification'] == 'SYNTHETIC_QUOTA_REGRESSION' and report['result'] == 'PASSED'
    assert report['providersMocked'] is True and report['productionDatabaseModified'] is False
    assert report['actualProviderAcceptance'] == report['mapAccuracy'] == report['actualFcm'] == 'NOT_TESTED'
    commands = suite_commands(report.get('arrivalQualitySuite', False), report.get('optimizationFailureSuite', False))
    assert len(report['cases']) == len(commands)
    baseline = previous = json.loads((root / 'case-0.json').read_text())
    assert baseline['source'] == 'LIVE_PROVIDER' and baseline['stale'] is False
    assert baseline['effectiveSnapshot']['accepted'] is True and baseline['physicalTransitHttpCalls'] == 0
    assert instant(baseline['predictedArrivalAt']) == instant(baseline['epoch']) + dt.timedelta(seconds=2452)
    for index, command in enumerate(commands, 1):
        worker = json.loads((root / f'case-{index}.json').read_text())
        assert worker['scenario'] == command
        verify_case(worker, baseline, previous, json.loads((root / f'case-{index}-status.json').read_text()))
        if command in ('quota-recovered', 'optimization-timeout'):
            walking_fixture.verify_walking_metadata(json.loads((root / f'case-{index}-status.json').read_text()),
                                                     worker['effectiveSnapshot'])
        if report['simulatorRequested']:
            run = root / f'ui-{index}-{command}'
            meta = json.loads((run / 'metadata.json').read_text())
            assert meta['device'] == DEVICE and meta['memberScope'] == 296 and meta['apiBase'] == BASE
            assert meta['method'] == 'testVerifyIsolatedQuotaEta' and meta['allowSave'] is False
            verify_ui_summary(json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results',
                'summary', '--path', str(run / 'result.xcresult')], timeout=30)))
            assert 'ETA_QUOTA_SYNTHETIC_UI_VERIFIED:' in (run / 'run.log').read_text()
            if command in ('quota-recovered', 'optimization-timeout'):
                assert 'ETA_RIDE_TIMING_SYNTHETIC_UI_VERIFIED: first-live-and-transfer-timetable' in (run / 'run.log').read_text()
                assert 'ETA_WALK_BOUNDARY_SYNTHETIC_UI_VERIFIED: seconds-distance-unknown-platform' in (run / 'run.log').read_text()
        previous = worker
    cleanup = json.loads((root / f'case-{len(commands) + 1}.json').read_text())
    verify_cleanup(cleanup)
    if report['simulatorRequested']:
        assert report['nativePendingCleanup'] == 'PASSED' and report['originalAppEndpointRestored'] is True
        run = root / 'ui-native-cleanup'
        verify_ui_summary(json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results',
            'summary', '--path', str(run / 'result.xcresult')], timeout=30)))
        native_spec = importlib.util.spec_from_file_location('native_state', Path(__file__).with_name('verify-eta-native-state.py'))
        native = importlib.util.module_from_spec(native_spec)
        native_spec.loader.exec_module(native)
        text = (run / 'run.log').read_text()
        records = [json.loads(line.split(': ', 1)[1]) for line in text.splitlines()
                   if line.startswith('ETA_NATIVE_STATE_EVIDENCE: ')]
        assert len(records) == 2 and 'ETA_NATIVE_DUPLICATE_REPLAY_VERIFIED' in text
        for record in records:
            native.verify_record(cleanup, record)
    return {'result': 'PASSED', 'classification': 'SYNTHETIC_QUOTA_REGRESSION',
            'backendCases': len(commands), 'simulatorCases': len(commands) if report['simulatorRequested'] else 0,
            'physicalTransitHttpCalls': 0, 'actualAccuracy': 'NOT_TESTED'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', default='java', help='JDK 21 java executable')
    parser.add_argument('--simulator', action='store_true', help='Also drive the pinned installed iOS app; own Metro on 8086 only')
    parser.add_argument('--arrival-quality', action='store_true', help='Future unobserved/source age/API diagnostics plus recovery; synthetic only')
    parser.add_argument('--optimization-failure', action='store_true', help='Second route search times out after a verified journey; actual Worker/API/UI, synthetic feeds')
    parser.add_argument('--audit-root', type=Path, help='Read-only audit of an existing run; no server, simulator or API calls')
    args = parser.parse_args()
    if args.arrival_quality and args.optimization_failure:
        parser.error('Select one bounded regression suite')
    if args.audit_root is not None:
        try:
            print(json.dumps(audit_run(args.audit_root)))
            return 0
        except Exception as error:
            print(json.dumps({'result': 'FAILED', 'failureKind': type(error).__name__}))
            return 1
    root = Path(tempfile.mkdtemp(prefix='nolate-eta-mock-e2e.', dir='/private/tmp')).resolve()
    server = metro = None
    ui_authenticated = False
    cases = []
    report = {'classification': 'SYNTHETIC_QUOTA_REGRESSION', 'result': 'FAILED', 'providersMocked': True,
              'actualProviderAcceptance': 'NOT_TESTED', 'mapAccuracy': 'NOT_TESTED', 'actualFcm': 'NOT_TESTED',
              'productionDatabaseModified': False, 'simulatorRequested': args.simulator, 'cases': cases,
              'arrivalQualitySuite': args.arrival_quality, 'optimizationFailureSuite': args.optimization_failure}

    def emit(**value):
        print(json.dumps(value), flush=True)

    def log(name):
        return os.fdopen(os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')

    def free(port):
        result = subprocess.run(['/usr/sbin/lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-t'], capture_output=True)
        if result.returncode not in (0, 1) or result.stdout.strip():
            raise RuntimeError(f'port_{port}_already_owned_no_process_stopped')

    def wait(check, process, seconds=150):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('owned_process_exited')
            try:
                if check():
                    return
            except (OSError, ValueError):
                pass
            time.sleep(0.5)
        raise RuntimeError('bounded_wait_timeout')

    def request(path, body=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=5) as response:
            assert response.headers.get('X-NoLate-Eta-Fixture') == 'h2-memory-only'
            return json.loads(response.read())

    def phase(command, index):
        path = root / (command + '.json')
        old = path.stat().st_mtime_ns if path.exists() else -1
        server.stdin.write(command + '\n')
        server.stdin.flush()
        wait(lambda: path.exists() and path.stat().st_mtime_ns != old and path.stat().st_size > 0, server, 60)
        value = json.loads(path.read_text())
        (root / f'case-{index}.json').write_text(json.dumps(value, indent=2))
        return value

    def ui(method, target, name, extra=()):
        cmd = ['python3', 'e2e/ios/run-eta.py', '--device', DEVICE, '--output', str(root / name),
               '--only', method, '--title', 'ETA E2E isolated fixture', '--target-arrival', target,
               '--api-base', BASE] + list(extra)
        emit(state='ui_start', case=name)
        with log(name + '.log') as output:
            process = subprocess.Popen(cmd, cwd=FE, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = process.wait(timeout=360)
            except subprocess.TimeoutExpired:
                stop(process)
                raise
            if code:
                raise RuntimeError('ui_test_failed')
        summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary',
                                                     '--path', str(root / name / 'result.xcresult')], timeout=30))
        verify_ui_summary(summary)
        (root / (name + '-summary.json')).write_text(json.dumps(summary, indent=2))
        if method == 'testVerifyIsolatedQuotaEta':
            assert 'ETA_QUOTA_SYNTHETIC_UI_VERIFIED:' in (root / name / 'run.log').read_text()
        emit(state='ui_passed', case=name)

    def stop(process):
        if process is not None and process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=10)

    try:
        emit(state='starting', evidenceRoot=str(root))
        free(5523)
        if args.simulator:
            free(8086)
        with log('compile.log') as output:
            subprocess.run(['./gradlew', '-I', 'e2e/eta-fixture.init.gradle', 'etaSimulatorFixtureClasspath',
                            '-PetaFixtureOutput=' + str(root), '--console=plain'], cwd=BE,
                           stdout=output, stderr=subprocess.STDOUT, check=True, timeout=300)
        with log('server.log') as output:
            server = subprocess.Popen([args.java, '-Xmx1536m', '-Dnolate.eta.simulator-fixture=true',
                '-Dnolate.eta.native-delivery-lead-seconds=600', '-classpath', (root / 'classpath.txt').read_text(),
                'com.noLate.eta.simulator.EtaSimulatorFixtureServer', str(root)], cwd=BE,
                stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        wait(lambda: request('/health/readiness')['status'] == 'UP', server)
        baseline = previous = phase('success', 0)
        assert baseline['source'] == 'LIVE_PROVIDER' and baseline['stale'] is False
        assert baseline['physicalTransitHttpCalls'] == 0 and baseline['effectiveSnapshot']['accepted'] is True
        credentials = json.loads((root / 'credentials.json').read_text())
        token = None
        if args.simulator:
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
            ui('testLoginDedicatedEtaAccount', dt.datetime.fromisoformat(baseline['targetArrivalAt']).astimezone(SEOUL).isoformat(),
               'ui-login', ('--credentials', str(root / 'credentials.json')))
            ui_authenticated = True
        else:
            token = request('/api/member/auth/login', {key: credentials[key] for key in ('email', 'password')})['data']['accessToken']
        commands = suite_commands(args.arrival_quality, args.optimization_failure)
        for index, command in enumerate(commands, 1):
            value = phase(command, index)
            cached_checks = []
            while (command in (FAULTS | QUALITY_FAULTS) or command == 'optimization-timeout') and not value['injectedFaults']:
                if len(cached_checks) >= 3:
                    raise RuntimeError('fault_not_reached_within_persisted_cache_checks')
                cached_checks.append(value)
                emit(state='valid_cache_reused', scenario=command, nextCheckAt=value['nextCheckAt'])
                value = phase(command, index)
            if cached_checks:
                value['cacheEvaluations'] = cached_checks
                (root / f'case-{index}.json').write_text(json.dumps(value, indent=2))
            if args.simulator:
                ui('testVerifyIsolatedQuotaEta', dt.datetime.fromisoformat(value['targetArrivalAt']).astimezone(SEOUL).isoformat(),
                   f'ui-{index}-{command}', ('--quota-evidence', str(root / f'case-{index}.json'),
                       '--schedule-id', '363', '--existing-title', 'ETA E2E isolated fixture'))
                public = json.loads((root / (value['phase'] + '-status.json')).read_text())
            else:
                public = request('/api/schedules/363/departure-status', token=token)['data']
            (root / f'case-{index}-status.json').write_text(json.dumps(public, indent=2))
            result = verify_case(value, baseline, previous, public)
            if command in ('quota-recovered', 'optimization-timeout'):
                walking_fixture.verify_walking_metadata(public, value['effectiveSnapshot'])
                result['walkingBoundaryEvidencePreserved'] = True
            result['simulatorUi'] = 'PASSED' if args.simulator else 'NOT_TESTED'
            cases.append(result)
            previous = value
            emit(**result)
        report['result'] = 'PASSED'
        cleanup_index = len(commands) + 1
        cleanup = phase('quota-cleanup', cleanup_index)
        verify_cleanup(cleanup)
        report['backendCleanup'] = 'PASSED'
        if args.simulator:
            subprocess.run(['xcrun', 'simctl', 'openurl', DEVICE,
                            'nolate://internal/eta-alarm-verification'], check=True, timeout=30)
            ui('testVerifyIsolatedNativeAlarmState', dt.datetime.fromisoformat(cleanup['targetArrivalAt']).astimezone(SEOUL).isoformat(),
               'ui-native-cleanup', ('--native-evidence', str(root / f'case-{cleanup_index}.json'), '--native-mode', 'state',
                                    '--schedule-id', '363', '--existing-title', 'ETA E2E isolated fixture'))
            report['nativePendingCleanup'] = 'PASSED'
    except Exception as error:
        # Never print HTTP bodies, credentials, environment variables or raw server logs.
        report['failureKind'] = type(error).__name__
        emit(state='failed', kind=type(error).__name__, evidenceRoot=str(root))
    finally:
        if ui_authenticated and report.get('nativePendingCleanup') != 'PASSED' and server.poll() is None:
            # Failure evidence stays failed. Still cancel this run's synthetic alarm,
            # without deleting OS notifications directly or touching another account.
            try:
                # A successful backend cancellation must not be executed again just
                # because its OS inspection failed: that job is already CANCELED.
                # Replay the same authoritative CANCEL snapshot for native cleanup.
                cleanup = failure_cleanup_snapshot(root, report.get('backendCleanup') == 'PASSED', phase)
                subprocess.run(['xcrun', 'simctl', 'openurl', DEVICE,
                                'nolate://internal/eta-alarm-verification'], check=True, timeout=30)
                ui('testVerifyIsolatedNativeAlarmState', dt.datetime.fromisoformat(cleanup['targetArrivalAt']).astimezone(SEOUL).isoformat(),
                   'ui-failure-native-cleanup', ('--native-evidence', str(root / 'case-999.json'), '--native-mode', 'state',
                       '--schedule-id', '363', '--existing-title', 'ETA E2E isolated fixture'))
                report['nativePendingCleanup'] = 'PASSED_AFTER_FAILURE'
            except Exception as error:
                report['nativePendingCleanup'] = 'FAILED_' + type(error).__name__
                report['result'] = 'FAILED'
        if server is not None and server.poll() is None:
            try:
                server.stdin.write('stop\n')
                server.stdin.flush()
                server.wait(timeout=20)
            except (OSError, subprocess.TimeoutExpired):
                stop(server)
        stop(metro)
        if args.simulator and metro is not None:
            # The existing Metro/server were never stopped. Return only the pinned app to its prior local endpoint.
            report.update(restore_private_endpoint(DEVICE))
            report['originalAccountLogin'] = 'REQUIRED_PRIVATE_H2_SESSION_IS_NOT_PRODUCTION_AUTH'
            if not report['originalAppEndpointRestored']:
                report['result'] = 'FAILED'
        (root / 'report.json').write_text(json.dumps(report, indent=2))
        emit(result=report['result'], evidenceRoot=str(root), actualAccuracy='NOT_TESTED')
    if report['result'] == 'PASSED':
        try:
            emit(audit=audit_run(root))
        except Exception as error:
            report.update(result='FAILED', auditFailureKind=type(error).__name__)
            (root / 'report.json').write_text(json.dumps(report, indent=2))
            emit(result='FAILED', failureKind=type(error).__name__)
    return 0 if report['result'] == 'PASSED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
