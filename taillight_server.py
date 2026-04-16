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
    HTTP_METHODS = {"GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE", "CONNECT"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    @staticmethod
    def _sanitize_log_text(text: str, *, limit: int = 220) -> str:
        sanitized = "".join(ch if 32 <= ord(ch) <= 126 else f"\\x{ord(ch):02x}" for ch in text)
        if len(sanitized) > limit:
            return f"{sanitized[:limit]}...(truncated)"
        return sanitized

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path in {"/", "/index.html"}:
            self.path = "/TaillightSim.html"
            if parsed.query:
                self.path = f"{self.path}?{parsed.query}"
        if parsed.path == "/favicon.ico":
            favicon = ROOT / "favicon.ico"
            if favicon.is_file():
                self.path = "/favicon.ico"
                return super().do_GET()
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
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

    def log_error(self, format: str, *args) -> None:  # noqa: A003
        rendered = format % args if args else format
        if "Bad request version" in rendered:
            print(f"{self.address_string()} - Ignored non-HTTP traffic on HTTP port (likely HTTPS/TLS)")
            return
        self.log_message(format, *args)

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        if str(code) == "400" and self.requestline:
            method = self.requestline.split(" ", 1)[0]
            if method not in self.HTTP_METHODS:
                print(f"{self.address_string()} - Rejected malformed/non-HTTP request on HTTP port (400)")
                return
        super().log_request(code, size)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        rendered = format % args if args else format
        print(f"{self.address_string()} - {self._sanitize_log_text(rendered)}")


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