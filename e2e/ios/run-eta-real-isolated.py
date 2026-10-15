#!/usr/bin/env python3
"""Bounded real-feed Worker/API/simulator validation; no production writes or OS alarm claims."""
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
BASE, TITLE = 'http://127.0.0.1:5523', 'ETA E2E real isolated fixture'
SEOUL = dt.timezone(dt.timedelta(hours=9))


def comparison_target(value, departure, now):
    """An explicit future appointment is input, never a computed ETA override."""
    if value is None:
        return None
    target = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if (target.tzinfo is None or not now < target <= now + dt.timedelta(hours=3)
            or target.second or target.microsecond
            or departure is None or target <= departure):
        raise ValueError('Comparison target requires a minute-aligned future departure and later appointment within three hours')
    return target.astimezone(dt.timezone.utc).isoformat()


def mark_failed(report, error):
    # A post-acceptance expiry/UI failure must revoke the overall pass too.
    # Preserve the successful rounds; do not export arbitrary exception text.
    report['result'] = 'PARTIAL'
    report['failureKind'] = type(error).__name__


def provider_error_requires_stop(value):
    # Optional walking HTTP is outside the station/timetable wire collector.
    # Stop on its auth/quota/application error too; never rotate keys or retry.
    walking = (value.get('walkingRefinement') or {}).get('failureCounts') or {}
    return (any(w['outcome'] in ('application_error', 'rate_limited') for w in value['providerWire'])
            or any(walking.get(code, 0) > 0 for code in
                   ('HTTP_AUTH', 'HTTP_QUOTA', 'PROVIDER_APPLICATION_ERROR')))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', required=True)
    parser.add_argument('--copied-input', type=Path, required=True, help='Existing approved read-only 296/367 snapshot')
    parser.add_argument('--max-evaluations', type=int, choices=(1, 2, 3), default=3,
                        help='Bound actual provider calls; fewer than two accepted UI cases remains PARTIAL')
    parser.add_argument('--journey-provider', choices=('tmap', 'odsay'), default='tmap',
                        help='ODsay uses a fresh selected route; the explicit evaluation bound applies to either provider')
    parser.add_argument('--target-lead-minutes', type=int, choices=(70, 75, 90), default=75,
                        help='Future test appointment only; real clock and provider acceptance remain unchanged')
    parser.add_argument('--planned-departure-at',
                        help='Future ISO-8601 saved departure input for matching the map query; never overrides the computed result')
    parser.add_argument('--target-arrival-at',
                        help='Optional future test appointment with --planned-departure-at; does not pin a train, result, or clock')
    parser.add_argument('--evaluation-not-before',
                        help='Wait for this real wall-clock instant before the first evaluation; never uses a fake clock')
    parser.add_argument('--verify-observation-expiry', action='store_true',
                        help='After the final accepted evaluation, wait for actual observation expiry and verify API/app degradation without requery')
    args = parser.parse_args()
    departure = None
    if args.planned_departure_at:
        departure = dt.datetime.fromisoformat(args.planned_departure_at.replace('Z', '+00:00'))
        now = dt.datetime.now(dt.timezone.utc)
        if (departure.tzinfo is None or not now < departure < now + dt.timedelta(hours=1)
                or departure.second or departure.microsecond):
            parser.error('Comparison departure must be a timezone-qualified, minute-aligned future instant within one hour')
    try:
        target_arrival_at = comparison_target(args.target_arrival_at, departure, dt.datetime.now(dt.timezone.utc))
    except ValueError as error:
        parser.error(str(error))
    evaluation_not_before = None
    if args.evaluation_not_before:
        evaluation_not_before = dt.datetime.fromisoformat(args.evaluation_not_before.replace('Z', '+00:00'))
        now = dt.datetime.now(dt.timezone.utc)
        if evaluation_not_before.tzinfo is None or not now < evaluation_not_before < now + dt.timedelta(minutes=10):
            parser.error('Evaluation wait must be timezone-qualified and within ten minutes')
    copied = args.copied_input.resolve(strict=True)
    if not str(copied).startswith('/private/tmp/nolate-real-naver-requery-04-'):
        parser.error('Only the previously scoped saved test input is supported')
    root = Path(tempfile.mkdtemp(prefix='nolate-eta-real-e2e.', dir='/private/tmp')).resolve()
    server = metro = None
    report = {'classification': 'REAL_PROVIDER_WORKER_API_SIMULATOR_E2E', 'result': 'PARTIAL',
              'productionDatabaseModified': False, 'existingServersStopped': False, 'evaluations': [],
              'physicalIphone': 'DEFERRED_BY_USER', 'fcmDeliveryVerified': False,
              'mapAccuracyWithinTwoMinutesVerified': False, 'actualTripAccuracyVerified': False}
    report['journeyProvider'] = args.journey_provider
    report['targetLeadMinutes'] = args.target_lead_minutes
    report['comparisonRequestedDepartureAt'] = args.planned_departure_at
    report['comparisonTargetArrivalAt'] = target_arrival_at
    report['evaluationNotBefore'] = args.evaluation_not_before

    def emit(**value):
        print(json.dumps(value), flush=True)

    def log(name):
        return os.fdopen(os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')

    def free(port):
        result = subprocess.run(['/usr/sbin/lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-t'], capture_output=True)
        if result.returncode not in (0, 1) or result.stdout.strip():
            raise RuntimeError('occupied_port_no_process_stopped')

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

    def stop(child):
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=10)

    def ready():
        with urllib.request.urlopen(BASE + '/health/readiness', timeout=2) as response:
            return (response.headers.get('X-NoLate-Eta-Real-Isolation') == 'h2-real-providers'
                    and json.loads(response.read())['status'] == 'UP' and (root / 'prepared.json').exists())

    def ui(method, name, extra=()):
        cmd = ['python3', 'e2e/ios/run-eta.py', '--device', DEVICE, '--output', str(root / name),
               '--only', method, '--title', TITLE, '--target-arrival', target, '--api-base', BASE,
               '--real-isolated'] + list(extra)
        emit(state='ui_start', case=name)
        with log(name + '-launcher.log') as output:
            child = subprocess.Popen(cmd, cwd=FE, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                if child.wait(timeout=360):
                    raise RuntimeError('ui_failed')
            finally:
                stop(child)
        summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results',
            'summary', '--path', str(root / name / 'result.xcresult')], timeout=30))
        assert summary['result'] == 'Passed' and summary['passedTests'] == summary['totalTestCount'] == 1
        assert summary['failedTests'] == summary['skippedTests'] == 0 and summary['devicesAndConfigurations']
        assert all(x['device']['deviceId'] == DEVICE for x in summary['devicesAndConfigurations'])
        emit(state='ui_passed', case=name)

    try:
        emit(state='starting', evidenceRoot=str(root))
        free(5523)
        free(8086)
        with log('compile.log') as output:
            subprocess.run(['./gradlew', '-I', 'e2e/eta-fixture.init.gradle', 'etaSimulatorFixtureClasspath',
                '-PetaFixtureOutput=' + str(root), '--console=plain'], cwd=BE,
                stdout=output, stderr=subprocess.STDOUT, check=True, timeout=300)
        with log('server.log') as output:
            server = subprocess.Popen([args.java, '-Xmx1536m', '-Dnolate.eta.real-isolated=true', '-classpath',
                (root / 'classpath.txt').read_text(), 'com.noLate.eta.simulator.EtaRealProviderSimulatorServer',
                str(root), str(copied), args.journey_provider, str(args.target_lead_minutes)] +
                ([args.planned_departure_at] if args.planned_departure_at else []) +
                ([target_arrival_at] if target_arrival_at else []), cwd=BE, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT,
                text=True, start_new_session=True)
        wait(ready, server)
        prepared = json.loads((root / 'prepared.json').read_text())
        assert prepared['providersMocked'] is False and prepared['database'] == 'H2_MEMORY_ONLY'
        assert prepared['alertMode'] == 'STANDARD' and prepared['nativeAlarmDeliveryTest'] is False
        assert prepared['journeyProvider'] == args.journey_provider
        if target_arrival_at:
            assert dt.datetime.fromisoformat(prepared['targetArrivalAt']) == dt.datetime.fromisoformat(target_arrival_at)
        target = dt.datetime.fromisoformat(prepared['targetArrivalAt']).astimezone(SEOUL).isoformat()
        env = dict(os.environ, EXPO_PUBLIC_LOCAL_API_BASE_URL=BASE, EXPO_PUBLIC_TRANSIT_PROVIDER=args.journey_provider,
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
        ui('testLoginDedicatedEtaAccount', 'ui-login', ('--credentials', str(root / 'credentials.json')))
        accepted_streak = 0
        previous = None
        max_evaluations = args.max_evaluations
        if evaluation_not_before and dt.datetime.now(dt.timezone.utc) < evaluation_not_before:
            seconds = (evaluation_not_before - dt.datetime.now(dt.timezone.utc)).total_seconds()
            emit(state='waiting_real_comparison_clock', seconds=round(seconds), notBefore=args.evaluation_not_before)
            wait(lambda: dt.datetime.now(dt.timezone.utc) >= evaluation_not_before, server, seconds + 10)
        for index in range(1, max_evaluations + 1):
            server.stdin.write('evaluate\n')
            server.stdin.flush()
            path = root / f'evaluation-{index}.json'
            wait(lambda: path.exists() and path.stat().st_size > 0, server, 90)
            value = json.loads(path.read_text())
            assert value['processed'] == 1 and value['historyCount'] == index and value['alertMode'] == 'STANDARD'
            assert all(a['operation'] != 'UPSERT' for a in value['alarmStates'])
            if previous is not None:
                assert dt.datetime.fromisoformat(value['evaluatedAt']) >= dt.datetime.fromisoformat(previous['nextCheckAt'])
                assert value['targetArrivalAt'] == previous['targetArrivalAt']
            is_accepted = (value['source'] == 'LIVE_PROVIDER' and value['stale'] is False and value['failureReason'] is None
                           and (value['effectiveSnapshot'] or {}).get('accepted') is True)
            record = {'index': index, 'accepted': is_accepted, 'uiResult': 'NOT_RUN', 'evaluatedAt': value['evaluatedAt'],
                      'failureCode': (value['failureReason'] or '').split(':')[0], 'providerWire': value['providerWire'],
                      'providerFailures': value.get('providerFailures', [])}
            report['evaluations'].append(record)
            emit(state='real_evaluation', **record)
            if is_accepted:
                # Export the calculation's actual departure anchor and train IDs.
                # This is evidence for a subsequent map comparison, not a pass:
                # station-platform coverage and external clock precision remain unknown.
                spec = importlib.util.spec_from_file_location('comparison', Path(__file__).with_name('verify-eta-comparison.py'))
                comparison = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(comparison)
                prediction_path = root / f'prediction-observation-{index}.json'
                prediction_path.write_text(json.dumps(comparison.worker_prediction(value, path.name), indent=2, ensure_ascii=False))
                record['comparisonPredictionEvidence'] = prediction_path.name
                ui('testVerifyIsolatedRealProviderEta', f'ui-evaluation-{index}', ('--real-isolated-evidence', str(path),
                    '--schedule-id', '363', '--existing-title', TITLE))
                (root / f'ui-status-{index}.json').write_bytes((root / 'ui-status.json').read_bytes())
                record['uiResult'] = 'PASSED'
                accepted_streak += 1
            elif args.journey_provider == 'odsay':
                ui('testVerifyIsolatedRealProviderDiagnostic', f'ui-diagnostic-{index}', ('--real-isolated-evidence', str(path),
                    '--schedule-id', '363', '--existing-title', TITLE))
                (root / f'ui-status-{index}.json').write_bytes((root / 'ui-status.json').read_bytes())
                record['uiResult'] = 'DIAGNOSTIC_PASSED_NOT_ACCEPTED_ETA'
            if not is_accepted:
                accepted_streak = 0
            if accepted_streak >= 2 or index == max_evaluations:
                break
            if provider_error_requires_stop(value):
                report['providerErrorRetriesStopped'] = True
                break
            due = dt.datetime.fromisoformat(value['nextCheckAt'])
            seconds = max(0, (due - dt.datetime.now(dt.timezone.utc)).total_seconds())
            if seconds > 330:
                raise RuntimeError('next_due_outside_bounded_observation')
            emit(state='waiting_persisted_due_time', seconds=round(seconds), nextCheckAt=value['nextCheckAt'])
            wait(lambda: dt.datetime.now(dt.timezone.utc) >= due, server, seconds + 10)
            previous = value
        spec = importlib.util.spec_from_file_location('real_audit', Path(__file__).with_name('verify-real-isolated-eta.py'))
        audit = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audit)
        report['audit'] = audit.verify(root, require_comparison_evidence=True)
        report['result'] = report['audit']['result']
        if args.verify_observation_expiry:
            if not is_accepted:
                report['observationExpiry'] = {'result': 'NOT_RUN', 'reason': 'LAST_WORKER_NOT_ACCEPTED'}
            else:
                observation = value['effectiveSnapshot']['firstBoardingObservation']
                expired_at = max(dt.datetime.fromisoformat(observation[k]) for k in ('sourceUpdatedAt', 'evaluatedAt')) + dt.timedelta(seconds=121)
                seconds = max(0, (expired_at - dt.datetime.now(dt.timezone.utc)).total_seconds())
                emit(state='waiting_actual_observation_expiry', seconds=round(seconds), expiredAt=expired_at.isoformat())
                wait(lambda: dt.datetime.now(dt.timezone.utc) >= expired_at, server, seconds + 10)
                ui('testVerifyIsolatedRealProviderObservationExpiry', 'ui-observation-expiry',
                   ('--real-isolated-evidence', str(path), '--schedule-id', '363', '--existing-title', TITLE))
                expired_public = json.loads((root / 'ui-status.json').read_text())
                report['observationExpiry'] = audit.verify_expired_observation_read(value, expired_public)
                (root / 'ui-status-observation-expiry.json').write_text(json.dumps(expired_public, indent=2))
                # The accepted evaluation file remains untouched; this is a later API read.
                assert json.loads(path.read_text()) == value
    except Exception as error:
        mark_failed(report, error)
        emit(state='failed', kind=type(error).__name__)
    finally:
        if server is not None and server.poll() is None:
            server.stdin.write('stop\n')
            server.stdin.flush()
            try:
                server.wait(timeout=20)
            except subprocess.TimeoutExpired:
                stop(server)
        stop(metro)
        report.update(restore_private_endpoint(DEVICE))
        if not report['originalAppEndpointRestored']:
            report['result'] = 'PARTIAL'
        (root / 'report.json').write_text(json.dumps(report, indent=2))
        emit(result=report['result'], evidenceRoot=str(root), acceptedUiCases=sum(r['uiResult'] == 'PASSED' for r in report['evaluations']))
    return 0 if report['result'] == 'PASSED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
