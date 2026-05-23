from __future__ import annotations

import json
import queue
import tempfile
import threading
import uuid
import zipfile
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
    ):
        def worker():
            try:
                zip_path = run_zip_action(task)
                with task.lock:
                    task.status = "success"
                    task.status_message = "zip build completed"
                    task.result_zip_path = str(zip_path or "")
                task.emit_status("success", "zip build completed")
            except Exception as error:
                is_aborted = task.abort_event.is_set()
                with task.lock:
                    task.status = "aborted" if is_aborted else "failed"
                    task.status_message = "zip build aborted" if is_aborted else "zip build failed"
                    task.error_text = str(error)
                task.emit_status(task.status, str(error))

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()

    def abort_task(self, task_id: str):
        task = self.get_task(task_id)
        if not task:
            return None
        task.abort_event.set()
        task.emit_log("abort requested")
        return task


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
