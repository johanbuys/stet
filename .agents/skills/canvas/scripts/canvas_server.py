#!/usr/bin/env python3
"""canvas server.

Serves a canvas directory over HTTP and accepts feedback POSTs from the page.

  GET  /<file>      -> static files from --dir
  POST /feedback    -> JSON body {doc: <stem>, ...} saved to:
                         <dir>/feedback/<doc>-feedback.json        (latest)
                         <dir>/feedback/<doc>-feedback-<ts>.json   (archive)
                       plus a wake marker touched at:
                         <dir>/feedback/<doc>.new

The agent watches for the marker (`until [ -f .../feedback/<doc>.new ]; do sleep 2; done`),
deletes it, reads the latest feedback, acts, regenerates the page, and bumps version.json so
the open browser reloads itself. Every response carries Cache-Control: no-store so the page's
version polling always sees fresh files.
"""
import argparse
import json
import os
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dir", default=".", help="canvas directory to serve")
    ap.add_argument("--port", type=int, default=3119)
    args = ap.parse_args()
    root = os.path.abspath(args.dir)
    feedback_dir = os.path.join(root, "feedback")

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=root, **kw)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_POST(self):
            if self.path != "/feedback":
                self.send_response(404)
                self.end_headers()
                return
            try:
                length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"ok":false,"error":"invalid json"}')
                return
            doc = "".join(
                c for c in str(payload.get("doc", "canvas")) if c.isalnum() or c in "-_"
            ) or "canvas"
            payload["received"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            os.makedirs(feedback_dir, exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            for name in (f"{doc}-feedback.json", f"{doc}-feedback-{stamp}.json"):
                with open(os.path.join(feedback_dir, name), "w") as f:
                    json.dump(payload, f, indent=2)
            with open(os.path.join(feedback_dir, f"{doc}.new"), "w") as f:
                f.write(payload["received"])
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

        def log_message(self, fmt, *a):
            print(f"{self.address_string()} {fmt % a}", flush=True)

    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"canvas: serving {root} on 0.0.0.0:{args.port}; feedback -> {feedback_dir}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
