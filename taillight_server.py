from __future__ import annotations

import argparse
import importlib
import json
import socket
import sys
import threading
import time
from urllib import error as urlerror
from urllib import request as urlrequest
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import rmtree
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
CONTROL_SHUTDOWN_PATH = "/__control/shutdown"
CONTROL_RESTART_PATH = "/__control/restart"
CONTROL_HEARTBEAT_PATH = "/__control/heartbeat"
CONTROL_DISCONNECT_PATH = "/__control/disconnect"
ACTIVE_WINDOW_SECONDS = 20.0
STATUS_SORT_ORDER = {"active": 0, "idle": 1, "offline": 2}


def clear_runtime_cache() -> dict[str, int]:
    """Best-effort cleanup for Python/runtime caches inside the project root."""
    importlib.invalidate_caches()
    removed_pycache_dirs = 0
    for cache_dir in ROOT.rglob("__pycache__"):
        if not cache_dir.is_dir():
            continue
        try:
            rmtree(cache_dir)
            removed_pycache_dirs += 1
        except OSError:
            # Ignore file lock/race conditions during shutdown/restart.
            pass
    return {"pycache_dirs_removed": removed_pycache_dirs}


class TaillightHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.restart_requested = False
        self._shutdown_requested = False
        self._state_lock = threading.Lock()
        self._clients_lock = threading.Lock()
        self._clients: dict[str, dict[str, object]] = {}

    def request_stop(self, *, restart: bool = False) -> None:
        """Stop the server safely, optionally requesting restart."""
        with self._state_lock:
            if restart:
                self.restart_requested = True
            if self._shutdown_requested:
                return
            self._shutdown_requested = True
        clear_runtime_cache()
        threading.Thread(target=self.shutdown, daemon=True).start()

    @staticmethod
    def _normalize_client_id(client_id: str | None, ip: str) -> str:
        if client_id is None:
            return f"ip:{ip}"
        cleaned = client_id.strip()
        return cleaned[:80] if cleaned else f"ip:{ip}"

    def note_client_heartbeat(
        self,
        *,
        client_id: str | None,
        ip: str,
        user_agent: str,
        page_visible: bool | None,
        page: str | None,
    ) -> None:
        now = time.time()
        normalized_id = self._normalize_client_id(client_id, ip)
        with self._clients_lock:
            entry = self._clients.setdefault(normalized_id, {})
            entry["client_id"] = normalized_id
            entry["ip"] = ip
            entry["connected"] = True
            entry["last_seen"] = now
            entry["user_agent"] = user_agent[:140]
            if page_visible is not None:
                entry["page_visible"] = bool(page_visible)
            if page is not None:
                entry["page"] = str(page)[:120]
            self._clients[normalized_id] = entry

    def note_client_disconnect(self, *, client_id: str | None, ip: str, user_agent: str) -> None:
        now = time.time()
        normalized_id = self._normalize_client_id(client_id, ip)
        with self._clients_lock:
            entry = self._clients.setdefault(normalized_id, {})
            entry["client_id"] = normalized_id
            entry["ip"] = ip
            entry["connected"] = False
            entry["last_seen"] = now
            entry["page_visible"] = False
            entry["user_agent"] = user_agent[:140]

    def get_client_snapshot(self) -> list[dict[str, object]]:
        now = time.time()
        rows: list[dict[str, object]] = []
        stale_keys: list[str] = []
        with self._clients_lock:
            items = list(self._clients.items())
        for client_id, entry in items:
            last_seen = float(entry.get("last_seen", 0.0))
            age_seconds = max(0.0, now - last_seen)
            connected = bool(entry.get("connected", False))
            if not connected and age_seconds > 3600:
                stale_keys.append(client_id)
                continue
            if connected and age_seconds <= ACTIVE_WINDOW_SECONDS:
                status = "active"
            elif connected:
                status = "idle"
            else:
                status = "offline"
            page_visible = entry.get("page_visible")
            page_state = "visible" if page_visible is True else "hidden" if page_visible is False else "unknown"
            rows.append(
                {
                    "client_id": str(entry.get("client_id", client_id)),
                    "ip": str(entry.get("ip", "?")),
                    "status": status,
                    "page": page_state,
                    "age_seconds": age_seconds,
                    "user_agent": str(entry.get("user_agent", "")),
                }
            )
        if stale_keys:
            with self._clients_lock:
                for key in stale_keys:
                    self._clients.pop(key, None)
        rows.sort(key=lambda row: (STATUS_SORT_ORDER.get(str(row["status"]), 3), str(row["ip"]), str(row["client_id"])))
        return rows


class TerminalCommandListener:
    """Reads commands from stdin while the server is running."""

    def __init__(self) -> None:
        self._server: TaillightHTTPServer | None = None
        self._state_lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._startup_line = ""

    @staticmethod
    def _stdin_is_interactive() -> bool:
        return bool(getattr(sys.stdin, "isatty", lambda: False)())

    def bind_server(self, server: TaillightHTTPServer) -> None:
        with self._state_lock:
            self._server = server

    def set_startup_line(self, line: str) -> None:
        with self._state_lock:
            self._startup_line = line

    def start(self) -> None:
        if not self._stdin_is_interactive() or self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="taillight-terminal-commands", daemon=True)
        self._thread.start()
        print("Terminal commands available: active | clear | shutdown | restart | help")

    def _get_server(self) -> TaillightHTTPServer | None:
        with self._state_lock:
            return self._server

    def _get_startup_line(self) -> str:
        with self._state_lock:
            return self._startup_line

    def _clear_terminal_output(self) -> None:
        # Clear visible terminal output and keep the latest startup URL line.
        if self._stdin_is_interactive():
            sys.stdout.write("\033[2J\033[H")
            sys.stdout.flush()
        startup_line = self._get_startup_line()
        if startup_line:
            print(startup_line)

    @staticmethod
    def _print_active_clients(server: TaillightHTTPServer) -> None:
        rows = server.get_client_snapshot()
        if not rows:
            print("No active clients yet. Open the page to register devices.")
            return
        print("CLIENT ID               IP ADDRESS        STATUS   PAGE     LAST SEEN")
        print("----------------------  ----------------  -------  -------  ---------")
        for row in rows:
            client_id = str(row["client_id"])[:22]
            ip = str(row["ip"])[:16]
            status = str(row["status"])[:7]
            page = str(row["page"])[:7]
            age_seconds = int(float(row["age_seconds"]))
            print(f"{client_id:<22}  {ip:<16}  {status:<7}  {page:<7}  {age_seconds:>4}s ago")

    def _run(self) -> None:
        while True:
            line = sys.stdin.readline()
            if line == "":
                # stdin closed/non-interactive stream ended.
                return
            cmd = line.strip().lower()
            if not cmd:
                continue
            if cmd in {"help", "?"}:
                print("Commands: active, clear, shutdown (stop safely), restart (safe restart), help")
                continue
            if cmd == "clear":
                self._clear_terminal_output()
                continue
            server = self._get_server()
            if cmd == "active":
                if server is None:
                    print("No active server instance is available for command handling.")
                    continue
                self._print_active_clients(server)
                continue
            if cmd not in {"shutdown", "restart"}:
                print(f"Unknown command: {cmd}. Use: active | clear | shutdown | restart | help")
                continue
            if server is None:
                print("No active server instance is available for command handling.")
                continue
            print(f"Command accepted: {cmd}")
            server.request_stop(restart=(cmd == "restart"))


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

    def _send_json(self, payload: dict[str, object], *, status: int = 200, clear_site_cache: bool = False) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        if clear_site_cache:
            self.send_header("Clear-Site-Data", '"cache"')
        self.end_headers()
        self.wfile.write(encoded)

    def _is_local_control_client(self) -> bool:
        host = self.client_address[0]
        return host in {"127.0.0.1", "::1", "localhost"}

    def _read_json_body(self) -> dict[str, object]:
        raw_len = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_len)
        except ValueError:
            return {}
        if length <= 0:
            return {}
        body = self.rfile.read(min(length, 8192))
        if not body:
            return {}
        try:
            parsed = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def _handle_control(self, *, restart: bool) -> None:
        action = "restart" if restart else "shutdown"
        if not self._is_local_control_client():
            self._send_json(
                {
                    "ok": False,
                    "error": "Control commands are only allowed from localhost.",
                    "action": action,
                },
                status=403,
            )
            return

        message = "Server restart requested. Cache cleared; restarting safely." if restart else "Server shutdown requested. Cache cleared; stopping safely."
        self._send_json({"ok": True, "action": action, "message": message}, status=202, clear_site_cache=True)
        self.wfile.flush()
        server = self.server
        if isinstance(server, TaillightHTTPServer):
            # Defer the stop trigger to avoid racing with response completion.
            threading.Timer(0.05, server.request_stop, kwargs={"restart": restart}).start()

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

    def do_POST(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == CONTROL_HEARTBEAT_PATH:
            payload = self._read_json_body()
            page_visible = payload.get("pageVisible")
            page = payload.get("page")
            server = self.server
            if isinstance(server, TaillightHTTPServer):
                server.note_client_heartbeat(
                    client_id=str(payload.get("deviceId", "")).strip() or None,
                    ip=self.client_address[0],
                    user_agent=self.headers.get("User-Agent", ""),
                    page_visible=page_visible if isinstance(page_visible, bool) else None,
                    page=str(page) if page is not None else "taillight",
                )
            self._send_json({"ok": True, "tracked": True})
            return
        if parsed.path == CONTROL_DISCONNECT_PATH:
            payload = self._read_json_body()
            server = self.server
            if isinstance(server, TaillightHTTPServer):
                server.note_client_disconnect(
                    client_id=str(payload.get("deviceId", "")).strip() or None,
                    ip=self.client_address[0],
                    user_agent=self.headers.get("User-Agent", ""),
                )
            self._send_json({"ok": True, "disconnected": True})
            return
        if parsed.path == CONTROL_SHUTDOWN_PATH:
            self._handle_control(restart=False)
            return
        if parsed.path == CONTROL_RESTART_PATH:
            self._handle_control(restart=True)
            return
        self._send_json({"ok": False, "error": "Unknown command endpoint."}, status=404)

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
    parser = argparse.ArgumentParser(description="Serve and control the taillight simulator over HTTP.")
    parser.add_argument(
        "command",
        nargs="?",
        choices=("serve", "shutdown", "restart"),
        default="serve",
        help="Server command: serve (default), shutdown, or restart.",
    )
    parser.add_argument(
        "--host",
        default=None,
        help="Host interface to bind (use 0.0.0.0 for LAN access).",
    )
    parser.add_argument("--port", type=int, default=8088, help="Port to listen on.")
    args = parser.parse_args()
    if args.host is None:
        args.host = "0.0.0.0" if args.command == "serve" else "127.0.0.1"
    return args


def get_lan_ip() -> str:
    # Determine the primary outbound interface IP to show a shareable LAN URL.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return str(sock.getsockname()[0])
    except OSError:
        return "127.0.0.1"


def _control_target_host(host: str) -> str:
    # 0.0.0.0 is a bind target, not a routable client destination.
    return "127.0.0.1" if host == "0.0.0.0" else host


def send_control_command(*, host: str, port: int, command: str) -> int:
    path = CONTROL_SHUTDOWN_PATH if command == "shutdown" else CONTROL_RESTART_PATH
    target_host = _control_target_host(host)
    url = f"http://{target_host}:{port}{path}"
    req = urlrequest.Request(url, data=b"", method="POST")
    try:
        with urlrequest.urlopen(req, timeout=5) as response:  # nosec B310 - local control endpoint
            payload_raw = response.read().decode("utf-8")
            payload = json.loads(payload_raw) if payload_raw else {}
    except urlerror.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"Control command failed ({exc.code}): {body}")
        return 1
    except OSError as exc:
        print(f"Unable to reach server at {url}: {exc}")
        return 1

    print(payload.get("message", f"{command} command accepted."))
    return 0


def run_server(*, host: str, port: int) -> int:
    handler = partial(TaillightRequestHandler)
    command_listener = TerminalCommandListener()
    command_listener.start()
    while True:
        server = TaillightHTTPServer((host, port), handler)
        command_listener.bind_server(server)
        server.daemon_threads = True
        if host == "0.0.0.0":
            lan_ip = get_lan_ip()
            startup_line = (
                "Application startup complete. Serving on all interfaces. "
                f"Open http://{lan_ip}:{port} from devices on your network"
            )
            print(startup_line)
        else:
            startup_line = f"Application startup complete. Serving http://{host}:{port}"
            print(startup_line)
        command_listener.set_startup_line(startup_line)

        interrupted = False
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            interrupted = True
            clear_runtime_cache()
            print("Shutting down...")
        finally:
            server.server_close()

        if interrupted or not server.restart_requested:
            return 0
        print("Restarting server now...")


def main() -> None:
    args = parse_args()
    if args.command == "serve":
        raise SystemExit(run_server(host=args.host, port=args.port))
    raise SystemExit(send_control_command(host=args.host, port=args.port, command=args.command))


if __name__ == "__main__":
    main()