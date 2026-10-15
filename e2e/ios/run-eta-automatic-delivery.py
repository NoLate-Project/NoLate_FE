#!/usr/bin/env python3
"""UI POST -> real @Scheduled Worker -> real feeds -> actual simulator OS alarm.

No manual Worker invocation, clock/result override, production write or FCM claim.
The test-classpath observer bounds real evaluations to three and stops on provider errors.
"""
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
from eta_pinned_app import reset_private_navigation, open_private_test_endpoint, restore_private_endpoint

WORKSPACE = Path(__file__).resolve().parents[3]
BE, FE = WORKSPACE / 'NoLate_BE', WORKSPACE / 'NoLate_FE'
DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'
BASE, TITLE = 'http://127.0.0.1:5523', 'ETA E2E real isolated fixture'
SEOUL = dt.timezone(dt.timedelta(hours=9))


def accepted(value):
    return (value.get('source') == 'LIVE_PROVIDER' and value.get('stale') is False
            and value.get('failureReason') is None and (value.get('effectiveSnapshot') or {}).get('accepted') is True)


def verify_saved_route(saved, provider):
    assert (saved['originLat'], saved['originLng'], saved['destinationLat'], saved['destinationLng']) == (
        37.65636195, 127.06342739, 37.48426844, 126.92977778)
    route = json.loads(saved['routeJson'])
    assert route['provider'] == provider
    rides = [leg for leg in route['transitLegs'] if leg['kind'] != 'WALK']
    assert len(rides) == 2 and all(leg['kind'] == 'SUBWAY' for leg in rides)
    assert [(leg['startName'].removesuffix('역'), leg['endName'].removesuffix('역')) for leg in rides] == [
        ('노원', '사당'), ('사당', '신림')]
    assert all(str(number) + '호선' in leg['lineName'] for leg, number in zip(rides, (4, 2)))


def next_observation_window(value, now):
    """Read-only planning from the actual timetable; no result/clock override.

    A future train cannot be required in today's current-arrival feed long
    before it approaches. Retain the three-evaluation cap, pause this private
    observer and wait on wall time rather than repeatedly consume provider calls.
    """
    if not (value.get('failureReason') or '').startswith('TRANSIT_TRAIN_NOT_YET_OBSERVED:'):
        return None
    target = dt.datetime.fromisoformat(value['targetArrivalAt'])
    candidates = []
    for event in (value.get('journeyTimingTrace') or {}).get('events', []):
        if event.get('method') != 'enrich' or dt.datetime.fromisoformat(event['arrivalAt']) > target:
            continue
        rides = [leg for leg in event.get('legs', []) if leg.get('mode') == 'SUBWAY']
        if not rides or not rides[0].get('timetable'):
            continue
        boarding = dt.datetime.fromisoformat(rides[0]['timetable']['boardingAt'])
        window = boarding - dt.timedelta(minutes=6)
        # Once a still-future candidate's window has opened, retain the real
        # scheduler's next due tick. Jumping to a later train skips the only
        # chance to observe this candidate before its access/boarding deadline.
        if window <= now < boarding:
            return None
        if now < window < now + dt.timedelta(minutes=25):
            candidates.append(window)
    return min(candidates) if candidates else None


def verify_automatic(value, previous=None):
    assert value['database'] == 'H2_MEMORY_ONLY' and value['providersMocked'] is False
    assert value['automaticScheduling'] is True and value['clockMode'] == 'SYSTEM_WALL_CLOCK'
    assert value['executionThread'].startswith('nolate-scheduler-')
    assert value['successfulUiCreateCount'] == value['processed'] == 1 and value['alertMode'] == 'ALARM'
    assert value['savedScheduleInput'] == value['savedScheduleAfterEvaluation']
    if previous is not None:
        assert value['historyCount'] == previous['historyCount'] + 1
        assert dt.datetime.fromisoformat(value['evaluatedAt']) >= dt.datetime.fromisoformat(previous['nextCheckAt'])
        assert value['savedScheduleInput'] == previous['savedScheduleInput']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', required=True)
    parser.add_argument('--copied-input', type=Path, required=True)
    parser.add_argument('--journey-provider', choices=('odsay', 'tmap'), default='odsay')
    parser.add_argument('--target-lead-minutes', type=int, choices=(75, 80, 90), default=75)
    parser.add_argument('--arm-delay-seconds', type=int, default=0)
    args = parser.parse_args()
    assert 0 <= args.arm_delay_seconds <= 900
    copied = args.copied_input.resolve(strict=True)
    assert str(copied).startswith('/private/tmp/nolate-real-naver-requery-04-')
    root = Path(tempfile.mkdtemp(prefix='nolate-eta-real-e2e.', dir='/private/tmp'))
    server = metro = None
    report = {'classification': 'UI_CREATE_AUTOMATIC_REAL_ETA_OS_DELIVERY_E2E', 'result': 'PARTIAL',
              'database': 'H2_MEMORY_ONLY', 'providersMocked': False, 'clockMode': 'SYSTEM_WALL_CLOCK',
              'productionDatabaseModified': False, 'existingServersStopped': False,
              'manualWorkerInvocations': 0, 'fcmDeliveryVerified': False, 'cases': [],
              'physicalIphoneSound': 'DEFERRED_BY_USER', 'nativeCleanup': 'NOT_RUN', 'journeyProvider': args.journey_provider}
    report.update(targetLeadMinutes=args.target_lead_minutes, realClockArmDelaySeconds=args.arm_delay_seconds)

    def emit(**v):
        print(json.dumps(v), flush=True)

    def log(name):
        return os.fdopen(os.open(root / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'wb')

    def stop(child):
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=10)

    def wait(check, timeout=180):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if server is not None and server.poll() is not None:
                raise RuntimeError('OwnedServerExited')
            try:
                value = check()
                if value:
                    return value
            except (OSError, ValueError):
                pass
            time.sleep(.5)
        raise TimeoutError('BoundedAutomaticWait')

    def read(name):
        p = root / name
        return json.loads(p.read_text()) if p.exists() and p.stat().st_size else None

    def command(name):
        if server is None or server.poll() is not None:
            raise RuntimeError('OwnedServerExitedBeforeCommand')
        server.stdin.write(name + '\n')
        server.stdin.flush()

    def ui(method, name, extra=(), native=None):
        cmd = ['python3', 'e2e/ios/run-eta.py', '--device', DEVICE, '--output', str(root / name),
               '--only', method, '--title', TITLE, '--target-arrival', target,
               '--api-base', BASE, '--real-isolated', '--real-automatic'] + list(extra)
        if native:
            subprocess.run(['xcrun', 'simctl', 'openurl', DEVICE, 'nolate://internal/eta-alarm-verification?readOnly=1'],
                           check=True, timeout=30)
            cmd += ['--native-evidence', str(root / native), '--native-mode', 'background' if name == 'ui-delivery' else 'state',
                    '--schedule-id', '363', '--existing-title', TITLE]
        emit(state='ui_start', case=name)
        with log(name + '-launcher.log') as output:
            child = subprocess.Popen(cmd, cwd=FE, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                if child.wait(timeout=660):
                    raise RuntimeError('UiFailed_' + name)
            finally:
                stop(child)
        summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary',
                            '--path', str(root / name / 'result.xcresult')], timeout=30))
        assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
        assert summary['failedTests'] == summary['skippedTests'] == 0
        assert all(x['device']['deviceId'] == DEVICE for x in summary['devicesAndConfigurations'])
        emit(state='ui_passed', case=name)

    try:
        emit(state='starting', evidenceRoot=str(root))
        for port in (5523, 8086):
            occupied = subprocess.run(['/usr/sbin/lsof', '-t', f'-iTCP:{port}', '-sTCP:LISTEN'], capture_output=True)
            assert occupied.returncode in (0, 1) and not occupied.stdout.strip(), 'Do not stop unrelated servers'
        with log('compile.log') as output:
            subprocess.run(['./gradlew', '-I', 'e2e/eta-fixture.init.gradle', 'etaSimulatorFixtureClasspath',
                            '-PetaFixtureOutput=' + str(root), '--console=plain'], cwd=BE, stdout=output,
                           stderr=subprocess.STDOUT, check=True, timeout=300)
        with log('server.log') as output:
            server = subprocess.Popen([args.java, '-Xmx1536m', '-Dnolate.eta.real-isolated=true',
                '-Dnolate.eta.real-automatic-delivery=true', '-classpath', (root / 'classpath.txt').read_text(),
                'com.noLate.eta.simulator.EtaRealProviderSimulatorServer', str(root), str(copied), args.journey_provider,
                str(args.target_lead_minutes)],
                cwd=BE, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        prepared = wait(lambda: read('prepared.json'))
        assert prepared['automaticScheduling'] and prepared['scheduleCountBeforeUi'] == prepared['jobCountBeforeUi'] == 0
        target = dt.datetime.fromisoformat(prepared['targetArrivalAt']).astimezone(SEOUL).isoformat()
        env = dict(os.environ, EXPO_PUBLIC_LOCAL_API_BASE_URL=BASE, EXPO_PUBLIC_TRANSIT_PROVIDER=args.journey_provider,
                   NOLATE_E2E_METRO_CACHE_NAMESPACE=root.name,
                   REACT_NATIVE_PACKAGER_HOSTNAME='127.0.0.1', CI='1')
        with log('metro.log') as output:
            metro = subprocess.Popen(['npx', 'expo', 'start', '--dev-client', '--localhost', '--port', '8086'],
                cwd=FE, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        def ready():
            with urllib.request.urlopen('http://127.0.0.1:8086/status', timeout=2) as r:
                return r.read() == b'packager-status:running'
        wait(ready)
        reset_private_navigation(DEVICE)
        open_private_test_endpoint(DEVICE)
        ui('testLoginDedicatedEtaAccount', 'ui-login', ('--credentials', str(root / 'credentials.json')))
        ui('testCreateIsolatedEtaJourney', 'ui-create', ('--allow-save',))
        created = wait(lambda: read('ui-created.json'))
        assert created['successfulUiCreateCount'] == 1 and created['method'] == 'POST'
        if args.arm_delay_seconds:
            arm_after = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=args.arm_delay_seconds)
            emit(state='waiting_real_clock_before_arming', notBefore=arm_after.isoformat())
            wait(lambda: dt.datetime.now(dt.timezone.utc) >= arm_after, args.arm_delay_seconds + 10)
        command('arm')
        armed = wait(lambda: read('armed.json'))
        assert armed['scheduleCount'] == armed['jobCount'] == 1 and armed['historyCount'] == 0
        registration = read('scheduler-registration.json')
        assert registration['registeredWorkerCount'] == 1 and registration['observedBeanIsScheduledTarget'] is True
        emit(state='waiting_actual_scheduler_no_manual_worker')
        previous = chosen = None
        for i in range(1, 4):
            def next_evaluation():
                value = read(f'evaluation-{i}.json')
                if value:
                    return value
                last = read('automatic-attempt-3.json')
                if last and last['historyCount'] < i:
                    raise RuntimeError('AutomaticWorkerCompletedWithoutNewHistory_' + last['jobStatus'])
                return None
            value = wait(next_evaluation, 390)
            verify_automatic(value, previous)
            verify_saved_route(value['savedScheduleInput'], args.journey_provider)
            report['cases'].append({'index': i, 'accepted': accepted(value), 'evaluatedAt': value['evaluatedAt'],
                                    'nextCheckAt': value['nextCheckAt'], 'executionThread': value['executionThread'],
                                    'failureCode': (value.get('failureReason') or '').split(':')[0]})
            emit(state='automatic_evaluation', **report['cases'][-1])
            if accepted(value):
                chosen = (i, value)
                # Retain this actual generation while observing its OS delivery. No ETA/time is changed.
                command('pause')
                # Read the actual installed app/API before the observation ages.
                # This screen only fetches status; it does not calculate ETA or
                # explicitly apply a native alarm generation.
                ui('testVerifyIsolatedRealProviderEta', 'ui-accepted-eta', (
                    '--real-isolated-evidence', str(root / f'evaluation-{i}.json'),
                    '--schedule-id', '363', '--existing-title', TITLE))
                public = read('ui-status.json')
                assert public['stale'] is False and public['source'] == 'LIVE_PROVIDER'
                for key in ('recommendedDepartureAt', 'predictedArrivalAt', 'travelMinutes'):
                    assert public[key] == value[key]
                report['installedAppEta'] = 'PASSED'
                # Start read-only native observation immediately. Its bounded
                # UI wait observes the normal foreground poll; a blind 65-second
                # sleep can itself miss a correctly scheduled near-term alarm.
                break
            previous = value
            if value.get('providerFailures'):
                raise RuntimeError('ProviderErrorNoRetry')
            if i < 3:
                window = next_observation_window(value, dt.datetime.now(dt.timezone.utc))
                if window:
                    command('pause')
                    report.setdefault('realClockObservationWaits', []).append(window.isoformat())
                    emit(state='waiting_real_train_observation_window', notBefore=window.isoformat())
                    wait(lambda: dt.datetime.now(dt.timezone.utc) >= window,
                         (window - dt.datetime.now(dt.timezone.utc)).total_seconds() + 10)
                    command('arm')
        assert chosen is not None, 'No real accepted automatic evaluation'
        i, value = chosen
        state, = value['alarmStates']
        assert state['operation'] == 'UPSERT'
        assert dt.datetime.fromisoformat(state['trigger_at']) == dt.datetime.fromisoformat(value['recommendedDepartureAt'])
        remaining = (dt.datetime.fromisoformat(state['trigger_at']) - dt.datetime.now(dt.timezone.utc)).total_seconds()
        assert 20 < remaining < 1200, 'Actual result must still permit observed future delivery'
        if remaining > 300:
            wait(lambda: dt.datetime.now(dt.timezone.utc) >= dt.datetime.fromisoformat(state['trigger_at']) - dt.timedelta(seconds=300), remaining)
        ui('testObserveIsolatedNativeAlarmDelivery', 'ui-delivery', native=f'evaluation-{i}.json')
        spec = importlib.util.spec_from_file_location('native_delivery', Path(__file__).with_name('run-eta-native-delivery.py'))
        native = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(native)
        report['delivery'] = native.verify_delivery(value, (root / 'ui-delivery/run.log').read_text(), 'background')
        report['result'] = 'PASSED'
    except KeyboardInterrupt:
        report.update(result='PARTIAL', failureKind='KeyboardInterrupt', failureStage='OperatorStoppedOwnedRun')
        emit(state='stopped_owned_run')
    except Exception as error:
        report.update(result='PARTIAL', failureKind=type(error).__name__, failureStage=str(error))
        emit(state='failed', kind=report['failureKind'])
    finally:
        if server is not None and server.poll() is None:
            try:
                if read('ui-created.json') is None:
                    report['nativeCleanup'] = 'NOT_REQUIRED_NO_UI_CREATION'
                else:
                    command('cancel')
                    cleanup = wait(lambda: read('cleanup.json'), 30)
                    # Cancellation too must use the normal foreground snapshot
                    # poll, never the inspection button's explicit replay.
                    sync_after = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=65)
                    wait(lambda: dt.datetime.now(dt.timezone.utc) >= sync_after, 80)
                    ui('testVerifyIsolatedNativeAlarmState', 'ui-cleanup', native='cleanup.json')
                    report['nativeCleanup'] = 'PASSED'
            except Exception as error:
                report.update(result='PARTIAL', nativeCleanup=type(error).__name__)
            try:
                command('stop')
                server.wait(timeout=30)
            except (subprocess.TimeoutExpired, BrokenPipeError, RuntimeError):
                stop(server)
        try:
            stop(metro)
        finally:
            try:
                report.update(restore_private_endpoint(DEVICE))
                if not report['originalAppEndpointRestored']:
                    report['result'] = 'PARTIAL'
            except Exception as error:
                report.update(result='PARTIAL', originalAppEndpointRestored=False, restoreFailure=type(error).__name__)
            finally:
                (root / 'report.json').write_text(json.dumps(report, indent=2))
                emit(result=report['result'], evidenceRoot=str(root))
    return 0 if report['result'] == 'PASSED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
