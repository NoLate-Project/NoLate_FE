import http.client
import unittest
from unittest.mock import MagicMock, patch
from eta_fixture_scope import PRIVATE_API_BASE, require_memory_fixture_api


class MemoryFixtureScopeTest(unittest.TestCase):
    def response(self, status=200, marker='h2-memory-only', payload=b'{"status":"UP"}'):
        response = MagicMock(status=status)
        response.getheader.return_value = marker
        response.read.return_value = payload
        return response

    @patch('eta_fixture_scope.http.client.HTTPConnection')
    def test_other_servers_are_rejected_without_opening_a_connection(self, connect):
        for base in ('http://127.0.0.1:5522', 'https://nolate.jinuk.dev',
                     'http://127.0.0.1:5523@elsewhere.test', 'http://localhost:5523'):
            with self.subTest(base=base), self.assertRaises(ValueError):
                require_memory_fixture_api(base)
        connect.assert_not_called()

    @patch('eta_fixture_scope.http.client.HTTPConnection')
    def test_private_marker_is_checked_by_one_read_only_direct_request(self, connect):
        connection = connect.return_value
        connection.getresponse.return_value = self.response()
        self.assertEqual(require_memory_fixture_api(PRIVATE_API_BASE)['status'], 'UP')
        connect.assert_called_once_with('127.0.0.1', 5523, timeout=3)
        connection.request.assert_called_once_with('GET', '/health/readiness')
        connection.close.assert_called_once()

    @patch('eta_fixture_scope.http.client.HTTPConnection')
    def test_missing_marker_or_redirect_is_not_a_fixture(self, connect):
        for status, marker in ((200, None), (200, 'production'), (302, 'h2-memory-only'), (401, 'h2-memory-only')):
            connection = connect.return_value = MagicMock()
            connection.getresponse.return_value = self.response(status, marker)
            with self.subTest(status=status, marker=marker), self.assertRaises(RuntimeError):
                require_memory_fixture_api(PRIVATE_API_BASE)
            connection.request.assert_called_once_with('GET', '/health/readiness')
            connection.close.assert_called_once()

    @patch('eta_fixture_scope.http.client.HTTPConnection')
    def test_down_or_malformed_readiness_fails_closed(self, connect):
        for payload in (b'{"status":"DOWN"}', b'[]', b'null', b'not-json'):
            connection = connect.return_value = MagicMock()
            connection.getresponse.return_value = self.response(payload=payload)
            with self.subTest(payload=payload), self.assertRaises(RuntimeError):
                require_memory_fixture_api(PRIVATE_API_BASE)
            connection.close.assert_called_once()

    @patch('eta_fixture_scope.http.client.HTTPConnection')
    def test_readiness_body_is_bounded(self, connect):
        connection = connect.return_value
        response = self.response(payload=b'x' * 4097)
        connection.getresponse.return_value = response
        with self.assertRaises(RuntimeError):
            require_memory_fixture_api(PRIVATE_API_BASE)
        response.read.assert_called_once_with(4097)
        connection.close.assert_called_once()

    @patch('eta_fixture_scope.http.client.HTTPConnection')
    def test_network_failure_closes_connection_without_leaking_raw_error(self, connect):
        for error in (OSError('DO_NOT_PRINT_RAW_DETAIL'), http.client.BadStatusLine('DO_NOT_PRINT_RAW_DETAIL')):
            connection = connect.return_value = MagicMock()
            connection.request.side_effect = error
            with self.subTest(error=type(error).__name__), self.assertRaises(RuntimeError) as failure:
                require_memory_fixture_api(PRIVATE_API_BASE)
            self.assertNotIn('DO_NOT_PRINT_RAW_DETAIL', str(failure.exception))
            connection.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
