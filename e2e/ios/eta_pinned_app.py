"""Reset only in-memory navigation on the explicitly authorized E2E simulator.

No uninstall, data deletion, notification deletion, or other-device operation.
Starting a fresh H2 server must not inherit mounted screens from an older H2 login.
"""
import json
import os
from pathlib import Path
import subprocess

DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'
BUNDLE = 'com.anonymous.nolatefe'


def verify_lifecycle_summary(summary):
    assert summary['result'] == 'Passed'
    assert summary['passedTests'] == summary['totalTestCount'] == 1
    assert summary['failedTests'] == summary['skippedTests'] == 0
    assert summary['devicesAndConfigurations']
    assert all(row['device']['deviceId'] == DEVICE for row in summary['devicesAndConfigurations'])


def open_private_client_with_xcuitest(device, output):
    """Use public iOS XCTest lifecycle APIs when the host simctl bridge stalls.

    A passed transport test proves reset/URL dispatch only. Callers must still
    execute their original authenticated app and ETA assertions without retries.
    """
    if device != DEVICE:
        raise ValueError('Unexpected simulator; no app operation performed')
    output = Path(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    metadata = {'classification': 'PINNED_XCTEST_LIFECYCLE_TRANSPORT_ONLY',
                'device': device, 'appDataDeleted': False, 'otherDevicesTouched': False,
                'etaValidated': False}
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2))
    env = dict(os.environ, TEST_RUNNER_E2E_PINNED_PRIVATE_LIFECYCLE='1')
    env.pop('TEST_RUNNER_E2E_EXPECT_PRIVATE_ENDPOINT_OFFLINE', None)
    command = ['xcodebuild', '-project', str(Path(__file__).with_name('NoLateE2E.xcodeproj')),
               '-scheme', 'NoLateE2E', '-destination', 'platform=iOS Simulator,id=' + device,
               '-parallel-testing-enabled', 'NO', '-jobs', '2',
               '-derivedDataPath', '/private/tmp/nolate-eta-xcuitest-20261003',
               '-resultBundlePath', str(output / 'result.xcresult'),
               '-only-testing:NoLateE2ETests/NoLatePinnedDeviceControlsTests/testOpenPrivateDevelopmentClient',
               'test']
    with os.fdopen(os.open(output / 'run.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as log:
        subprocess.run(command, cwd=Path(__file__).resolve().parents[2], env=env,
                       stdout=log, stderr=subprocess.STDOUT, check=True, timeout=180)
    summary = json.loads(subprocess.check_output(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary',
        '--path', str(output / 'result.xcresult')], timeout=30))
    verify_lifecycle_summary(summary)
    assert 'ETA_PINNED_PRIVATE_LIFECYCLE_URL_DISPATCHED' in (output / 'run.log').read_text()
    (output / 'summary.json').write_text(json.dumps(summary, indent=2))
    return dict(metadata, result='PASSED', evidenceRoot=str(output))


def require_private_development_client(device):
    """Fail before real provider calls if the pinned simulator has a Release app."""
    if device != DEVICE:
        raise ValueError('Unexpected simulator; no app operation performed')
    result = subprocess.run(
        ['xcrun', 'simctl', 'get_app_container', device, BUNDLE, 'app'],
        capture_output=True, text=True, timeout=30,
    )
    app_path = result.stdout.strip()
    if result.returncode != 0 or not app_path or not (Path(app_path) / 'EXDevLauncher.bundle').is_dir():
        raise RuntimeError('Pinned simulator needs the Expo development client before provider calls')


def open_private_test_endpoint(device):
    """Retry one cold-launch timeout, never another device or an ETA assertion.

    Successful URL dispatch is only startup; callers still require actual UI
    tests. Shutdown/other errors are not recovered by global simulator resets.
    """
    if device != DEVICE:
        raise ValueError('Unexpected simulator; no app operation performed')
    command = ['xcrun', 'simctl', 'openurl', device,
               'nolate://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8086']
    for attempt in range(2):
        try:
            result = subprocess.run(command, capture_output=True, timeout=30)
        except subprocess.TimeoutExpired:
            if attempt == 1:
                raise
            continue
        if result.returncode == 0:
            return
        if result.returncode != 60 or attempt == 1:
            raise RuntimeError('Pinned test endpoint launch failed')


def reset_private_navigation(device):
    if device != DEVICE:
        raise ValueError('Unexpected simulator; no app operation performed')
    result = subprocess.run(['xcrun', 'simctl', 'terminate', device, BUNDLE],
                            capture_output=True, timeout=30)
    # simctl returns 3 when this specific installed app is already stopped.
    # Other errors must not be ignored or printed with arbitrary command output.
    if result.returncode not in (0, 3):
        raise RuntimeError('Pinned app could not be stopped for private navigation reset')


def restore_private_endpoint(device):
    if device != DEVICE:
        raise ValueError('Unexpected simulator; no app operation performed')
    try:
        result = subprocess.run(['xcrun', 'simctl', 'openurl', device,
            'nolate://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8085'],
            capture_output=True, timeout=30)
        return {'originalAppEndpointRestored': result.returncode == 0}
    except (OSError, subprocess.TimeoutExpired) as error:
        # Restoration failure must be visible without losing the failed E2E report
        # or exporting arbitrary command output/credentials in an exception.
        return {'originalAppEndpointRestored': False,
                'endpointRestoreFailureKind': type(error).__name__}
