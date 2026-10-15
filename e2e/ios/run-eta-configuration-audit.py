#!/usr/bin/env python3
"""Audit applied real-adapter configuration with intercepted transport; no live ETA or UI verdict."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

WORKSPACE = Path(__file__).resolve().parents[3]
BE = WORKSPACE / 'NoLate_BE'
MATCH_FIELDS = ('effectiveCredentialMatches', 'endpointMatches', 'exactWireRequestMatches',
                'publicStationMatches', 'physicalServiceMatches', 'physicalRangeMatches',
                'localFilterChangesPreserveWireRequest')
ENV_FIELDS = ('SEOUL_OPENAPI_KEY', 'SEOUL_SUBWAY_API_KEY', 'SEOUL_SUBWAY_BASE_URL', 'SEOUL_ALLOW_INSECURE_HTTP')


def validate_audit(audit):
    """Accept only the fixed, secret-free schema; mismatches fail the configuration gate."""
    metadata = {'classification', 'externalTransitHttpCalls', 'transport', 'fileVsEnvironmentDifferences',
                'rawCredentialsUrlsOrHashesRetained'}
    if not isinstance(audit, dict) or set(audit) != set(MATCH_FIELDS) | metadata:
        raise ValueError('Unexpected audit schema')
    if (audit['classification'] != 'APPLIED_BEAN_AND_DIRECT_DIAGNOSTIC_CONFIGURATION_AUDIT'
            or audit['transport'] != 'IN_MEMORY_MOCK_REQUEST_FACTORY'
            or type(audit['externalTransitHttpCalls']) is not int or audit['externalTransitHttpCalls'] != 0
            or audit['rawCredentialsUrlsOrHashesRetained'] is not False
            or any(type(audit[field]) is not bool for field in MATCH_FIELDS)):
        raise ValueError('Audit scope or types are invalid')
    env = audit['fileVsEnvironmentDifferences']
    if not isinstance(env, dict) or set(env) != set(ENV_FIELDS) or any(type(value) is not bool for value in env.values()):
        raise ValueError('Environment comparison must contain fixed boolean fields only')
    return all(audit[field] for field in MATCH_FIELDS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', required=True)
    parser.add_argument('--copied-input', type=Path, required=True)
    args = parser.parse_args()
    copied = args.copied_input.resolve(strict=True)
    if not str(copied).startswith('/private/tmp/nolate-real-naver-requery-04-'):
        parser.error('Only the previously approved synthetic input is supported')
    root = Path(tempfile.mkdtemp(prefix='nolate-eta-real-e2e.', dir='/private/tmp')).resolve()
    server = None
    report = {'classification': 'APPLIED_CONFIGURATION_AUDIT_NOT_LIVE_ETA_E2E', 'result': 'FAILED',
              'database': 'H2_MEMORY_ONLY', 'externalTransitHttpCalls': 0,
              'requestTransport': 'IN_MEMORY_MOCK', 'simulatorUiRun': False,
              'productionDatabaseModified': False, 'existingServersStopped': False,
              'existingAppConnectionChanged': False, 'historicalProcessConfigurationReconstructed': False,
              'actualProviderRecoveryVerified': False, 'actualAccuracyVerified': False}

    def emit(**values):
        print(json.dumps(values), flush=True)

    def private_log(name):
        return os.fdopen(os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb')

    def wait_file(name, seconds=100):
        deadline = time.monotonic() + seconds
        path = root / name
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

    try:
        emit(state='starting_configuration_audit', evidenceRoot=str(root))
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
        assert prepared['database'] == 'H2_MEMORY_ONLY' and prepared['alertMode'] == 'STANDARD'
        server.stdin.write('configuration-audit\n')
        server.stdin.flush()
        audit = wait_file('configuration-audit.json')
        matches = validate_audit(audit)
        report['configurationAudit'] = audit
        report['result'] = 'PASSED' if matches else 'MISMATCH'
        emit(state='configuration_audit', result=report['result'], **audit)
        # The test fixture exits after audit; intercepted data must not enter any real evaluation.
        server.wait(timeout=30)
        assert server.returncode == 0 and not (root / 'evaluation-1.json').exists()
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
    return 0 if report['result'] == 'PASSED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
