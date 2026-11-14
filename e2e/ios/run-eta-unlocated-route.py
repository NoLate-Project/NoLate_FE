#!/usr/bin/env python3
"""Actual pinned app: name-only saved destination -> search/select/save -> cold reopen.

Only a fresh marked H2 fixture and synthetic maasRP response are used. No provider
HTTP, production database, authentication bypass or silent route-save repair.
"""
import argparse
import datetime as dt
import http.client
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import urlencode

from eta_fixture_scope import require_memory_fixture_api
from eta_fixture_snapshot import wait_for_phase_snapshot
from eta_pinned_app import DEVICE, open_private_client_with_xcuitest, restore_private_endpoint, verify_lifecycle_summary
from eta_unlocated_route import verify_saved_route
from eta_metro_preparation import prepare_private_metro_bundle

WORKSPACE = Path(__file__).resolve().parents[3]
BE, FE = WORKSPACE / 'NoLate_BE', WORKSPACE / 'NoLate_FE'
BASE = 'http://127.0.0.1:5523'


def audit_incident_reservation(root, day, phase):
    require_memory_fixture_api(BASE)

    def request(method, path, body=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token is not None:
            headers['Authorization'] = 'Bearer ' + token
        conn = http.client.HTTPConnection('127.0.0.1', 5523, timeout=12)
        try:
            conn.request(method, path, json.dumps(body) if body is not None else None, headers)
            reply = conn.getresponse()
            if reply.getheader('X-NoLate-Eta-Fixture') != 'h2-memory-only' or reply.status != 200:
                raise RuntimeError(f'private_fixture_api_{method}_{reply.status}')
            return json.loads(reply.read())['data']
        finally:
            conn.close()

    credentials = json.loads((root / 'credentials.json').read_text())
    assert credentials['memberId'] == 296 and credentials['email'] == 'eta-isolated@example.test'
    login = request('POST', '/api/member/auth/login', {key: credentials[key] for key in ('email', 'password')})
    assert login['id'] == 296
    token = login['accessToken']
    expected = {}
    for schedule_id, start, invalid, minutes in ((363, '10:00', '09:56', 65), (364, '15:20', '17:35', 73)):
        path = f'/api/schedules/{schedule_id}'
        saved = request('GET', path, token=token)
        stamp = lambda clock: dt.datetime.fromisoformat(f'{day}T{clock}:00+09:00')
        assert saved['id'] == schedule_id and saved['ownerMemberId'] == 296
        assert dt.datetime.fromisoformat(saved['startAt']) == stamp(start)
        assert dt.datetime.fromisoformat(saved['departAt']) == stamp(invalid)
        assert saved['travelMinutes'] == minutes and saved['notificationEnabled'] is False
        departure = stamp(start) - dt.timedelta(minutes=minutes)
        saved_status = request('GET', path + '/departure-status', token=token)
        assert dt.datetime.fromisoformat(saved_status['recommendedDepartureAt']) == departure
        assert saved_status['travelMinutes'] == minutes and saved_status['stale'] is True
        assert not saved_status.get('predictedArrivalAt')
        payload = {key: saved[key] for key in ('title', 'startAt', 'endAt', 'category', 'travelMinutes',
                                               'departAt', 'origin', 'destination', 'travelMode', 'scheduleType')}
        # The previous fixture had no selected route and could only test job registration.
        # Include a synthetic selected itinerary so the Worker must reach its provider.
        rides = [dict(mode='SUBWAY', routeId='11004', lineName='수도권 4호선', serviceClass='LOCAL',
                      startName='노원역', endName='사당'),
                 dict(mode='SUBWAY', routeId='11002', lineName='수도권 2호선', serviceClass='LOCAL',
                      startName='사당', endName='신림')]
        route_info = dict(
            id=f'incident-route-{schedule_id}', originName='노원역', destinationName='신림역',
            provider='tmap', totalDurationMinutes=minutes, departureTime=departure.isoformat(),
            arrivalTime=stamp(start).isoformat(), timeBasis='estimated',
            steps=[
                dict(id='origin', type='ORIGIN', title='출발지'),
                dict(id='incident-first-train', type='SUBWAY', title='노원역', lineName='4호선',
                     directionCode='DOWN', durationMinutes=45),
                dict(id='incident-second-train', type='SUBWAY', title='사당', lineName='2호선',
                     durationMinutes=minutes - 45),
                dict(id='destination', type='DESTINATION', title='도착지'),
            ],
        )
        payload.update(notificationEnabled=True, notificationLeadMinutes=60, alertMode='STANDARD',
                       route=dict(provider='tmap', mode='TRANSIT', minutes=minutes, steps=rides, routeInfo=route_info,
                                  selectedRouteOption=dict(provider='tmap', minutes=minutes, transferCount=1, steps=rides)))
        updated = request('PUT', path, payload, token)
        assert dt.datetime.fromisoformat(updated['departAt']) == departure
        expected[schedule_id] = (stamp(start), departure)

    rows = phase('inspect-incident-reservation', 'incident-reservation.json')['cases']
    assert [row['id'] for row in rows] == [363, 364]
    for row in rows:
        target, departure = expected[row['id']]
        assert dt.datetime.fromisoformat(row['target']) == target
        for key in ('savedDeparture', 'personalDeparture', 'jobDeparture'):
            assert dt.datetime.fromisoformat(row[key]) == departure, key
        for key in ('monitorStart', 'nextCheck'):
            assert dt.datetime.fromisoformat(row[key]) == departure - dt.timedelta(minutes=60), key
        assert row['status'] == 'ACTIVE' and row['checkCount'] == 0
    evaluations = phase('evaluate-incident-reservation', 'incident-due-evaluation.json')['cases']
    assert [row['id'] for row in evaluations] == [363, 364]
    for row in evaluations:
        target, departure = expected[row['id']]
        assert (row['early'], row['processed']) == (0, 1)
        assert dt.datetime.fromisoformat(row['evaluatedAt']) == departure - dt.timedelta(minutes=60)
        assert dt.datetime.fromisoformat(row['target']) == target
        assert dt.datetime.fromisoformat(row['protectedDeparture']) == departure
        assert row['stale'] is True and row['source'] in ('SELECTED_ROUTE', 'SAVED_FALLBACK')
        assert row['failureCode'] == 'TRANSIT_JOURNEY_PROVIDER_UNAVAILABLE'
        assert len(row['routeRequests']) == 1
        assert row['routeRequests'][0]['searchDttm'] == departure.strftime('%Y%m%d%H%M')
    assert phase('prepare-incident-station-board', 'incident-station-board.json')['ready']
    route = '/api/transit-arrivals/subway?'
    down = request('GET', route + urlencode(dict(stationName='노원', lineName='4호선',
                                                 directionCode='DOWN', limit=2)), token=token)
    up = request('GET', route + urlencode(dict(stationName='노원', lineName='4호선',
                                               directionCode='UP', limit=2)), token=token)
    assert [row['trainNumber'] for row in down] == ['4012', '4013']
    assert [row['trainNumber'] for row in up] == ['4099']
    assert down[0]['expectedAt'] == down[1]['expectedAt']
    assert dt.datetime.fromisoformat(down[0]['sourceUpdatedAt']) > dt.datetime.fromisoformat(down[1]['sourceUpdatedAt'])
    return {'result': 'PASSED', 'database': 'H2_MEMORY_ONLY', 'cases': rows, 'dueEvaluations': evaluations,
            'stationBoard': {'result': 'PASSED', 'distinctDownTrains': len(down), 'distinctUpTrains': len(up),
                             'sameClockDifferentTrainsPreserved': True}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', required=True)
    parser.add_argument('--initial-destination', choices=('name-only', 'located'), default='name-only')
    parser.add_argument('--incident-calendar', action='store_true', help='Verify agenda and isolated API/job reservation for inconsistent legacy departures')
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='nolate-eta-mock-e2e.', dir='/private/tmp')).resolve()
    server = metro = None
    prepared = False
    report = dict(classification='SYNTHETIC_UNLOCATED_DESTINATION_INSTALLED_APP_E2E', result='FAILED',
                  device=DEVICE, database='H2_MEMORY_ONLY', providersMocked=True,
                  productionDatabaseModified=False, physicalTransitHttpCalls=0,
                  actualTripAccuracyVerified=False,
                  clientTransitTransport='EXPLICIT_MARKED_LOCAL_MAASRP',
                  initialDestination=args.initial_destination,
                  realMobileProviderKeysPassedToMetro=False, mobileEnvFileLoading=False, cases=[])

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

    def wait(check, child):
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if child.poll() is not None:
                raise RuntimeError('owned_process_exited')
            try:
                if check():
                    return
            except (OSError, ValueError, RuntimeError):
                pass
            time.sleep(0.5)
        raise RuntimeError('bounded_startup_timeout')

    def phase(command, filename):
        path = root / filename
        previous = path.stat().st_mtime_ns if path.exists() else -1
        server.stdin.write(command + '\n')
        server.stdin.flush()
        return wait_for_phase_snapshot(path, previous, server)

    def ui(method, name, target, extra=(), travel_minutes=None):
        title = 'ETA E2E calendar 1' if args.incident_calendar else 'ETA E2E unlocated'
        command = ['python3', 'e2e/ios/run-eta.py', '--device', DEVICE, '--output', str(root / name),
                   '--only', method, '--title', title, '--target-arrival', target, '--api-base', BASE]
        command += list(extra)
        env = dict(os.environ)
        if travel_minutes is not None:
            env['TEST_RUNNER_E2E_UNLOCATED_TRAVEL_MINUTES'] = str(travel_minutes)
        emit(state='ui_start', case=name)
        with log(name + '-launcher.log') as output:
            child = subprocess.Popen(command, cwd=FE, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                if child.wait(timeout=360):
                    raise RuntimeError('pinned_ui_failed')
            finally:
                stop(child)
        summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary',
                            '--path', str(root / name / 'result.xcresult')], timeout=30))
        verify_lifecycle_summary(summary)
        report['cases'].append(dict(method=method, result='PASSED', root=str(root / name)))
        emit(state='ui_passed', case=name)

    try:
        emit(state='starting', evidenceRoot=str(root))
        for port in (5523, 8086):
            check = subprocess.run(['/usr/sbin/lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN', '-t'], capture_output=True)
            if check.returncode not in (0, 1) or check.stdout.strip():
                raise RuntimeError('occupied_port_existing_process_preserved')
        java_home = str(Path(args.java).resolve(strict=True).parent.parent)
        with log('compile.log') as output:
            subprocess.run(['./gradlew', '--no-daemon', '--max-workers=2', '-Dorg.gradle.java.home=' + java_home,
                '-I', 'e2e/eta-fixture.init.gradle', 'etaSimulatorFixtureClasspath', '-PetaFixtureOutput=' + str(root),
                '--console=plain'], cwd=BE, env=dict(os.environ, JAVA_HOME=java_home),
                stdout=output, stderr=subprocess.STDOUT, check=True, timeout=300)
        with log('server.log') as output:
            server = subprocess.Popen([args.java, '-Xmx1536m', '-Dnolate.eta.simulator-fixture=true',
                '-classpath', (root / 'classpath.txt').read_text(),
                'com.noLate.eta.simulator.EtaSimulatorFixtureServer', str(root)], cwd=BE,
                stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT, text=True, start_new_session=True)
        wait(lambda: require_memory_fixture_api(BASE), server)
        if args.incident_calendar:
            report['classification'] = 'SYNTHETIC_INCIDENT_CALENDAR_INSTALLED_APP_E2E'
            before = phase('prepare-incident-calendar', 'incident-calendar.json')
            assert before['scheduleIds'] == [363, 364] and before['database'] == 'H2_MEMORY_ONLY'
            assert before['historyCount'] == before['jobCount'] == 0
            target = before['date'] + 'T10:00:00+09:00'
        else:
            before = phase('prepare-unlocated-located' if args.initial_destination == 'located' else 'prepare-unlocated',
                           'unlocated-before.json')
            prepared = True
            target = dt.datetime.fromisoformat(before['targetArrivalAt']).astimezone(dt.timezone(dt.timedelta(hours=9))).isoformat()
        # Normal mobile transit routing is ODsay-only. A Tmap env variable does
        # not switch it. Blank real keys and opt into the marked local protocol
        # fixture; a missing/invalid opt-in must make zero public provider calls.
        env = dict(os.environ, EXPO_PUBLIC_LOCAL_API_BASE_URL=BASE,
                   EXPO_PUBLIC_ODSAY_ISOLATED_SIMULATOR_FIXTURE='1',
                   EXPO_PUBLIC_ODSAY_IOS_API_KEY='', EXPO_PUBLIC_ODSAY_ANDROID_API_KEY='',
                   EXPO_NO_DOTENV='1', REACT_NATIVE_PACKAGER_HOSTNAME='127.0.0.1', CI='1')
        with log('metro.log') as output:
            metro = subprocess.Popen(['npx', 'expo', 'start', '--dev-client', '--localhost', '--port', '8086',
                '--max-workers', '2'], cwd=FE, env=env, stdin=subprocess.DEVNULL,
                stdout=output, stderr=subprocess.STDOUT, start_new_session=True)

        def metro_ready():
            with urllib.request.urlopen('http://127.0.0.1:8086/status', timeout=2) as response:
                return response.read() == b'packager-status:running'

        wait(metro_ready, metro)
        emit(state='preparing_owned_metro_entry_before_app_launch')
        report['metroPreparation'] = prepare_private_metro_bundle()
        report['startupTransport'] = open_private_client_with_xcuitest(DEVICE, root / 'ui-private-lifecycle')
        ui('testLoginDedicatedEtaAccount', 'ui-login', target, ('--credentials', str(root / 'credentials.json')))
        if args.incident_calendar:
            ui('testVerifyIncidentCalendarDeparture', 'ui-incident-calendar', target)
            report['reservationAudit'] = audit_incident_reservation(root, before['date'], phase)
            subprocess.run(['xcrun', 'simctl', 'openurl', DEVICE, 'nolate://schedule/363'], check=True, timeout=30)
            ui('testVerifyIncidentStationBoard', 'ui-incident-station-board', target)
        else:
            subprocess.run(['xcrun', 'simctl', 'openurl', DEVICE, 'nolate://schedule/363'], check=True, timeout=30)
            scoped = ('--schedule-id', '363', '--existing-title', 'E2E 도착지만 저장')
            ui('testSaveUnlocatedDestinationRoute', 'ui-save-route', target, scoped + ('--allow-save',))
            after = phase('inspect-unlocated', 'unlocated-after.json')
            (root / 'unlocated-after-save.json').write_text(json.dumps(after, indent=2))
            report['savedRouteAudit'] = verify_saved_route(before, after)
            # Public XCTest terminates/opens this same installed client. No re-login,
            # mutation, route JSON injection or API lookup repairs the saved record.
            report['reopenTransport'] = open_private_client_with_xcuitest(DEVICE, root / 'ui-reopen-lifecycle')
            subprocess.run(['xcrun', 'simctl', 'openurl', DEVICE, 'nolate://schedule/363'], check=True, timeout=30)
            ui('testVerifyUnlocatedDestinationRouteReopened', 'ui-reopened-route', target, scoped,
               travel_minutes=report['savedRouteAudit']['travelMinutes'])
            final = phase('inspect-unlocated', 'unlocated-after.json')
            (root / 'unlocated-after-reopen.json').write_text(json.dumps(final, indent=2))
            assert final == after, 'Read-only reopening must not mutate or re-query the selected route'
            report['reopenDidNotMutateSavedRoute'] = True
        report['result'] = 'PASSED'
    except Exception as error:
        report['failureKind'] = type(error).__name__
        if isinstance(error, RuntimeError) and str(error).startswith(('private_fixture_api_', 'bounded_phase_snapshot_')):
            report['failureStage'] = str(error)
        emit(state='failed', kind=type(error).__name__)
    finally:
        if prepared and report['result'] != 'PASSED' and server is not None and server.poll() is None:
            try:
                # Read-only failure evidence, not a retry/save/Worker repair.
                failed = phase('inspect-unlocated', 'unlocated-after.json')
                (root / 'unlocated-failure-inspection.json').write_text(json.dumps(failed, indent=2))
                report['failureDatabaseInspection'] = 'PRESERVED'
            except Exception as error:
                report['failureInspectionKind'] = type(error).__name__
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
        emit(result=report['result'], evidenceRoot=str(root))
    return 0 if report['result'] == 'PASSED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
