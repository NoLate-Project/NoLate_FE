#!/usr/bin/env python3
"""Pinned simulator OS delivery with synthetic ETA inputs; never physical/FCM/accuracy proof.

The locked case requires an operator to lock ONLY the pinned independent simulator window
after ETA_NATIVE_LOCK_READY appears in that case's run.log. No global UI automation is used.
"""
import argparse
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
import urllib.request
from eta_pinned_app import restore_private_endpoint, open_private_client_with_xcuitest
from eta_fixture_snapshot import wait_for_phase_snapshot

WORKSPACE = Path(__file__).resolve().parents[3]
BE, FE = WORKSPACE / 'NoLate_BE', WORKSPACE / 'NoLate_FE'
DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'
BASE, TITLE = 'http://127.0.0.1:5523', 'ETA E2E isolated fixture'
SEOUL = dt.timezone(dt.timedelta(hours=9))
# Exercise an off-minute clock so an unnoticed floor to the minute fails the audit.
NATIVE_FUTURE_LEAD_SECONDS = 277


def pinned_launchctl_application_pid(process_listing):
    """Parse launchctl output obtained ONLY via simctl spawn DEVICE, not host ps."""
    pattern = re.compile(r'UIKitApplication:com\.anonymous\.nolatefe\[[0-9A-Fa-f]+\]\[rb-legacy\]$')
    matches = []
    for line in process_listing.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) == 3 and fields[0].isdigit() and int(fields[0]) > 1 and pattern.fullmatch(fields[2]):
            matches.append(int(fields[0]))
    if len(matches) > 1:
        raise RuntimeError('ambiguous_pinned_app_process_no_sample_taken')
    return matches[0] if matches else None


def cold_start_sampling_window(text, now):
    # A buffered stdout marker can arrive after the entire UI test. Never
    # label a warm-process stack as a cold-start sample because it was read late.
    match = re.search(r'ETA_NATIVE_OS_DELIVERED: terminated: scheduled=\S+ observed=(\S+)', text)
    if match is None:
        return 'WAIT'
    try:
        observed = dt.datetime.fromisoformat(match.group(1))
        if observed.tzinfo is None or now.tzinfo is None:
            return 'INVALID'
        age = (now - observed).total_seconds()
    except ValueError:
        return 'INVALID'
    if age < 0:
        return 'INVALID'
    return 'WAIT' if age < 6 else 'READY' if age <= 15 else 'EXPIRED'


def load_native_verifier():
    spec = importlib.util.spec_from_file_location('native_state', Path(__file__).with_name('verify-eta-native-state.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_delivery(worker, text, mode):
    records = [json.loads(line.split(': ', 1)[1]) for line in text.splitlines()
               if line.startswith('ETA_NATIVE_SCHEDULED_EVIDENCE: ')]
    assert len(records) == 1
    load_native_verifier().verify_record(worker, records[0])
    match = re.search(r'ETA_NATIVE_OS_DELIVERED: ' + re.escape(mode) + r': scheduled=(\S+) observed=(\S+)', text)
    assert match is not None
    scheduled, observed = (dt.datetime.fromisoformat(value) for value in match.groups())
    plan = json.loads(worker['alarmStates'][0]['alarm_occurrences_json'])
    planned, = [item for item in plan if item['occurrenceId'] == 'M0']
    assert scheduled == dt.datetime.fromisoformat(planned['triggerAt'])
    seconds = (observed - scheduled).total_seconds()
    assert 0 <= seconds <= 25
    assert 'ETA_NATIVE_AUDIBLE_SOUND_NOT_MEASURED' in text
    if mode == 'locked':
        assert 'ETA_NATIVE_LOCK_READY' in text and 'ETA_NATIVE_LOCK_OBSERVED' in text
    return {'mode': mode, 'result': 'PASSED', 'scheduledAt': scheduled.isoformat(),
            'observedAt': observed.isoformat(), 'deliveryDelaySeconds': seconds,
            'audibleSoundMeasured': False}


def verify_ui_result(run, mode):
    meta = json.loads((run / 'metadata.json').read_text())
    assert meta['device'] == DEVICE and meta['apiBase'] == BASE and meta['memberScope'] == 296
    assert meta['nativeMode'] == mode and meta['allowSave'] is False
    assert meta['method'] == ('testVerifyIsolatedNativeAlarmState' if mode == 'state' else 'testObserveIsolatedNativeAlarmDelivery')
    summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary',
        '--path', str(run / 'result.xcresult')], timeout=30))
    assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
    assert summary['failedTests'] == summary['skippedTests'] == 0 and summary['devicesAndConfigurations']
    assert all(x['device']['deviceId'] == DEVICE for x in summary['devicesAndConfigurations'])


def verify_initial_arming(worker, login_summary):
    assert login_summary['result'] == 'Passed'
    assert login_summary['passedTests'] == login_summary['totalTestCount'] == 1
    assert login_summary['failedTests'] == login_summary['skippedTests'] == 0
    assert login_summary['devicesAndConfigurations']
    assert all(row['device']['deviceId'] == DEVICE for row in login_summary['devicesAndConfigurations'])
    finished = dt.datetime.fromtimestamp(login_summary['finishTime'], dt.timezone.utc)
    evaluated = dt.datetime.fromisoformat(worker['evaluatedAt'].replace('Z', '+00:00'))
    scheduled = dt.datetime.fromisoformat(worker['alarmStates'][0]['trigger_at'].replace('Z', '+00:00'))
    assert scheduled > evaluated >= finished, 'Measured M0 must be created after actual login completes'
    return {'result': 'PASSED', 'loginFinishedAt': finished.isoformat(),
            'workerEvaluatedAt': evaluated.isoformat(), 'scheduledAt': scheduled.isoformat()}


def verify_off_minute_trigger(worker):
    trigger = dt.datetime.fromisoformat(worker['alarmStates'][0]['trigger_at'])
    departure = dt.datetime.fromisoformat(worker['recommendedDepartureAt'])
    assert trigger == departure and trigger.second != 0, 'ETA seconds must survive M0 scheduling'


def verify_cancel_state(root, name, worker):
    assert worker['alarmStates'][0]['operation'] == 'CANCEL'
    verify_ui_result(root / name, 'state')
    text = (root / name / 'run.log').read_text()
    records = [json.loads(line.split(': ', 1)[1]) for line in text.splitlines()
               if line.startswith('ETA_NATIVE_STATE_EVIDENCE: ')]
    assert len(records) == 2 and 'ETA_NATIVE_DUPLICATE_REPLAY_VERIFIED' in text
    for record in records:
        load_native_verifier().verify_record(worker, record)


def audit_run(root):
    root = root.resolve(strict=True)
    assert str(root).startswith('/private/tmp/nolate-eta-mock-e2e.')
    report = json.loads((root / 'report.json').read_text())
    assert report['classification'] == 'REAL_OS_DELIVERY_SYNTHETIC_ETA_SIMULATOR_E2E'
    assert report['result'] == report['nativePendingCleanup'] == 'PASSED'
    assert report['providersMocked'] is True and report['productionDatabaseModified'] is False
    assert report['physicalTransitHttpCalls'] == 0 and report['originalAppEndpointRestored'] is True
    # First runner revision always requested all four modes; never infer a pass
    # from a shorter legacy list when the explicit requestedModes field is absent.
    modes = report.get('requestedModes', ['foreground', 'background', 'terminated', 'locked'])
    assert len(modes) == len(set(modes)) and set(modes) <= {'foreground', 'background', 'terminated', 'locked'}
    cases = []
    previous = None
    for mode in modes:
        name = 'ui-delivery-' + mode
        worker = json.loads((root / (name + '-worker.json')).read_text())
        assert worker['physicalTransitHttpCalls'] == 0
        if report.get('offMinuteTriggerRequired'):
            verify_off_minute_trigger(worker)
        if previous is None and report.get('armingBeginsAfterLogin'):
            login = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary',
                '--path', str(root / 'ui-login' / 'result.xcresult')], timeout=30))
            assert verify_initial_arming(worker, login) == report['initialArmingAudit']
        if previous is not None:
            cancel_name = 'ui-cancel-before-' + mode
            cancel = json.loads((root / (cancel_name + '-worker.json')).read_text())
            assert cancel['alarmBeforeEvaluation'] == previous['alarmStates']
            assert cancel['alarmStates'][0]['cancellation_reason'] == 'TRANSIT_TRANSFER_FAILURE'
            verify_cancel_state(root, cancel_name, cancel)
            assert worker['alarmBeforeEvaluation'] == cancel['alarmStates']
            assert worker['alarmStates'][0]['generation'] > cancel['alarmStates'][0]['generation']
        verify_ui_result(root / name, mode)
        cases.append(verify_delivery(worker, (root / name / 'run.log').read_text(), mode))
        previous = worker
    assert cases == report['cases']
    name = 'ui-native-cleanup'
    worker = json.loads((root / (name + '-worker.json')).read_text())
    assert worker['etaEvaluated'] is False and worker['jobStatus'] == 'CANCELED'
    verify_cancel_state(root, name, worker)
    return {'result': 'PASSED', 'modes': modes, 'nativeAndOsPendingAfterCleanup': 0,
            'physicalIphone': 'DEFERRED_BY_USER', 'fcmDeliveryVerified': False,
            'audibleSoundMeasured': False, 'realWorldAccuracyVerified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java')
    parser.add_argument('--audit-root', type=Path, help='Read-only audit; no app or provider calls')
    parser.add_argument('--modes', nargs='+', choices=('foreground', 'background', 'terminated', 'locked'),
                        default=['foreground', 'background', 'terminated', 'locked'])
    parser.add_argument('--trace-cold-start', action='store_true',
                        help='Read-only process sample after a terminated notification tap; diagnostic, not a latency benchmark')
    args = parser.parse_args()
    if args.audit_root is not None:
        try:
            print(json.dumps(audit_run(args.audit_root)))
            return 0
        except Exception as error:
            print(json.dumps({'result': 'FAILED', 'failureKind': type(error).__name__}))
            return 1
    if not args.java:
        parser.error('--java is required for a new execution')
    if args.trace_cold_start and args.modes != ['terminated']:
        parser.error('Cold-start sampling is scoped to a single terminated-app case')
    assert len(set(args.modes)) == len(args.modes)
    root = Path(tempfile.mkdtemp(prefix='nolate-eta-mock-e2e.', dir='/private/tmp')).resolve()
    server = metro = None
    authenticated = False
    report = {'classification': 'REAL_OS_DELIVERY_SYNTHETIC_ETA_SIMULATOR_E2E', 'result': 'FAILED',
              'device': DEVICE, 'providersMocked': True, 'database': 'H2_MEMORY_ONLY',
              'physicalTransitHttpCalls': 0, 'productionDatabaseModified': False,
              'existingServersStopped': False, 'physicalIphone': 'DEFERRED_BY_USER',
              'fcmDeliveryVerified': False, 'audibleSoundMeasured': False,
              'realWorldAccuracyVerified': False, 'requestedModes': args.modes, 'cases': [],
              'armingBeginsAfterLogin': True, 'nativeFutureLeadSeconds': NATIVE_FUTURE_LEAD_SECONDS,
              'offMinuteTriggerRequired': True,
              'coldStartDiagnostic': {'enabled': args.trace_cold_start, 'samples': [],
                                      'latencyBenchmarkClaimed': False}}

    def emit(**value):
        print(json.dumps(value), flush=True)

    def log(name):
        return os.fdopen(os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')

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
                raise RuntimeError('owned_process_exited')
            try:
                if check():
                    return
            except (OSError, ValueError):
                pass
            time.sleep(0.5)
        raise RuntimeError('bounded_wait_timeout')

    def phase(command, name):
        path = root / (command + '.json')
        before = path.stat().st_mtime_ns if path.exists() else -1
        server.stdin.write(command + '\n')
        server.stdin.flush()
        value = wait_for_phase_snapshot(path, before, server)
        assert value['processed'] == 1 and value['retryCount'] == 0 and value['workerFailure'] is None
        assert value['savedScheduleInput'] == value['savedScheduleAfterEvaluation']
        (root / (name + '.json')).write_text(json.dumps(value, indent=2))
        return value

    def ui(method, value, name, mode=None, extra=()):
        target = dt.datetime.fromisoformat(value['targetArrivalAt']).astimezone(SEOUL).isoformat()
        cmd = ['python3', 'e2e/ios/run-eta.py', '--device', DEVICE, '--output', str(root / name),
               '--only', method, '--title', TITLE, '--target-arrival', target, '--api-base', BASE] + list(extra)
        if mode:
            cmd += ['--native-evidence', str(root / (name + '-worker.json')), '--native-mode', mode,
                    '--schedule-id', '363', '--existing-title', TITLE]
            (root / (name + '-worker.json')).write_text(json.dumps(value, indent=2))
            if mode == 'state':
                # After a terminated-app case, a bare internal route can open the
                # Expo launcher rather than the private JS project. Restore only
                # the pinned 8086 client before checking the committed CANCEL.
                # This transport never counts as native/OS cleanup evidence.
                report.setdefault('stateInspectionTransports', []).append(
                    open_private_client_with_xcuitest(DEVICE, root / (name + '-private-lifecycle')))
            subprocess.run(['xcrun', 'simctl', 'openurl', DEVICE, 'nolate://internal/eta-alarm-verification'], check=True, timeout=30)
        emit(state='ui_start', case=name, mode=mode)
        with log(name + '-launcher.log') as output:
            child = subprocess.Popen(cmd, cwd=FE, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            lock_announced = False
            sampler = None
            sample_record = None
            lookup_attempts = 0
            next_lookup_at = 0
            deadline = time.monotonic() + 420
            try:
                while child.poll() is None:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('ui_timeout')
                    path = root / name / 'run.log'
                    if mode == 'locked' and not lock_announced and path.exists() and 'ETA_NATIVE_LOCK_READY' in path.read_text():
                        emit(state='LOCK_PINNED_SIMULATOR_NOW', device=DEVICE, case=name)
                        lock_announced = True
                    if args.trace_cold_start and mode == 'terminated' and path.exists():
                        window = cold_start_sampling_window(path.read_text(), dt.datetime.now(dt.timezone.utc))
                        if sampler is None and lookup_attempts < 3 and window in ('EXPIRED', 'INVALID'):
                            report['coldStartDiagnostic']['sampleNotTakenReason'] = window
                            lookup_attempts = 3
                        if sampler is None and window == 'READY' and lookup_attempts < 3 and time.monotonic() >= next_lookup_at:
                            lookup_attempts += 1
                            next_lookup_at = time.monotonic() + 2
                            try:
                                listing = subprocess.check_output(['xcrun', 'simctl', 'spawn', DEVICE,
                                    'launchctl', 'list'], text=True, timeout=3)
                                pid = pinned_launchctl_application_pid(listing)
                                # Lookup latency also counts. Refuse a now-warm sample.
                                if cold_start_sampling_window(path.read_text(), dt.datetime.now(dt.timezone.utc)) != 'READY':
                                    report['coldStartDiagnostic']['sampleNotTakenReason'] = 'LOOKUP_EXCEEDED_COLD_WINDOW'
                                    lookup_attempts = 3
                                    pid = None
                                if pid is not None:
                                    sample_path = root / 'cold-start-sample.txt'
                                    sample_record = {'classification': 'READ_ONLY_PINNED_PROCESS_SAMPLE',
                                        'pid': pid, 'startedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                                        'pidSource': 'PINNED_SIMCTL_LAUNCHCTL',
                                        'startedMonotonic': time.monotonic(), 'samplePath': str(sample_path)}
                                    report['coldStartDiagnostic']['samples'].append(sample_record)
                                    with log('cold-start-sample-launcher.log') as sample_output:
                                        sampler = subprocess.Popen(['/usr/bin/sample', str(pid), '2', '1', '-file', str(sample_path)],
                                            stdout=sample_output, stderr=subprocess.STDOUT, start_new_session=True)
                                    emit(state='sampling_pinned_cold_start', pid=pid)
                            except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                                report['coldStartDiagnostic']['lookupFailureKind'] = type(error).__name__
                                if sample_record is not None and sampler is None:
                                    sample_record['samplingLaunchFailureKind'] = type(error).__name__
                                    lookup_attempts = 3
                        if sampler is not None and sampler.poll() is None and time.monotonic() - sample_record['startedMonotonic'] > 25:
                            stop(sampler)
                            sample_record['samplerTimedOut'] = True
                    time.sleep(0.5)
                if child.returncode:
                    raise RuntimeError('ui_failed')
            finally:
                stop(sampler)
                if sample_record is not None:
                    sample_record['samplerExitCode'] = sampler.returncode if sampler is not None else None
                    sample_path = Path(sample_record['samplePath'])
                    if sample_path.exists():
                        sample_path.chmod(0o600)
                stop(child)
                if args.trace_cold_start and mode == 'terminated' and sample_record is None:
                    report['coldStartDiagnostic'].setdefault('sampleNotTakenReason',
                        'UI_FINISHED_WITHOUT_AN_ELIGIBLE_PINNED_PROCESS_SAMPLE')
        summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary',
            '--path', str(root / name / 'result.xcresult')], timeout=30))
        assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
        assert summary['failedTests'] == summary['skippedTests'] == 0 and summary['devicesAndConfigurations']
        assert all(x['device']['deviceId'] == DEVICE for x in summary['devicesAndConfigurations'])
        text = (root / name / 'run.log').read_text()
        if mode == 'state':
            records = [json.loads(line.split(': ', 1)[1]) for line in text.splitlines()
                       if line.startswith('ETA_NATIVE_STATE_EVIDENCE: ')]
            assert len(records) == 2 and 'ETA_NATIVE_DUPLICATE_REPLAY_VERIFIED' in text
            for record in records:
                load_native_verifier().verify_record(value, record)
            assert records[0]['osPending'] == records[1]['osPending']
        elif mode:
            report['cases'].append(verify_delivery(value, text, mode))
        emit(state='ui_passed', case=name)
        return summary

    def cleanup(name):
        value = phase('quota-cleanup', name + '-worker')
        assert value['jobStatus'] == 'CANCELED' and value['etaEvaluated'] is False
        ui('testVerifyIsolatedNativeAlarmState', value, name, 'state')
        report['nativePendingCleanup'] = 'PASSED'

    try:
        emit(state='starting', evidenceRoot=str(root))
        for port in (5523, 8086):
            check = subprocess.run(['/usr/sbin/lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-t'], capture_output=True)
            if check.returncode not in (0, 1) or check.stdout.strip():
                raise RuntimeError('occupied_port_no_process_stopped')
        with log('compile.log') as output:
            # --java governs both fixture compilation and execution. Otherwise
            # the macOS Java launcher may silently pick a different global JDK.
            java_home = str(Path(args.java).resolve(strict=True).parent.parent)
            subprocess.run(['./gradlew', '--no-daemon', '--max-workers=2', '-Dorg.gradle.java.home=' + java_home,
                '-I', 'e2e/eta-fixture.init.gradle', 'etaSimulatorFixtureClasspath',
                '-PetaFixtureOutput=' + str(root), '--console=plain'], cwd=BE, stdout=output,
                env=dict(os.environ, JAVA_HOME=java_home),
                stderr=subprocess.STDOUT, check=True, timeout=300)
        with log('server.log') as output:
            server = subprocess.Popen([args.java, '-Xmx1536m', '-Dnolate.eta.simulator-fixture=true',
                f'-Dnolate.eta.native-delivery-lead-seconds={NATIVE_FUTURE_LEAD_SECONDS}', '-classpath', (root / 'classpath.txt').read_text(),
                'com.noLate.eta.simulator.EtaSimulatorFixtureServer', str(root)], cwd=BE, stdin=subprocess.PIPE,
                stdout=output, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        def ready():
            with urllib.request.urlopen(BASE + '/health/readiness', timeout=2) as response:
                return response.headers.get('X-NoLate-Eta-Fixture') == 'h2-memory-only' and json.loads(response.read())['status'] == 'UP'
        wait(ready, server)
        # Login needs a future date parameter but must not arm an alarm. Slow
        # Metro/XCTest bootstrap must finish before creating a measured M0.
        login_context = {'targetArrivalAt': (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat()}
        env = dict(os.environ, EXPO_PUBLIC_LOCAL_API_BASE_URL=BASE, EXPO_PUBLIC_TRANSIT_PROVIDER='tmap',
                   REACT_NATIVE_PACKAGER_HOSTNAME='127.0.0.1', CI='1')
        with log('metro.log') as output:
            metro = subprocess.Popen(['npx', 'expo', 'start', '--dev-client', '--localhost', '--port', '8086', '--max-workers', '2'],
                cwd=FE, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        def metro_ready():
            with urllib.request.urlopen('http://127.0.0.1:8086/status', timeout=2) as response:
                return response.read() == b'packager-status:running'
        wait(metro_ready, metro)
        emit(state='reset_and_open_pinned_via_xcuitest')
        report['startupTransport'] = open_private_client_with_xcuitest(DEVICE, root / 'ui-private-lifecycle')
        login_summary = ui('testLoginDedicatedEtaAccount', login_context, 'ui-login', extra=('--credentials', str(root / 'credentials.json')))
        authenticated = True
        for index, mode in enumerate(args.modes):
            if index:
                cancel = phase('missed', 'cancel-before-' + mode)
                assert cancel['alarmStates'][0]['operation'] == 'CANCEL'
                ui('testVerifyIsolatedNativeAlarmState', cancel, 'ui-cancel-before-' + mode, 'state')
            # A new synthetic target is created once per mode, after login or
            # the prior cancellation is verified. Never move its M0 after arming.
            value = phase('success', 'success-before-' + mode)
            if index == 0:
                report['initialArmingAudit'] = verify_initial_arming(value, login_summary)
            assert value['source'] == 'LIVE_PROVIDER' and value['stale'] is False
            assert value['alarmStates'][0]['operation'] == 'UPSERT'
            assert value['physicalTransitHttpCalls'] == 0
            verify_off_minute_trigger(value)
            ui('testObserveIsolatedNativeAlarmDelivery', value, 'ui-delivery-' + mode, mode)
        cleanup('ui-native-cleanup')
        report['result'] = 'PASSED'
    except Exception as error:
        report['failureKind'] = type(error).__name__
        emit(state='failed', kind=type(error).__name__)
    finally:
        if authenticated and report.get('nativePendingCleanup') != 'PASSED' and server.poll() is None:
            try:
                cleanup('ui-failure-native-cleanup')
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
        if metro is not None:
            report.update(restore_private_endpoint(DEVICE))
            if not report['originalAppEndpointRestored']:
                report['result'] = 'FAILED'
        (root / 'report.json').write_text(json.dumps(report, indent=2))
        emit(result=report['result'], evidenceRoot=str(root), cases=report['cases'])
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
