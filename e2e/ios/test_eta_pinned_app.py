"""Pure launcher tests, not simulator execution evidence."""
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from eta_pinned_app import (
    DEVICE, require_private_development_client, reset_private_navigation,
    restore_private_endpoint, open_private_test_endpoint,
)


class PinnedDevelopmentClientTest(unittest.TestCase):
    @patch('eta_pinned_app.subprocess.run')
    def test_installed_development_client_passes(self, run):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / 'EXDevLauncher.bundle').mkdir()
            run.return_value = subprocess.CompletedProcess([], 0, stdout=root)
            require_private_development_client(DEVICE)
        run.assert_called_once_with(
            ['xcrun', 'simctl', 'get_app_container', DEVICE, 'com.anonymous.nolatefe', 'app'],
            capture_output=True, text=True, timeout=30,
        )

    @patch('eta_pinned_app.subprocess.run')
    def test_release_app_fails_before_provider_calls(self, run):
        with tempfile.TemporaryDirectory() as root:
            run.return_value = subprocess.CompletedProcess([], 0, stdout=root)
            with self.assertRaises(RuntimeError):
                require_private_development_client(DEVICE)

    @patch('eta_pinned_app.subprocess.run')
    def test_missing_app_fails_before_provider_calls(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, stdout='')
        with self.assertRaises(RuntimeError):
            require_private_development_client(DEVICE)

    @patch('eta_pinned_app.subprocess.run')
    def test_another_simulator_is_not_inspected(self, run):
        with self.assertRaises(ValueError):
            require_private_development_client('another-device')
        run.assert_not_called()


class PinnedColdLaunchTest(unittest.TestCase):
    @patch('eta_pinned_app.subprocess.run')
    def test_known_timeout_gets_only_one_retry_on_the_same_device_and_endpoint(self, run):
        for failure in (subprocess.CompletedProcess([], 60), subprocess.TimeoutExpired('private', 30)):
            run.reset_mock()
            run.side_effect = [failure, subprocess.CompletedProcess([], 0)]
            open_private_test_endpoint(DEVICE)
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[0], run.call_args_list[1])
            self.assertEqual(run.call_args.args[0][3], DEVICE)
            self.assertTrue(run.call_args.args[0][4].endswith('8086'))

    @patch('eta_pinned_app.subprocess.run')
    def test_persistent_timeout_is_not_success(self, run):
        run.return_value = subprocess.CompletedProcess([], 60)
        with self.assertRaises(RuntimeError):
            open_private_test_endpoint(DEVICE)
        self.assertEqual(run.call_count, 2)

    @patch('eta_pinned_app.subprocess.run')
    def test_shutdown_or_other_error_is_not_retried(self, run):
        run.return_value = subprocess.CompletedProcess([], 405)
        with self.assertRaises(RuntimeError):
            open_private_test_endpoint(DEVICE)
        run.assert_called_once()

    @patch('eta_pinned_app.subprocess.run')
    def test_another_device_is_never_touched(self, run):
        with self.assertRaises(ValueError):
            open_private_test_endpoint('another-device')
        run.assert_not_called()


class PinnedNavigationResetTest(unittest.TestCase):
    @patch('eta_pinned_app.subprocess.run')
    def test_only_the_pinned_installed_app_is_terminated(self, run):
        for code in (0, 3):
            run.return_value = subprocess.CompletedProcess([], code)
            reset_private_navigation(DEVICE)
            run.assert_called_with(['xcrun', 'simctl', 'terminate', DEVICE, 'com.anonymous.nolatefe'],
                                   capture_output=True, timeout=30)

    @patch('eta_pinned_app.subprocess.run')
    def test_another_device_is_rejected_before_any_command(self, run):
        with self.assertRaises(ValueError):
            reset_private_navigation('another-device')
        run.assert_not_called()

    @patch('eta_pinned_app.subprocess.run')
    def test_unexpected_failure_is_not_silently_accepted(self, run):
        run.return_value = subprocess.CompletedProcess([], 1)
        with self.assertRaises(RuntimeError):
            reset_private_navigation(DEVICE)


class PinnedEndpointRestorationTest(unittest.TestCase):
    @patch('eta_pinned_app.subprocess.run')
    def test_only_the_pinned_endpoint_is_restored(self, run):
        run.return_value = subprocess.CompletedProcess([], 0)
        self.assertEqual(restore_private_endpoint(DEVICE), {'originalAppEndpointRestored': True})
        self.assertEqual(run.call_args.args[0][3], DEVICE)

    @patch('eta_pinned_app.subprocess.run')
    def test_timeout_is_reported_without_raising_or_raw_command_output(self, run):
        run.side_effect = subprocess.TimeoutExpired('private-command', 30, output='private-data')
        self.assertEqual(restore_private_endpoint(DEVICE),
                         {'originalAppEndpointRestored': False, 'endpointRestoreFailureKind': 'TimeoutExpired'})

    @patch('eta_pinned_app.subprocess.run')
    def test_unsuccessful_exit_is_not_a_restoration_pass(self, run):
        run.return_value = subprocess.CompletedProcess([], 1)
        self.assertEqual(restore_private_endpoint(DEVICE), {'originalAppEndpointRestored': False})

    @patch('eta_pinned_app.subprocess.run')
    def test_another_device_is_rejected_before_restore(self, run):
        with self.assertRaises(ValueError):
            restore_private_endpoint('another-device')
        run.assert_not_called()
