import json
import os
import re
import signal
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765
NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")

vehicles = {}
vehicles_lock = threading.Lock()


class ConsoleHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 4096:
                return None
            return json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            return None

    @staticmethod
    def vehicle_status(name, process):
        code = process.poll()
        return {
            "name": name,
            "status": "running" if code is None else "exited",
            "exit_code": code,
        }

    def do_GET(self):
        if urlparse(self.path).path == "/api/vehicles":
            with vehicles_lock:
                result = [
                    self.vehicle_status(name, process)
                    for name, process in vehicles.items()
                ]
            self.send_json(200, {"vehicles": result})
            return

        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/vehicles":
            self.send_json(404, {"error": "Not found"})
            return

        body = self.read_json()
        name = body.get("name") if isinstance(body, dict) else None

        if not isinstance(name, str) or not NAME_PATTERN.fullmatch(name):
            self.send_json(
                400,
                {"error": "Name must start with a letter and contain only letters, digits, or underscores."},
            )
            return

        with vehicles_lock:
            existing = vehicles.get(name)
            if existing is not None and existing.poll() is None:
                self.send_json(409, {"error": f"Vehicle '{name}' is already running."})
                return

            try:
                process = subprocess.Popen(
                    [
                        "ros2",
                        "launch",
                        "farol2_motion_planning",
                        "distributed_planner.launch.py",
                        f"vehicle_name:={name}",
                    ],
                    start_new_session=True,
                )
            except OSError as error:
                self.send_json(500, {"error": f"Could not start ros2 launch: {error}"})
                return

            vehicles[name] = process

        self.send_json(202, self.vehicle_status(name, process))

    def do_DELETE(self):
        path = unquote(urlparse(self.path).path)
        prefix = "/api/vehicles/"
        if not path.startswith(prefix):
            self.send_json(404, {"error": "Not found"})
            return

        name = path[len(prefix):]
        with vehicles_lock:
            process = vehicles.get(name)
            if process is None:
                self.send_json(404, {"error": f"Vehicle '{name}' was not found."})
                return

            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGINT)
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=2)
                except ProcessLookupError:
                    pass

            result = self.vehicle_status(name, process)

        self.send_json(200, result)


if __name__ == "__main__":
    print(f"Serving console at http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), ConsoleHandler).serve_forever()