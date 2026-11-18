#!/usr/bin/env python3
"""Bounded real-feed Worker/API/simulator validation; no production writes or OS alarm claims."""
import argparse
import datetime as dt
import http.client
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import urllib.request
from eta_pinned_app import (
    require_private_development_client, restore_private_endpoint,
    open_private_client_with_xcuitest,
)
from eta_fixture_snapshot import wait_for_phase_snapshot
from eta_fixture_scope import DATED_TIMETABLE_API_BASES, DATED_TIMETABLE_PORTS, PRIVATE_API_BASE, REAL_ALTERNATE_API_BASE

WORKSPACE = Path(__file__).resolve().parents[3]
BE, FE = WORKSPACE / 'NoLate_BE', WORKSPACE / 'NoLate_FE'
DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'
TITLE = 'ETA E2E real isolated fixture'
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


def read_saved_timetable_schedule(root, base):
    """Read the schedule and its ETA status after the private UI's single submit."""
    if base not in DATED_TIMETABLE_API_BASES:
        raise ValueError('Use only the next-day timetable fixture')
    port = int(base.rsplit(':', 1)[1])

    def request(method, path, body=None, token=None):
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=8)
        try:
            headers = {'Content-Type': 'application/json'}
            if token:
                headers['Authorization'] = 'Bearer ' + token
            conn.request(method, path, json.dumps(body) if body is not None else None, headers)
            reply = conn.getresponse()
            if reply.status != 200 or reply.getheader('X-NoLate-Eta-Real-Isolation') != 'h2-real-providers':
                raise RuntimeError('Invalid isolated timetable response')
            return json.loads(reply.read())
        finally:
            conn.close()

    ready = request('GET', '/health/readiness')
    if ready.get('status') != 'UP':
        raise RuntimeError('Private timetable fixture not ready')
    credentials = json.loads((root / 'credentials.json').read_text())
    if credentials.get('memberId') != 296 or credentials.get('email') != 'eta-real-isolated@example.test':
        raise RuntimeError('Invalid synthetic timetable credentials')
    user = request('POST', '/api/member/auth/login', {k: credentials[k] for k in ('email', 'password')})['data']
    if user['id'] != 296:
        raise RuntimeError('Unexpected timetable member')
    token = user['accessToken']
    return (request('GET', '/api/schedules/363', token=token)['data'],
            request('GET', '/api/schedules/363/departure-status', token=token)['data'])


def verify_saved_bus_departure(route_info, public_eta, preview, target):
    departure = dt.datetime.fromisoformat(preview['departureAt'])
    arrival = dt.datetime.fromisoformat(preview['arrivalAt'])
    duration = arrival - departure
    seconds = duration // dt.timedelta(seconds=1)
    assert dt.timedelta(seconds=seconds) == duration and departure < arrival <= target
    minutes = (seconds + 59) // 60
    assert route_info['totalDurationMinutes'] == minutes
    observation = route_info['busPreviewObservation']
    assert dt.datetime.fromisoformat(observation['targetArrivalAt']) == target
    assert dt.datetime.fromisoformat(observation['sourceUpdatedAt']) == dt.datetime.fromisoformat(preview['sourceUpdatedAt'])
    assert public_eta['scheduleId'] == 363 and public_eta['travelMinutes'] == minutes
    assert dt.datetime.fromisoformat(public_eta['recommendedDepartureAt']) == departure
    assert public_eta['source'] == 'SELECTED_ROUTE' and public_eta['stale'] is True
    assert public_eta.get('liveFetchedAt') is None and public_eta.get('predictedArrivalAt') is None
    return {'travelMinutes': minutes, 'recommendedDepartureAt': public_eta['recommendedDepartureAt'],
            'source': public_eta['source'], 'stale': public_eta['stale']}


def provider_error_requires_stop(value):
    # Optional walking HTTP is outside the station/timetable wire collector.
    # Stop on its auth/quota/application error too; never rotate keys or retry.
    walking = (value.get('walkingRefinement') or {}).get('failureCounts') or {}
    return (any(w['outcome'] in ('application_error', 'rate_limited') for w in value['providerWire'])
            or any(walking.get(code, 0) > 0 for code in
                   ('HTTP_AUTH', 'HTTP_QUOTA', 'PROVIDER_APPLICATION_ERROR')))


def postdeparture_audit(evaluations, same_train_provisional):
    """Report frozen recommendation separately from an untested native alarm."""
    first = evaluations[0].get('recommendedDepartureAt') if evaluations else None
    recommendation_unchanged = bool(first and len(evaluations) > 1 and all(
        item.get('recommendedDepartureAt') == first for item in evaluations[1:]))
    no_automatic_alarm_state = bool(evaluations and all(
        item.get('automaticAlarmStateCount') == 0 for item in evaluations))
    return {'result': 'PASSED' if same_train_provisional and recommendation_unchanged
            and no_automatic_alarm_state else 'PARTIAL',
            'classification': 'REAL_PROVIDER_POSTDEPARTURE_SAME_TRAIN_PROVISIONAL_NOT_PHYSICAL_TRIP',
            'evaluationCount': len(evaluations),
            'departureRecommendationUnchanged': recommendation_unchanged,
            'automaticAlarmStateAbsent': no_automatic_alarm_state,
            'nativeAlarmDeliveryTested': False}


def verify_postdeparture_status_split(worker, public):
    """A new origin search must not masquerade as the saved journey's ETA/failure."""
    diagnostic = public.get('originReplanDiagnostic') or {}
    for key, value in [('travelMinutes', worker['travelMinutes']), ('source', worker['source']),
                       ('stale', worker['stale']), ('failureReason', worker['failureReason'])]:
        if diagnostic.get(key) != value:
            raise RuntimeError('origin_replan_diagnostic_does_not_match_worker')
    if any(public.get(key) is not None for key in
           ('travelMinutes', 'source', 'liveFetchedAt', 'failureReason', 'predictedArrivalAt',
            'effectiveTransitRoute')) or public.get('stale') is not True:
        raise RuntimeError('origin_replan_leaked_into_saved_journey_eta')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', required=True)
    parser.add_argument('--api-port', type=int, choices=(5523, 5527, *DATED_TIMETABLE_PORTS), default=5523)
    parser.add_argument('--copied-input', type=Path, required=True, help='Existing approved read-only 296/367 snapshot')
    parser.add_argument('--max-evaluations', type=int, choices=(1, 2, 3), default=3,
                        help='Bound actual provider calls; fewer than two accepted UI cases remains PARTIAL')
    parser.add_argument('--journey-provider', choices=('odsay', 'tmap'), default='odsay',
                        help='Defaults to a fresh ODsay selected route; choose Tmap explicitly for legacy route verification')
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
    parser.add_argument('--verify-planned-postdeparture', action='store_true',
                        help='One accepted plan, then at most two real-clock post-departure checks of its final train')
    parser.add_argument('--verify-odsay-timetable-selection', action='store_true',
                        help='Check the installed app route-picker timetable and apply it to the private draft only')
    parser.add_argument('--timetable-target-arrival',
                        help='Seed the route-picker fixture with an explicit appointment tomorrow in Seoul')
    parser.add_argument('--verify-timetable-save', action='store_true',
                        help='Save and reopen the next-day schedule only in the private memory database')
    parser.add_argument('--timetable-reschedule-arrival',
                        help='Change the scoped appointment before saving the selected timetable route')
    parser.add_argument('--verify-direct-timetable-egress', action='store_true',
                        help='Use the scoped Nowon–Sadang station coordinates and verify the 188-second egress')
    parser.add_argument('--verify-overnight-timetable', action='store_true',
                        help='Save the scoped Sadang–Gojan route with arrival after midnight on tomorrow’s service day')
    parser.add_argument('--verify-adjacent-ring-timetable', action='store_true',
                        help='Save today’s scoped Gangnam–Yeoksam route using the dated timetable')
    parser.add_argument('--verify-seolleung-access', action='store_true',
                        help='Save today’s Gangnam–Seolleung route with a verified first walk and matching departure')
    parser.add_argument('--without-station-timetable', action='store_true',
                        help='Exercise the private Gangnam–Seolleung walk estimate with no station timetable')
    parser.add_argument('--verify-corroborated-egress', action='store_true',
                        help='Require the scoped real egress estimate confirmed by the original ODsay endpoint')
    parser.add_argument('--verify-weekend-bus-options', action='store_true',
                        help='Save the scoped Gangnam–Yeoksam weekend bus candidate as an estimate')
    parser.add_argument('--verify-live-bus-preview', action='store_true',
                        help='Compare the live bus preview on the private Gangnam–Yeoksam schedule with the saved route')
    args = parser.parse_args()
    base = {5523: PRIVATE_API_BASE, 5527: REAL_ALTERNATE_API_BASE,
            **dict(zip(DATED_TIMETABLE_PORTS, DATED_TIMETABLE_API_BASES))}[args.api_port]
    if args.verify_odsay_timetable_selection and (
            args.journey_provider != 'odsay' or args.verify_observation_expiry or args.verify_planned_postdeparture
            or args.planned_departure_at or args.evaluation_not_before):
        parser.error('Timetable selection uses a separate ODsay route-picker scenario')
    if args.verify_planned_postdeparture and (args.max_evaluations != 3 or args.verify_observation_expiry):
        parser.error('Post-departure verification permits exactly three bounded evaluations and no expiry phase')
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
    timetable_target = None
    if args.timetable_target_arrival:
        try:
            timetable_target = dt.datetime.fromisoformat(args.timetable_target_arrival.replace('Z', '+00:00'))
        except ValueError:
            parser.error('Use an ISO-8601 timetable appointment')
        target_days_ahead = 0 if args.verify_adjacent_ring_timetable or args.verify_seolleung_access else 2 if args.verify_overnight_timetable else 1
        now_seoul = dt.datetime.now(SEOUL)
        if (not args.verify_odsay_timetable_selection or timetable_target.tzinfo is None
                or timetable_target.second or timetable_target.microsecond
                or timetable_target <= now_seoul
                or timetable_target.astimezone(SEOUL).date() != now_seoul.date() + dt.timedelta(days=target_days_ahead)
                or args.verify_overnight_timetable and timetable_target.astimezone(SEOUL).hour != 0):
            parser.error('Use a future, minute-aligned Seoul appointment on the fixture’s service day')
    dated_port = args.api_port in DATED_TIMETABLE_PORTS
    if dated_port and timetable_target is None:
        parser.error('The dedicated next-day port requires an isolated timetable draft')
    if args.verify_timetable_save and (not dated_port or timetable_target is None):
        parser.error('A timetable save requires a dedicated next-day memory fixture')
    if args.verify_direct_timetable_egress and not args.verify_timetable_save:
        parser.error('Direct egress requires the scoped timetable save')
    if args.verify_overnight_timetable and (not args.verify_timetable_save or args.verify_direct_timetable_egress
                                            or args.timetable_reschedule_arrival):
        parser.error('The overnight timetable requires its own scoped save')
    if args.verify_adjacent_ring_timetable and (not args.verify_timetable_save or args.verify_direct_timetable_egress
                                               or args.verify_overnight_timetable or args.timetable_reschedule_arrival):
        parser.error('The adjacent ring timetable requires its own scoped save')
    if args.verify_seolleung_access and (not args.verify_timetable_save or args.verify_direct_timetable_egress
                                       or args.verify_overnight_timetable or args.verify_adjacent_ring_timetable
                                       or args.timetable_reschedule_arrival):
        parser.error('The Gangnam–Seolleung access walk requires its own scoped save')
    if args.without_station_timetable and not args.verify_seolleung_access:
        parser.error('The unavailable timetable scenario requires the scoped Gangnam–Seolleung route')
    if args.verify_corroborated_egress and not args.verify_adjacent_ring_timetable:
        parser.error('Use the scoped Gangnam–Yeoksam fixture for the corroborated egress check')
    if args.verify_weekend_bus_options and (not args.verify_adjacent_ring_timetable or args.verify_corroborated_egress
                                           or timetable_target.astimezone(SEOUL).weekday() < 5):
        parser.error('Use the scoped Gangnam–Yeoksam fixture on a weekend for the bus check')
    if args.verify_live_bus_preview and (not args.verify_adjacent_ring_timetable or args.verify_weekend_bus_options
                                         or args.verify_corroborated_egress):
        parser.error('Use the scoped Gangnam–Yeoksam fixture for the live bus check')
    revised_target = None
    if args.timetable_reschedule_arrival:
        try:
            revised_target = dt.datetime.fromisoformat(args.timetable_reschedule_arrival.replace('Z', '+00:00'))
        except ValueError:
            parser.error('Use an ISO-8601 revised appointment')
        if (not args.verify_timetable_save or revised_target.tzinfo is None or revised_target.second or revised_target.microsecond
                or revised_target.astimezone(SEOUL).date() != timetable_target.astimezone(SEOUL).date()
                or revised_target >= timetable_target):
            parser.error('Use an earlier minute on the same date in the scoped timetable save')
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
    report['apiBase'] = base
    report['targetLeadMinutes'] = args.target_lead_minutes
    report['comparisonRequestedDepartureAt'] = args.planned_departure_at
    report['comparisonTargetArrivalAt'] = target_arrival_at
    report['evaluationNotBefore'] = args.evaluation_not_before
    report['plannedPostdepartureRequested'] = args.verify_planned_postdeparture

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
        with urllib.request.urlopen(base + '/health/readiness', timeout=2) as response:
            return (response.headers.get('X-NoLate-Eta-Real-Isolation') == 'h2-real-providers'
                    and json.loads(response.read())['status'] == 'UP' and (root / 'prepared.json').exists())

    def ui(method, name, extra=()):
        cmd = ['python3', 'e2e/ios/run-eta.py', '--device', DEVICE, '--output', str(root / name),
               '--only', method, '--title', TITLE, '--target-arrival', target, '--api-base', base,
               '--real-isolated'] + list(extra)
        emit(state='ui_start', case=name)
        with log(name + '-launcher.log') as output:
            ui_environment = os.environ.copy()
            ui_environment['TEST_RUNNER_E2E_DATED_TIMETABLE_RESCHEDULE'] = (
                revised_target.isoformat() if revised_target and method == 'testVerifyIsolatedOdsayTimetableSelection' else '')
            ui_environment['TEST_RUNNER_E2E_WEEKEND_BUS_OPTIONS'] = (
                '1' if args.verify_weekend_bus_options and method == 'testVerifyIsolatedOdsayTimetableSelection' else '0')
            ui_environment['TEST_RUNNER_E2E_REAL_BUS_PREVIEW'] = (
                '1' if args.verify_live_bus_preview and method == 'testVerifyIsolatedOdsayTimetableSelection' else '0')
            ui_environment['TEST_RUNNER_E2E_SEOLLEUNG_ACCESS'] = (
                '1' if args.verify_seolleung_access and method == 'testVerifyIsolatedOdsayTimetableSelection' else '0')
            ui_environment['TEST_RUNNER_E2E_SEOLLEUNG_WALK_ONLY'] = (
                '1' if args.without_station_timetable and method == 'testVerifyIsolatedOdsayTimetableSelection' else '0')
            child = subprocess.Popen(cmd, cwd=FE, stdout=output, stderr=subprocess.STDOUT,
                                     env=ui_environment, start_new_session=True)
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
        require_private_development_client(DEVICE)
        free(args.api_port)
        free(8086)
        with log('compile.log') as output:
            java_home = str(Path(args.java).resolve(strict=True).parent.parent)
            subprocess.run(['./gradlew', '--no-daemon', '--max-workers=2', '-Dorg.gradle.java.home=' + java_home,
                '-I', 'e2e/eta-fixture.init.gradle', 'etaSimulatorFixtureClasspath',
                '-PetaFixtureOutput=' + str(root), '--console=plain'], cwd=BE,
                env=dict(os.environ, JAVA_HOME=java_home),
                stdout=output, stderr=subprocess.STDOUT, check=True, timeout=300)
        with log('server.log') as output:
            dated_option = (['-Dnolate.eta.real-isolated.timetable-target=' +
                             timetable_target.astimezone(dt.timezone.utc).isoformat()] if timetable_target else [])
            if args.verify_direct_timetable_egress:
                dated_option.append('-Dnolate.eta.real-isolated.direct-egress=true')
            if args.verify_overnight_timetable:
                dated_option.append('-Dnolate.eta.real-isolated.overnight-timetable=true')
            if args.verify_adjacent_ring_timetable:
                dated_option.append('-Dnolate.eta.real-isolated.adjacent-ring-timetable=true')
            if args.verify_seolleung_access:
                dated_option.append('-Dnolate.eta.real-isolated.seolleung-access=true')
            if args.without_station_timetable:
                dated_option.append('-Dnolate.eta.real-isolated.omit-station-timetable=true')
            server = subprocess.Popen([args.java, '-Xmx1536m', '-Dnolate.eta.real-isolated=true',
                f'-Dnolate.eta.real-isolated.port={args.api_port}'] + dated_option + ['-classpath',
                (root / 'classpath.txt').read_text(), 'com.noLate.eta.simulator.EtaRealProviderSimulatorServer',
                str(root), str(copied), args.journey_provider, str(args.target_lead_minutes)] +
                ([args.planned_departure_at] if args.planned_departure_at else []) +
                ([target_arrival_at] if target_arrival_at else []), cwd=BE, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT,
                text=True, start_new_session=True)
        wait(ready, server)
        prepared = wait_for_phase_snapshot(root / 'prepared.json', -1, server)
        assert prepared['providersMocked'] is False and prepared['database'] == 'H2_MEMORY_ONLY'
        assert prepared['alertMode'] == 'STANDARD' and prepared['nativeAlarmDeliveryTest'] is False
        assert prepared['journeyProvider'] == args.journey_provider
        if target_arrival_at:
            assert dt.datetime.fromisoformat(prepared['targetArrivalAt']) == dt.datetime.fromisoformat(target_arrival_at)
        if timetable_target:
            assert dt.datetime.fromisoformat(prepared['targetArrivalAt']) == timetable_target
        if args.verify_direct_timetable_egress:
            assert prepared['requestedCoordinates'] == {
                'origin': {'lat': 37.656274, 'lng': 127.063183},
                'destination': {'lat': 37.476563, 'lng': 126.981746},
            }
        if args.verify_overnight_timetable:
            assert prepared['requestedCoordinates'] == {
                'origin': {'lat': 37.476563, 'lng': 126.981746},
                'destination': {'lat': 37.315381459929, 'lng': 126.82309002079},
            }
        if args.verify_adjacent_ring_timetable:
            assert prepared['requestedCoordinates'] == {
                'origin': {'lat': 37.497952, 'lng': 127.027619},
                'destination': {'lat': 37.500622, 'lng': 127.036456},
            }
        if args.verify_seolleung_access:
            assert prepared['requestedCoordinates'] == {
                'origin': {'lat': 37.497958, 'lng': 127.027539},
                'destination': {'lat': 37.504257, 'lng': 127.048174},
            }
            assert prepared['stationTimetableEnabled'] is not args.without_station_timetable
        target = dt.datetime.fromisoformat(prepared['targetArrivalAt']).astimezone(SEOUL).isoformat()
        env = dict(os.environ, EXPO_PUBLIC_LOCAL_API_BASE_URL=base, EXPO_PUBLIC_TRANSIT_PROVIDER=args.journey_provider,
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
        ui('testLoginDedicatedEtaAccount', 'ui-login', ('--credentials', str(root / 'credentials.json')))
        if args.verify_live_bus_preview:
            report['classification'] = 'REAL_PROVIDER_ODSAY_LIVE_BUS_ROUTE_PICKER_E2E'
            ui('testVerifyIsolatedOdsayTimetableSelection', 'ui-live-bus',
               ('--schedule-id', '363', '--existing-title', TITLE, '--allow-save'))
            labels = (root / 'ui-live-bus' / 'run.log').read_text()
            assert 'ETA_ODSAY_LIVE_BUS_SAVED_AND_REOPENED' in labels
            saved, public_eta = read_saved_timetable_schedule(root, base)
            route_info = saved['route']['routeInfo']
            preview = json.loads((root / 'ui-live-bus-preview.json').read_text())
            depart, board, alight, arrive = (dt.datetime.fromisoformat(preview[k])
                                            for k in ('departureAt', 'boardingAt', 'alightingAt', 'arrivalAt'))
            assert saved['id'] == 363 and saved['title'] == TITLE and saved['ownerMemberId'] == 296
            assert dt.datetime.fromisoformat(saved['startAt']) == timetable_target
            assert route_info['provider'] == 'odsay' and route_info['timeBasis'] == 'estimated'
            assert dt.datetime.fromisoformat(route_info['departureTime']) == depart
            assert dt.datetime.fromisoformat(route_info['arrivalTime']) == arrive
            assert route_info['totalDurationSeconds'] == (arrive - depart).total_seconds()
            selected_bus, = [leg for leg in saved['route']['transitLegs'] if leg['kind'] == 'BUS']
            assert selected_bus['providerRouteId'] == preview['providerRouteId']
            ride, = [step for step in route_info['steps'] if step['type'] == 'BUS']
            assert ride['lineName'] == selected_bus['lineName']
            assert (board - depart).total_seconds() >= preview['accessSeconds'] + 60
            assert (arrive - alight).total_seconds() == preview['egressSeconds']
            assert ride['durationSeconds'] == (alight - depart).total_seconds() - preview['accessSeconds']
            snapshot = verify_saved_bus_departure(route_info, public_eta, preview, timetable_target)
            report['liveBusPreviewSaved'] = {'line': ride['lineName'], 'preview': preview,
                                             'savedDepartureStatus': snapshot}
        elif args.verify_weekend_bus_options:
            report['classification'] = 'REAL_PROVIDER_ODSAY_WEEKEND_BUS_ROUTE_PICKER_E2E'
            ui('testVerifyIsolatedOdsayTimetableSelection', 'ui-weekend-bus',
               ('--schedule-id', '363', '--existing-title', TITLE, '--allow-save'))
            label = (root / 'ui-weekend-bus' / 'run.log').read_text()
            assert 'ETA_ODSAY_WEEKEND_BUS_SAVED_AND_REOPENED' in label
            saved, public_eta = read_saved_timetable_schedule(root, base)
            route = saved['route']
            route_info = route['routeInfo']
            bus = [step for step in route_info['steps'] if step['type'] == 'BUS']
            assert saved['id'] == 363 and saved['title'] == TITLE and saved['ownerMemberId'] == 296
            assert dt.datetime.fromisoformat(saved['startAt']) == timetable_target
            assert route['provider'] == 'odsay' and route_info['provider'] == 'odsay'
            assert route_info['timeBasis'] == 'estimated' and route_info['providerTimeBasis'] == 'route_estimate'
            assert len(bus) == 1 and bus[0]['lineName'] == '360' and not bus[0].get('scheduledRide')
            assert public_eta['source'] == 'SELECTED_ROUTE' and public_eta['stale'] is True
            assert public_eta.get('predictedArrivalAt') is None
            bus_evidence = {'scheduleId': saved['id'], 'appointmentAt': saved['startAt'],
                            'provider': route['provider'], 'line': bus[0]['lineName'],
                            'timeBasis': route_info['timeBasis'], 'etaSource': public_eta['source'],
                            'etaStale': public_eta['stale']}
            (root / 'ui-saved-weekend-bus.json').write_text(json.dumps(bus_evidence, indent=2))
            report['weekendBusScheduleSaveVerified'] = True
        elif args.without_station_timetable:
            report['classification'] = 'REAL_ODSAY_WALK_ESTIMATE_WITHOUT_STATION_TIMETABLE'
            ui('testVerifyIsolatedOdsayTimetableSelection', 'ui-walk-estimate',
               ('--schedule-id', '363', '--existing-title', TITLE, '--allow-save'))
            log_text = (root / 'ui-walk-estimate' / 'run.log').read_text()
            assert 'ETA_ODSAY_WALK_ESTIMATE_SAVED_AND_REOPENED' in log_text
            response = json.loads((root / 'ui-timetable-preview.json').read_text())
            assert response['httpStatus'] == 200 and response['preview'] is None
            access = response['missingEntranceWalk']
            assert access['seconds'] > 0 and access['distanceMeters'] > 0
            assert response['walkingRefinement']['httpCalls'] == 1
            saved, public_eta = read_saved_timetable_schedule(root, base)
            route = saved['route']
            info = route['routeInfo']
            expected_seconds = prepared['seedTravelMinutes'] * 60 + access['seconds']
            expected_minutes = (expected_seconds + 59) // 60
            departure = dt.datetime.fromisoformat(info['departureTime'])
            arrival = dt.datetime.fromisoformat(info['arrivalTime'])
            assert route['provider'] == 'odsay' and info['timeBasis'] == 'estimated'
            assert info['providerTimeBasis'] == 'route_estimate'
            assert info['totalDurationSeconds'] == expected_seconds and info['totalDurationMinutes'] == expected_minutes == 7
            assert dt.datetime.fromisoformat(saved['startAt']) == arrival == timetable_target
            assert dt.datetime.fromisoformat(saved['departAt']) == departure == arrival - dt.timedelta(seconds=expected_seconds)
            assert all(not step.get('scheduledRide') for step in info['steps'])
            walks = [step for step in info['steps'] if step['type'] == 'WALK']
            assert len(walks) == 2 and walks[0]['durationSeconds'] == access['seconds']
            rides = [leg for leg in route['transitLegs'] if leg['kind'] == 'SUBWAY']
            assert len(rides) == 1 and (rides[0]['startName'], rides[0]['endName']) == ('강남', '선릉')
            assert public_eta['source'] == 'SELECTED_ROUTE' and public_eta['stale'] is True
            assert public_eta.get('predictedArrivalAt') is None and public_eta.get('liveFetchedAt') is None
            assert dt.datetime.fromisoformat(public_eta['recommendedDepartureAt']) == departure
            report['walkEstimateSaved'] = {'accessSeconds': access['seconds'], 'durationSeconds': expected_seconds,
                                           'departureAt': departure.isoformat(), 'arrivalAt': arrival.isoformat()}
        elif args.verify_odsay_timetable_selection:
            report['classification'] = 'REAL_PROVIDER_ODSAY_TIMETABLE_ROUTE_PICKER_E2E'
            ui('testVerifyIsolatedOdsayTimetableSelection', 'ui-timetable-selection',
               ('--schedule-id', '363', '--existing-title', TITLE) + (('--allow-save',) if args.verify_timetable_save else ()))
            evidence_file = 'ui-timetable-preview-first.json' if revised_target else 'ui-timetable-preview.json'
            api_result = json.loads((root / evidence_file).read_text())
            assert api_result['httpStatus'] == 200 and api_result['preview']['rides']
            label = (root / 'ui-timetable-selection' / 'run.log').read_text()
            def clock_text(value, arrival=False):
                clock = dt.datetime.fromisoformat(value).astimezone(SEOUL)
                if arrival:
                    clock += dt.timedelta(seconds=30)
                return ('오후 ' if clock.hour >= 12 else '오전 ') + f'{clock.hour % 12 or 12}:{clock.minute:02d}'
            preview = api_result['preview']
            single_ride = (args.verify_direct_timetable_egress or args.verify_overnight_timetable
                           or args.verify_adjacent_ring_timetable or args.verify_seolleung_access)
            assert len(preview['rides']) == (1 if single_ride else 2)
            departure_local = dt.datetime.fromisoformat(preview['departureAt']).astimezone(SEOUL)
            arrival_local = dt.datetime.fromisoformat(preview['arrivalAt']).astimezone(SEOUL)
            arrival_label = clock_text(preview['arrivalAt'], arrival=True)
            if (arrival_local + dt.timedelta(seconds=30)).date() == departure_local.date() + dt.timedelta(days=1):
                arrival_label = '다음날 ' + arrival_label
            if timetable_target:
                service_date = timetable_target.astimezone(SEOUL).date() - dt.timedelta(days=args.verify_overnight_timetable)
                expected_provider = 'seoul-timetable' if args.verify_seolleung_access else 'seoul-dated-path'
                assert all(ride['provider'] == expected_provider and
                           ride['serviceDate'] == service_date.isoformat()
                           for ride in preview['rides'])
                assert dt.datetime.fromisoformat(preview['arrivalAt']) <= timetable_target
                report['timetableTargetArrivalAt'] = timetable_target.isoformat()
            if args.verify_overnight_timetable:
                assert departure_local.date() == service_date and arrival_local.date() == service_date + dt.timedelta(days=1)
                assert dt.datetime.fromisoformat(preview['rides'][-1]['arrivalAt']).astimezone(SEOUL).date() == arrival_local.date()
                report['overnightServiceDate'] = service_date.isoformat()
            if args.verify_adjacent_ring_timetable:
                ride = preview['rides'][0]
                assert (ride['line'], ride['fromStationCode'], ride['toStationCode'], ride['directionCode']) == (
                    'LINE_2', '0222', '0221', 'DOWN',
                )
                report['adjacentRingServiceDate'] = service_date.isoformat()
            if args.verify_seolleung_access:
                ride = preview['rides'][0]
                assert (ride['line'], int(ride['fromStationCode']), int(ride['toStationCode']), ride['directionCode']) == (
                    'LINE_2', 222, 220, 'DOWN',
                )
                access_seconds = preview['entranceWalk']['seconds']
                assert access_seconds > 0
                assert dt.datetime.fromisoformat(ride['boardingAt']) - departure_local >= dt.timedelta(seconds=access_seconds + 60)
                report['verifiedAccessSeconds'] = access_seconds
            if args.verify_corroborated_egress:
                walking = api_result['walkingRefinement']
                assert walking['httpCalls'] == 1
                assert not walking['failureCounts']
                assert preview['entranceWalk'] == {'seconds': 108, 'distanceMeters': 118}
                assert preview['exitWalk'] == {'seconds': 93, 'distanceMeters': 99}
                report['corroboratedEgressVerified'] = True
            assert ('ETA_ODSAY_TIMETABLE_SELECTION_VERIFIED: 시간표 기준 · '
                    + clock_text(preview['departureAt']) + ' 출발 · '
                    + arrival_label + ' 예상 도착 (목적지)') in label
            assert 'ETA_ODSAY_TIMETABLE_MAP_VERIFIED: ' + arrival_label in label
            assert ('ETA_ODSAY_TIMETABLE_ALERT_SETTINGS_VERIFIED: '
                    + clock_text(preview['departureAt']) + ' / ' + clock_text(preview['arrivalAt'], arrival=True)) in label
            report['timetableSelectionUiVerified'] = True
            report['timetableMapUiVerified'] = True
            report['timetableAlertSettingsUiVerified'] = True
            if revised_target:
                assert 'ETA_ODSAY_TIMETABLE_APPOINTMENT_CHANGED: ' + revised_target.isoformat() in label
                refreshed = json.loads((root / 'ui-timetable-preview.json').read_text())
                assert refreshed['httpStatus'] == 200 and refreshed['preview']['rides']
                refreshed_preview = refreshed['preview']
                assert dt.datetime.fromisoformat(refreshed_preview['arrivalAt']) <= revised_target
                assert dt.datetime.fromisoformat(preview['arrivalAt']) > revised_target
                assert refreshed_preview['rides'][0]['boardingAt'] != preview['rides'][0]['boardingAt']
                preview = refreshed_preview
                timetable_target = revised_target
                report['timetableRescheduleVerified'] = True
            if args.verify_timetable_save:
                assert 'ETA_ODSAY_TIMETABLE_SAVED_AND_REOPENED' in label
                saved, public_eta = read_saved_timetable_schedule(root, base)
                server.stdin.write('audit-timetable-reservation\n')
                server.stdin.flush()
                reservation_path = root / 'timetable-reservation.json'
                wait(lambda: json.loads(reservation_path.read_text()), server, 15)
                reservation = json.loads(reservation_path.read_text())
                route = saved.get('route') or {}
                route_info = route.get('routeInfo') or {}
                steps = route_info.get('steps', [])
                saved_timings = {
                    'scheduleId': saved.get('id'),
                    'targetArrivalAt': saved.get('startAt'),
                    'recommendedDepartureAt': saved.get('departAt'),
                    'routeDepartureAt': route_info.get('departureTime'),
                    'routeArrivalAt': route_info.get('arrivalTime'),
                    'provider': route.get('provider'),
                    'timeBasis': route_info.get('timeBasis'),
                    'providerTimeBasis': route_info.get('providerTimeBasis'),
                    'rideTimings': [s['scheduledRide'] for s in steps if s.get('scheduledRide')],
                    'rideDurationSeconds': [s.get('durationSeconds') for s in steps if s.get('scheduledRide')],
                    'transferWalkingSeconds': [walk.get('durationSeconds') for previous, walk, following in
                                               zip(steps, steps[1:], steps[2:])
                                               if previous.get('scheduledRide') and walk.get('type') == 'WALK'
                                               and following.get('scheduledRide')],
                    'entranceWalk': {'seconds': steps[1].get('durationSeconds'), 'distanceMeters': steps[1].get('distanceMeters')}
                        if len(steps) >= 4 and steps[1].get('type') == 'WALK' and steps[2].get('scheduledRide') else None,
                    'exitWalk': {'seconds': steps[-2].get('durationSeconds'), 'distanceMeters': steps[-2].get('distanceMeters')}
                        if len(steps) >= 4 and steps[-2].get('type') == 'WALK' and steps[-3].get('scheduledRide') else None,
                    'destinationWalkingSeconds': steps[-2].get('durationSeconds') if len(steps) >= 3 and
                        steps[-2].get('type') == 'WALK' and steps[-3].get('scheduledRide') else None,
                }
                (root / 'ui-saved-timetable.json').write_text(json.dumps(saved_timings, indent=2))
                assert saved['id'] == 363 and saved['title'] == TITLE and saved['ownerMemberId'] == 296
                assert saved_timings['provider'] == 'odsay' and saved_timings['timeBasis'] == 'provider_schedule'
                assert saved_timings['providerTimeBasis'] == 'timetable'
                assert dt.datetime.fromisoformat(saved_timings['targetArrivalAt']) == timetable_target
                depart = dt.datetime.fromisoformat(preview['departureAt'])
                assert dt.datetime.fromisoformat(saved_timings['recommendedDepartureAt']) == depart
                assert reservation['scheduleId'] == 363 and reservation['memberId'] == 296
                assert reservation['status'] == 'ACTIVE' and reservation['checkCount'] == 0
                assert dt.datetime.fromisoformat(reservation['appointmentAt']) == timetable_target
                assert dt.datetime.fromisoformat(reservation['departureAt']) == depart
                assert public_eta['source'] == 'SELECTED_ROUTE' and public_eta['stale'] is True
                assert public_eta.get('predictedArrivalAt') is None
                assert public_eta['travelMinutes'] == route_info['totalDurationMinutes']
                assert dt.datetime.fromisoformat(public_eta['recommendedDepartureAt']) == depart
                report['timetableReservationVerified'] = True
                assert dt.datetime.fromisoformat(saved_timings['routeDepartureAt']) == depart
                assert dt.datetime.fromisoformat(saved_timings['routeArrivalAt']) == dt.datetime.fromisoformat(preview['arrivalAt'])
                assert [{k: dt.datetime.fromisoformat(r[k]) for k in ('boardingAt', 'arrivalAt')}
                        for r in saved_timings['rideTimings']] == [
                            {k: dt.datetime.fromisoformat(r[k]) for k in ('boardingAt', 'arrivalAt')} for r in preview['rides']]
                assert saved_timings['rideDurationSeconds'] == [
                    (dt.datetime.fromisoformat(r['arrivalAt']) - dt.datetime.fromisoformat(r['boardingAt'])).total_seconds()
                    for r in preview['rides']]
                assert saved_timings['transferWalkingSeconds'] == [
                    t['walkingSeconds'] for t in preview['transferTimings']]
                assert saved_timings['destinationWalkingSeconds'] == (
                    dt.datetime.fromisoformat(preview['arrivalAt']) -
                    dt.datetime.fromisoformat(preview['rides'][-1]['arrivalAt'])
                ).total_seconds()
                if args.verify_corroborated_egress:
                    assert saved_timings['destinationWalkingSeconds'] == 93
                    report['corroboratedEgressSaved'] = True
                for boundary in ('entranceWalk', 'exitWalk'):
                    if preview.get(boundary):
                        assert saved_timings[boundary] == preview[boundary]
                report['timetableBoundaryWalksVerified'] = [key for key in ('entranceWalk', 'exitWalk') if preview.get(key)]
                if args.verify_direct_timetable_egress:
                    assert saved_timings['destinationWalkingSeconds'] == 188
                    report['directEgressVerified'] = True
                    server.stdin.write('audit-timetable-without-stored-departure\n')
                    server.stdin.flush()
                    legacy_path = root / 'timetable-without-stored-departure.json'
                    wait(lambda: json.loads(legacy_path.read_text()), server, 15)
                    legacy_job = json.loads(legacy_path.read_text())
                    assert legacy_job['storedDepartureAt'] is None and legacy_job['checkCount'] == 0
                    assert legacy_job['status'] == 'ACTIVE'
                    assert dt.datetime.fromisoformat(legacy_job['appointmentAt']) == timetable_target
                    assert dt.datetime.fromisoformat(legacy_job['departureAt']) == depart
                    _, legacy_eta = read_saved_timetable_schedule(root, base)
                    assert legacy_eta['source'] == 'SELECTED_ROUTE' and legacy_eta['stale'] is True
                    assert legacy_eta.get('predictedArrivalAt') is None
                    assert dt.datetime.fromisoformat(legacy_eta['recommendedDepartureAt']) == depart
                    (root / 'timetable-without-stored-departure-status.json').write_text(json.dumps(legacy_eta, indent=2))
                    report['missingStoredDepartureReservationVerified'] = True
                walking_seconds = sum(
                    s['durationSeconds'] if s.get('durationSeconds') is not None else s['durationMinutes'] * 60
                    for s in steps if s.get('type') == 'WALK'
                )
                expected_walking_minutes = max(1, int((walking_seconds + 59) // 60))
                assert f'ETA_ODSAY_TIMETABLE_WALKING_VERIFIED: 도보 {expected_walking_minutes}분\n' in label
                saved_timings['totalWalkingSeconds'] = walking_seconds
                (root / 'ui-saved-timetable.json').write_text(json.dumps(saved_timings, indent=2))
                report['timetableScheduleSaveVerified'] = True
                report['timetableWalkingSummaryVerified'] = True
            report['result'] = 'PASSED'
        accepted_streak = 0
        previous = None
        initial_plan = None
        max_evaluations = 0 if args.verify_odsay_timetable_selection else args.max_evaluations
        if evaluation_not_before and dt.datetime.now(dt.timezone.utc) < evaluation_not_before:
            seconds = (evaluation_not_before - dt.datetime.now(dt.timezone.utc)).total_seconds()
            emit(state='waiting_real_comparison_clock', seconds=round(seconds), notBefore=args.evaluation_not_before)
            wait(lambda: dt.datetime.now(dt.timezone.utc) >= evaluation_not_before, server, seconds + 10)
        for index in range(1, max_evaluations + 1):
            server.stdin.write('evaluate\n')
            server.stdin.flush()
            path = root / f'evaluation-{index}.json'
            value = wait_for_phase_snapshot(path, -1, server, seconds=90)
            assert value['processed'] == 1 and value['historyCount'] == index and value['alertMode'] == 'STANDARD'
            assert all(a['operation'] != 'UPSERT' for a in value['alarmStates'])
            if previous is not None:
                assert dt.datetime.fromisoformat(value['evaluatedAt']) >= dt.datetime.fromisoformat(previous['nextCheckAt'])
                assert value['targetArrivalAt'] == previous['targetArrivalAt']
            is_accepted = (value['source'] == 'LIVE_PROVIDER' and value['stale'] is False and value['failureReason'] is None
                           and (value['effectiveSnapshot'] or {}).get('accepted') is True)
            record = {'index': index, 'accepted': is_accepted, 'uiResult': 'NOT_RUN', 'evaluatedAt': value['evaluatedAt'],
                      'recommendedDepartureAt': value['recommendedDepartureAt'],
                      'automaticAlarmStateCount': len(value['alarmStates']),
                      'failureCode': (value['failureReason'] or '').split(':')[0], 'providerWire': value['providerWire'],
                      'providerFailures': value.get('providerFailures', [])}
            report['evaluations'].append(record)
            emit(state='real_evaluation', **record)
            if args.verify_planned_postdeparture and index > 1:
                plan = (value.get('effectiveSnapshot') or {}).get('inProgressPlannedRoute')
                observation = (value.get('effectiveSnapshot') or {}).get('plannedArrivalObservation')
                if plan != initial_plan:
                    raise RuntimeError('original_planned_route_not_preserved')
                if value['recommendedDepartureAt'] != report['evaluations'][0]['recommendedDepartureAt']:
                    raise RuntimeError('departure_alert_was_changed')
                if observation and observation.get('routeIdentity') == plan.get('identity'):
                    source_at = dt.datetime.fromisoformat(observation['sourceUpdatedAt'])
                    evaluated_at = dt.datetime.fromisoformat(value['evaluatedAt'])
                    if (0 <= (evaluated_at - source_at).total_seconds() <= 120 and
                            dt.datetime.fromisoformat(observation['predictedArrivalAt']) > evaluated_at):
                        ui('testVerifyIsolatedRealProviderPlannedArrival', f'ui-planned-{index}',
                           ('--real-isolated-evidence', str(path),
                            '--real-isolated-previous-evidence', str(root / 'evaluation-1.json'),
                            '--schedule-id', '363', '--existing-title', TITLE))
                        public = json.loads((root / 'ui-status.json').read_text())
                        verify_postdeparture_status_split(value, public)
                        prediction = public.get('plannedJourneyArrivalPrediction') or {}
                        if (prediction.get('basis') != 'MATCHED_TRAIN_REALTIME' or
                                dt.datetime.fromisoformat(prediction['predictedArrivalAt']) !=
                                dt.datetime.fromisoformat(observation['predictedArrivalAt']) or
                                public['recommendedDepartureAt'] != value['recommendedDepartureAt'] or
                                public.get('predictedArrivalAt') is not None or
                                public.get('effectiveTransitRoute') is not None):
                            raise RuntimeError('public_provisional_arrival_does_not_match_worker')
                        (root / f'ui-status-planned-{index}.json').write_text(json.dumps(public, indent=2))
                        record['uiResult'] = 'PROVISIONAL_PASSED'
                        record['plannedArrivalPrediction'] = prediction
                        report['sameTrainProvisionalOnly'] = True
                        break
                record['uiResult'] = 'NO_QUALIFYING_SAME_TRAIN_DELAY_OBSERVATION'
                if (not observation and dt.datetime.fromisoformat(plan['arrivalAt']) >
                        dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=2)):
                    ui('testVerifyIsolatedRealProviderPlannedFallback', f'ui-planned-fallback-{index}',
                       ('--real-isolated-evidence', str(path),
                        '--real-isolated-previous-evidence', str(root / 'evaluation-1.json'),
                        '--schedule-id', '363', '--existing-title', TITLE))
                    public = json.loads((root / 'ui-status.json').read_text())
                    verify_postdeparture_status_split(value, public)
                    prediction = public.get('plannedJourneyArrivalPrediction') or {}
                    if (prediction.get('basis') != 'LAST_ACCEPTED_PLAN' or
                            dt.datetime.fromisoformat(prediction['predictedArrivalAt']) !=
                            dt.datetime.fromisoformat(plan['arrivalAt']) or
                            public['recommendedDepartureAt'] != value['recommendedDepartureAt'] or
                            public.get('predictedArrivalAt') is not None or
                            public.get('effectiveTransitRoute') is not None):
                        raise RuntimeError('public_planned_fallback_does_not_match_worker')
                    (root / f'ui-status-planned-fallback-{index}.json').write_text(json.dumps(public, indent=2))
                    record['uiResult'] = 'FALLBACK_PASSED_NOT_LIVE_CORRECTION'
                    report['plannedFallbackUiVerified'] = True
            elif is_accepted:
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
                if args.verify_planned_postdeparture:
                    initial_plan = value['effectiveSnapshot']['effectiveTransitRoute']
            elif args.journey_provider == 'odsay':
                ui('testVerifyIsolatedRealProviderDiagnostic', f'ui-diagnostic-{index}', ('--real-isolated-evidence', str(path),
                    '--schedule-id', '363', '--existing-title', TITLE))
                (root / f'ui-status-{index}.json').write_bytes((root / 'ui-status.json').read_bytes())
                record['uiResult'] = 'DIAGNOSTIC_PASSED_NOT_ACCEPTED_ETA'
            if not is_accepted:
                accepted_streak = 0
            if args.verify_planned_postdeparture and index == 1 and not is_accepted:
                break
            if (not args.verify_planned_postdeparture and accepted_streak >= 2) or index == max_evaluations:
                break
            if provider_error_requires_stop(value):
                report['providerErrorRetriesStopped'] = True
                break
            due = dt.datetime.fromisoformat(value['nextCheckAt'])
            if args.verify_planned_postdeparture:
                if initial_plan is None:
                    break
                last_ride = [s for s in initial_plan['segments'] if s['kind'] == 'SUBWAY'][-1]
                timetable = last_ride['rideTiming']['timetable']
                planned_at = dt.datetime.fromisoformat(initial_plan['departureAt'])
                station_at = dt.datetime.fromisoformat(timetable['boardingAt' if index == 1 else 'arrivalAt'])
                due = max(due, planned_at + dt.timedelta(seconds=10),
                          station_at - dt.timedelta(minutes=5))
                if due >= dt.datetime.fromisoformat(value['targetArrivalAt']) - dt.timedelta(minutes=3):
                    report['observationWindowUnavailable'] = True
                    break
            seconds = max(0, (due - dt.datetime.now(dt.timezone.utc)).total_seconds())
            if seconds > (75 * 60 if args.verify_planned_postdeparture else 330):
                raise RuntimeError('next_due_outside_bounded_observation')
            emit(state='waiting_persisted_due_time', seconds=round(seconds), nextCheckAt=value['nextCheckAt'])
            wait(lambda: dt.datetime.now(dt.timezone.utc) >= due, server, seconds + 10)
            previous = value
        spec = importlib.util.spec_from_file_location('real_audit', Path(__file__).with_name('verify-real-isolated-eta.py'))
        audit = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audit)
        if args.verify_live_bus_preview:
            report['audit'] = {'result': 'PASSED', 'liveBusPreviewSaved': report['liveBusPreviewSaved'],
                               'workerEvaluations': 0}
        elif args.verify_weekend_bus_options:
            report['audit'] = {'result': 'PASSED', 'weekendBusScheduleSaveVerified': True, 'workerEvaluations': 0}
        elif args.without_station_timetable:
            report['audit'] = {'result': 'PASSED', 'walkEstimateSaved': report['walkEstimateSaved'], 'workerEvaluations': 0}
        elif args.verify_odsay_timetable_selection:
            report['audit'] = {'result': 'PASSED', 'timetableSelectionUiVerified': True, 'timetableMapUiVerified': True,
                               'timetableScheduleSaveVerified': report.get('timetableScheduleSaveVerified', False),
                               'workerEvaluations': 0}
        elif args.verify_planned_postdeparture:
            report['audit'] = postdeparture_audit(report['evaluations'], report.get('sameTrainProvisionalOnly', False))
        else:
            report['audit'] = audit.verify(root, require_comparison_evidence=True, api_base=base)
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
