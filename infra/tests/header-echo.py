"""Test-only upstream for infra/smoke.sh: answers every request with the request headers it received
(lower-cased names, JSON). Never part of the stack."""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = json.dumps({k.lower(): v for k, v in self.headers.items()}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_POST = do_GET

    def log_message(self, *args: object) -> None:
        pass


HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()  # noqa: S104
