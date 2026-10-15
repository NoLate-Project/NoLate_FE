"""Reset only in-memory navigation on the explicitly authorized E2E simulator.

No uninstall, data deletion, notification deletion, or other-device operation.
Starting a fresh H2 server must not inherit mounted screens from an older H2 login.
"""
import subprocess

DEVICE = '9EFFB87E-1E6D-4C2B-A81C-2D38CCF6EC69'
BUNDLE = 'com.anonymous.nolatefe'


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
