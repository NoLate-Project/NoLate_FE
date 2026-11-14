"""File-publication races only: no JVM, app, HTTP or Worker invocation."""
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from eta_fixture_snapshot import wait_for_phase_snapshot


class FixtureSnapshotTest(unittest.TestCase):
    def fixture(self):
        path = Mock(spec=Path)
        path.stat.return_value = SimpleNamespace(st_mtime_ns=20)
        process = Mock()
        process.poll.return_value = None
        return path, process

    def test_partial_json_is_not_completion_and_completed_object_is_returned_once(self):
        path, process = self.fixture()
        path.read_text.side_effect = ['{"processed":', '{"processed":1,"workerFailure":null}']
        with patch('eta_fixture_snapshot.time.sleep') as sleep:
            self.assertEqual(wait_for_phase_snapshot(path, 10, process),
                             {'processed': 1, 'workerFailure': None})
        self.assertEqual(path.read_text.call_count, 2)
        sleep.assert_called_once_with(0.5)

    def test_absent_file_can_become_complete_without_restarting_process(self):
        path, process = self.fixture()
        path.stat.side_effect = [FileNotFoundError(), SimpleNamespace(st_mtime_ns=20)]
        path.read_text.return_value = '{"processed":1}'
        with patch('eta_fixture_snapshot.time.sleep'):
            self.assertEqual(wait_for_phase_snapshot(path, -1, process), {'processed': 1})
        process.poll.assert_called()
        path.read_text.assert_called_once()

    def test_same_file_revision_is_never_accepted(self):
        path, process = self.fixture()
        with patch('eta_fixture_snapshot.time.monotonic', side_effect=[0, 0, 61]), \
                patch('eta_fixture_snapshot.time.sleep'):
            with self.assertRaisesRegex(RuntimeError, 'bounded_phase_snapshot_timeout'):
                wait_for_phase_snapshot(path, 20, process)
        path.read_text.assert_not_called()

    def test_incomplete_or_nonobject_json_never_passes_on_timeout(self):
        for content in ('{"processed":', '[]', 'null', '1'):
            with self.subTest(content=content):
                path, process = self.fixture()
                path.read_text.return_value = content
                with patch('eta_fixture_snapshot.time.monotonic', side_effect=[0, 0, 61]), \
                        patch('eta_fixture_snapshot.time.sleep'):
                    with self.assertRaisesRegex(RuntimeError, 'bounded_phase_snapshot_timeout'):
                        wait_for_phase_snapshot(path, 10, process)

    def test_process_exit_is_not_recovered_by_reading_or_restarting(self):
        path, process = self.fixture()
        process.poll.return_value = 1
        with self.assertRaisesRegex(RuntimeError, 'owned_process_exited'):
            wait_for_phase_snapshot(path, 10, process)
        path.read_text.assert_not_called()


if __name__ == '__main__':
    unittest.main()
