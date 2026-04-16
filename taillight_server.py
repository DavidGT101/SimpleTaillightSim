from __future__ import annotations

import argparse
import json
import socket
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent


class TaillightRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path in {"/", "/index.html"}:
            self.path = "/TaillightSim.html"
            if parsed.query:
                self.path = f"{self.path}?{parsed.query}"
        if parsed.path == "/healthz":
            payload = json.dumps({"ok": True, "app": "SimpleTaillightSim"}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        return super().do_GET()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        print(f"{self.address_string()} - {format % args}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the taillight simulator over HTTP.")
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host interface to bind (use 0.0.0.0 for LAN access).",
    )
    parser.add_argument("--port", type=int, default=8088, help="Port to listen on.")
    return parser.parse_args()


def get_lan_ip() -> str:
    # Determine the primary outbound interface IP to show a shareable LAN URL.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return str(sock.getsockname()[0])
    except OSError:
        return "127.0.0.1"


def main() -> None:
    args = parse_args()
    handler = partial(TaillightRequestHandler)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    server.daemon_threads = True
    if args.host == "0.0.0.0":
        lan_ip = get_lan_ip()
        print(
            "Application startup complete. Serving on all interfaces. "
            f"Open http://{lan_ip}:{args.port} from devices on your network"
        )
    else:
        print(f"Application startup complete. Serving http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()