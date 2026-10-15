#!/usr/bin/env python3
"""One live standalone lookup, then at most one real Worker in the same isolated JVM; not UI E2E."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

BE = Path(__file__).resolve().parents[3] / 'NoLate_BE'
MATCH_FIELDS = ('exactWireRequestMatchesDirect', 'credentialMatchesDirect', 'endpointMatchesDirect',
                'stationMatchesDirect', 'serviceMatchesDirect', 'rangeMatchesDirect', 'expectedPublicStationAndRange')


def validate_trace(trace):
    """Reject unexpected fields before printing or copying evidence, including accidental secret fields."""
    if not isinstance(trace, dict) or set(trace) != {
        'classification', 'transport', 'attempts', 'omittedAttempts', 'rawCredentialsUrlsOrHashesRetained'
    }:
        raise ValueError('Unexpected trace schema')
    if (trace['classification'] != 'PASSIVE_SAME_PROCESS_SEOUL_ARRIVAL_WIRE_TRACE'
            or trace['transport'] != 'ORIGINAL_REAL_TRANSPORT_UNCHANGED'
            or trace['rawCredentialsUrlsOrHashesRetained'] is not False
            or type(trace['omittedAttempts']) is not int or trace['omittedAttempts'] < 0):
        raise ValueError('Unexpected trace scope')
    attempts = trace['attempts']
    if not isinstance(attempts, list) or len(attempts) > 20:
        raise ValueError('Trace must be bounded')
    worker_seen = False
    for index, event in enumerate(attempts, 1):
        if not isinstance(event, dict) or set(event) != set(MATCH_FIELDS) | {
            'order', 'phase', 'startedAt', 'finishedAt', 'durationMillis', 'httpStatus'
        }:
            raise ValueError('Unexpected event schema')
        if type(event['order']) is not int or event['order'] != index or event['phase'] not in ('DIRECT', 'WORKER'):
            raise ValueError('Invalid event order or phase')
        if index == 1 and event['phase'] != 'DIRECT':
            raise ValueError('Missing direct reference')
        if worker_seen and event['phase'] == 'DIRECT':
            raise ValueError('Direct request after Worker')
        worker_seen |= event['phase'] == 'WORKER'
        if any(type(event[key]) is not bool for key in MATCH_FIELDS):
            raise ValueError('Comparisons must be boolean')
        if event['exactWireRequestMatchesDirect'] and not all(event[key] for key in MATCH_FIELDS[:-1]):
            raise ValueError('Inconsistent comparisons')
        if (type(event['durationMillis']) is not int or event['durationMillis'] < 0
                or event['httpStatus'] is not None and (type(event['httpStatus']) is not int
                                                       or not 100 <= event['httpStatus'] <= 599)):
            raise ValueError('Invalid status or duration')
        for field in ('startedAt', 'finishedAt'):
            parsed = datetime.fromisoformat(event[field].replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                raise ValueError('Timestamp requires offset')
    return bool(attempts) and trace['omittedAttempts'] == 0 and all(
        all(event[key] for key in MATCH_FIELDS) for event in attempts)


def direct_gate(diagnostic):
    # HTTP 200 alone is insufficient: application-level errors or empty local results stop the run.
    return diagnostic['failureKind'] is None and bool(diagnostic['vehicles'])


def wire_delta(before, after):
    """Process metrics are cumulative: do not count the direct success as a Worker success."""
    def counts(rows):
        return {(row['provider'], row['operation'], row['outcome']): row['count'] for row in rows}
    previous, current = counts(before), counts(after)
    if any(value < previous.get(key, 0) for key, value in current.items()) or set(previous) - set(current):
        raise ValueError('Wire counters decreased')
    return [dict(zip(('provider', 'operation', 'outcome'), key), count=value - previous.get(key, 0))
            for key, value in sorted(current.items()) if value > previous.get(key, 0)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', required=True)
    parser.add_argument('--copied-input', type=Path, required=True)
    args = parser.parse_args()
    copied = args.copied_input.resolve(strict=True)
    if not str(copied).startswith('/private/tmp/nolate-real-naver-requery-04-'):
        parser.error('Only the approved synthetic snapshot is supported')
    root = Path(tempfile.mkdtemp(prefix='nolate-eta-real-e2e.', dir='/private/tmp')).resolve()
    server = None
    report = {'classification': 'LIVE_SAME_PROCESS_REQUEST_PARITY_DIAGNOSTIC_NOT_APP_E2E',
              'result': 'FAILED', 'database': 'H2_MEMORY_ONLY', 'providersMocked': False,
              'simulatorUiRun': False, 'productionDatabaseModified': False, 'existingServersStopped': False,
              'existingAppConnectionChanged': False, 'workerExecuted': False, 'workerAccepted': False,
              'actualAccuracyVerified': False, 'rawCredentialsUrlsOrHashesRetained': False}

    def emit(**values):
        print(json.dumps(values), flush=True)

    def private_log(name):
        return os.fdopen(os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')

    def wait_file(name, seconds=100):
        path = root / name
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if path.exists() and path.stat().st_size:
                try:
                    return json.loads(path.read_text())
                except ValueError:
                    pass
            if server.poll() is not None:
                raise RuntimeError('owned_server_exited')
            time.sleep(0.25)
        raise RuntimeError('bounded_wait_timeout')

    def send(command):
        server.stdin.write(command + '\n')
        server.stdin.flush()

    try:
        emit(state='starting_live_request_parity', evidenceRoot=str(root))
        port = subprocess.run(['/usr/sbin/lsof', '-nP', '-iTCP:5523', '-sTCP:LISTEN', '-t'], capture_output=True)
        if port.returncode not in (0, 1) or port.stdout.strip():
            raise RuntimeError('occupied_port_no_process_stopped')
        with private_log('compile.log') as output:
            subprocess.run(['./gradlew', '-I', 'e2e/eta-fixture.init.gradle', 'etaSimulatorFixtureClasspath',
                            '-PetaFixtureOutput=' + str(root), '--console=plain'], cwd=BE,
                           stdout=output, stderr=subprocess.STDOUT, check=True, timeout=300)
        with private_log('server.log') as output:
            server = subprocess.Popen([args.java, '-Xmx1536m', '-Dnolate.eta.real-isolated=true', '-classpath',
                (root / 'classpath.txt').read_text(), 'com.noLate.eta.simulator.EtaRealProviderSimulatorServer',
                str(root), str(copied)], cwd=BE, stdin=subprocess.PIPE, stdout=output,
                stderr=subprocess.STDOUT, text=True, start_new_session=True)
        prepared = wait_file('prepared.json')
        assert prepared['database'] == 'H2_MEMORY_ONLY' and prepared['providersMocked'] is False
        send('trace-start')
        validate_trace(wait_file('arrival-request-trace.json'))
        send('diagnose')
        diagnostic = wait_file('arrival-diagnostic.json')
        report['direct'] = {'accepted': direct_gate(diagnostic), 'observedAt': diagnostic['observedAt'],
                            'vehicleCount': len(diagnostic['vehicles']), 'providerWire': diagnostic['providerWire'],
                            'providerFailures': diagnostic['providerFailures']}
        emit(state='direct_lookup_finished', **report['direct'])
        if not direct_gate(diagnostic):
            report.update(result='BLOCKED_DIRECT_PROVIDER_RESPONSE', stopReason='NO_WORKER_AFTER_REJECTED_OR_EMPTY_DIRECT')
        else:
            send('evaluate')
            evaluated = wait_file('evaluation-1.json', seconds=150)
            report['workerExecuted'] = True
            report['workerAccepted'] = (evaluated['source'] == 'LIVE_PROVIDER' and evaluated['stale'] is False
                and evaluated['failureReason'] is None and (evaluated['effectiveSnapshot'] or {}).get('accepted') is True)
            report['worker'] = {key: evaluated[key] for key in (
                'evaluatedAt', 'source', 'stale', 'failureReason', 'providerWire', 'providerFailures')}
            report['worker']['providerWireDeltaFromDirect'] = wire_delta(diagnostic['providerWire'], evaluated['providerWire'])
            report['result'] = 'REQUEST_PARITY_ONLY' if report['workerAccepted'] else 'WORKER_NOT_ACCEPTED'
        server.wait(timeout=30)  # Fixture exits after rejection or one Worker; no retry loop.
        assert server.returncode == 0
        trace = json.loads((root / 'arrival-request-trace.json').read_text())
        report['allRecordedRequestsMatchDirect'] = validate_trace(trace)
        report['requestTrace'] = trace
        report['physicalSeoulArrivalCalls'] = len(trace['attempts']) + trace['omittedAttempts']
        if report['workerExecuted'] and not any(event['phase'] == 'WORKER' for event in trace['attempts']):
            report['result'] = 'NO_WORKER_WIRE_COMPARISON'
        elif not report['allRecordedRequestsMatchDirect']:
            report['result'] = 'REQUEST_MISMATCH'
    except Exception as failure:
        report.update(result='FAILED', failureKind=type(failure).__name__)
    finally:
        if server is not None and server.poll() is None:
            os.killpg(server.pid, signal.SIGTERM)
            try:
                server.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(server.pid, signal.SIGKILL)
                server.wait(timeout=10)
        report['ownedServerStopped'] = server is None or server.poll() is not None
        (root / 'report.json').write_text(json.dumps(report, indent=2))
        emit(result=report['result'], classification=report['classification'], evidenceRoot=str(root))
    return 0 if report['result'] == 'REQUEST_PARITY_ONLY' else 1


if __name__ == '__main__':
    raise SystemExit(main())
