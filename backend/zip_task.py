from __future__ import annotations

import json
import multiprocessing
import queue
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


@dataclass
class ZipTask:
    task_id: str
    status: str = "running"
    status_message: str = ""
    event_queue: queue.Queue = field(default_factory=queue.Queue)
    abort_event: threading.Event = field(default_factory=threading.Event)
    result_zip_path: str = ""
    result_download_name: str = ""
    error_text: str = ""
    lock: threading.Lock = field(default_factory=threading.Lock)
    process: multiprocessing.Process | None = None
    process_abort_event: multiprocessing.Event | None = None

    def emit_log(self, message_text: str):
        self.event_queue.put(
            {
                "type": "log",
                "messageText": str(message_text),
            }
        )

    def emit_status(self, status: str, message_text: str):
        self.event_queue.put(
            {
                "type": "status",
                "status": str(status),
                "messageText": str(message_text),
            }
        )


class ZipTaskManager:
    def __init__(self):
        self._task_by_id: dict[str, ZipTask] = {}
        self._lock = threading.Lock()

    def create_task(self):
        task_id = str(uuid.uuid4())
        task = ZipTask(task_id=task_id)
        with self._lock:
            self._task_by_id[task_id] = task
        return task

    def get_task(self, task_id: str):
        with self._lock:
            return self._task_by_id.get(str(task_id or "").strip())

    def start_task(
        self,
        task: ZipTask,
        run_zip_action: Callable[[ZipTask], str],
        timeout_seconds: int = 60,
    ):
        process_context = multiprocessing.get_context("fork")
        process_event_queue = process_context.Queue()
        process_abort_event = process_context.Event()

        def process_worker():
            proxy = _ZipProcessTaskProxy(task.task_id, process_abort_event, process_event_queue)
            try:
                zip_path = run_zip_action(proxy)
                process_event_queue.put(
                    {
                        "type": "result",
                        "zipPath": str(zip_path or ""),
                        "downloadName": str(proxy.result_download_name or ""),
                    }
                )
            except Exception as error:
                process_event_queue.put(
                    {
                        "type": "error",
                        "errorText": str(error),
                        "isAborted": process_abort_event.is_set(),
                    }
                )

        def finish_task(status: str, status_message: str, error_text: str = "", zip_path: str = "", download_name: str = ""):
            with task.lock:
                if task.status in ("success", "failed", "aborted"):
                    return
                task.status = status
                task.status_message = status_message
                task.error_text = error_text
                task.result_zip_path = zip_path
                task.result_download_name = download_name
            task.emit_status(status, error_text or status_message)

        def monitor_worker():
            started_at = time.monotonic()
            timeout_value = max(1, int(timeout_seconds or 60))
            result_event = None
            try:
                while True:
                    try:
                        event_obj = process_event_queue.get(timeout=0.2)
                    except queue.Empty:
                        event_obj = None
                    if event_obj:
                        event_type = str(event_obj.get("type") or "")
                        if event_type in ("log", "status"):
                            task.event_queue.put(event_obj)
                        elif event_type in ("result", "error"):
                            result_event = event_obj
                    if result_event:
                        break
                    if task.abort_event.is_set():
                        process_abort_event.set()
                        if task.process and task.process.is_alive():
                            task.process.terminate()
                            task.process.join(timeout=1)
                            if task.process.is_alive():
                                task.process.kill()
                        finish_task("aborted", "zip build aborted", "zip process aborted")
                        return
                    if time.monotonic() - started_at > timeout_value:
                        task.abort_event.set()
                        process_abort_event.set()
                        if task.process and task.process.is_alive():
                            task.process.terminate()
                            task.process.join(timeout=1)
                            if task.process.is_alive():
                                task.process.kill()
                        finish_task("failed", "zip build timeout", f"zip process timeout after {timeout_value}s")
                        return
                    if task.process and not task.process.is_alive():
                        break

                if task.process:
                    task.process.join(timeout=1)
                if result_event and result_event.get("type") == "result":
                    finish_task(
                        "success",
                        "zip build completed",
                        "",
                        str(result_event.get("zipPath") or ""),
                        str(result_event.get("downloadName") or ""),
                    )
                    return
                if result_event and result_event.get("type") == "error":
                    is_aborted = result_event.get("isAborted") is True
                    finish_task(
                        "aborted" if is_aborted else "failed",
                        "zip build aborted" if is_aborted else "zip build failed",
                        str(result_event.get("errorText") or ""),
                    )
                    return
                finish_task("failed", "zip build failed", "zip process exited without result")
            finally:
                process_event_queue.close()

        process = process_context.Process(target=process_worker, daemon=True)
        task.process = process
        task.process_abort_event = process_abort_event
        process.start()
        thread = threading.Thread(target=monitor_worker, daemon=True)
        thread.start()

    def abort_task(self, task_id: str):
        task = self.get_task(task_id)
        if not task:
            return None
        task.abort_event.set()
        if task.process_abort_event:
            task.process_abort_event.set()
        if task.process and task.process.is_alive():
            task.process.terminate()
        task.emit_log("abort requested")
        return task


class _NoopLock:
    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc_value, _traceback):
        return False


class _ZipProcessTaskProxy:
    def __init__(self, task_id: str, abort_event, event_queue):
        self.task_id = task_id
        self.abort_event = abort_event
        self.event_queue = event_queue
        self.result_download_name = ""
        self.lock = _NoopLock()

    def emit_log(self, message_text: str):
        self.event_queue.put(
            {
                "type": "log",
                "messageText": str(message_text),
            }
        )

    def emit_status(self, status: str, message_text: str):
        self.event_queue.put(
            {
                "type": "status",
                "status": str(status),
                "messageText": str(message_text),
            }
        )


def create_zip_temp_path(base_name: str):
    safe_name = sanitize_file_name(base_name)
    temp_dir = tempfile.mkdtemp(prefix="file-access-smb-zip-")
    return str(Path(temp_dir) / f"{safe_name}.zip")


def sanitize_file_name(name: str):
    raw = str(name or "").strip()
    if not raw:
        return "download"
    # Keep this cross-platform: replace reserved filename characters.
    invalid_chars = '<>:"/\\|?*\0'
    cleaned = raw
    for item in invalid_chars:
        cleaned = cleaned.replace(item, "_")
    cleaned = cleaned.rstrip(". ").strip()
    return cleaned or "download"


def write_json_event(ws, event_obj: dict):
    ws.send(json.dumps(event_obj, ensure_ascii=False))


zip_task_manager = ZipTaskManager()
