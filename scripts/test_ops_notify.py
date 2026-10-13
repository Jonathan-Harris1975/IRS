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
                    patch.dict(
                        os.environ,
                        {
                            "OPS_ALERT_WEBHOOK_URL": test_url,
                            "OPS_ALERT_WEBHOOK_TOKEN": test_token,
                        },
                    ),
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


if __name__ == "__main__":
    unittest.main()
