import contextlib
import io
import os
import unittest
import urllib.error
from unittest.mock import patch

import ops_notify


class OpsNotifyHTTPErrorTests(unittest.TestCase):
    def test_http_error_logs_status_without_echoing_response_or_token(self):
        test_url = "https://example.com/events"
        test_token = "fake-unit-token"
        environment = dict(
            zip(
                ("OPS_ALERT_WEBHOOK_URL", "OPS_ALERT_WEBHOOK_TOKEN"),
                (test_url, test_token),
            )
        )

        for status in (400, 403, 404, 500, 503):
            with self.subTest(status=status):
                error = urllib.error.HTTPError(
                    test_url,
                    status,
                    "private response detail",
                    {},
                    None,
                )
                authorization_headers = []

                def fail_with_http_error(request, *args, **kwargs):
                    authorization_headers.append(
                        request.get_header("Authorization")
                    )
                    raise error

                with (
                    patch.dict(os.environ, environment),
                    patch(
                        "ops_notify.urllib.request.urlopen",
                        side_effect=fail_with_http_error,
                    ),
                    contextlib.redirect_stderr(io.StringIO()) as stderr,
                ):
                    self.assertFalse(
                        ops_notify.send_event({"event_id": "test-event"})
                    )

                self.assertEqual(authorization_headers, [f"Bearer {test_token}"])
                self.assertEqual(
                    stderr.getvalue().strip(),
                    f"Operational event delivery failed: HTTP {status}",
                )
                self.assertNotIn("private response detail", stderr.getvalue())
                self.assertNotIn(test_token, stderr.getvalue())



class OpsNotifyCliExitTests(unittest.TestCase):
    def _run_main(self, *, delivered=None, error=None, missing=False):
        argv = ["ops_notify", "--service", "test", "--event-type", "test",
                "--title", "test", "--summary", "test"]
        clean = ["", ""] if missing else ["https://ops.example/events", "test-token"]
        with patch.object(ops_notify.sys, "argv", argv), \
                patch("ops_notify._clean", side_effect=clean), \
                patch("ops_notify.urllib.request.urlopen", return_value=delivered, side_effect=error):
            return ops_notify.main()

    def test_cli_successful_delivery_exits_zero(self):
        class Response:
            status = 202
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                pass
        self.assertEqual(self._run_main(delivered=Response()), 0)

    def test_cli_http_failure_exits_nonzero(self):
        error = urllib.error.HTTPError(
            "https://ops.example/events", 503, "private response detail", {}, None
        )
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self._run_main(error=error), 1)

    def test_cli_missing_configuration_exits_nonzero(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self._run_main(missing=True), 1)


if __name__ == "__main__":
    unittest.main()
