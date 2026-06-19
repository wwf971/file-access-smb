from __future__ import annotations

import json
import os
import random
import string
import sys
import time
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any

from psycopg.rows import dict_row

_CURRENT_DIR = Path(__file__).resolve().parent
_DIR_BASE = Path(os.environ.get("DIR_BASE", str(_CURRENT_DIR.parent))).resolve()
_CONFIG_DIR = _DIR_BASE / "config"
if str(_CONFIG_DIR) not in sys.path:
    sys.path.insert(0, str(_CONFIG_DIR))

from config_loader import load_project_config
from db import run_in_transaction

TASK_STATUS_UNDERGOING = 1
TASK_STATUS_SUCCESS = 2
TASK_STATUS_FAIL = 3
TASK_STATUS_CANCEL = 4

TASK_TYPE_SMB_EXTERNAL_UPLOAD = 1
TASK_TYPE_SMB_EXTERNAL_ZIP = 2
TASK_TYPE_SMB_EXTERNAL_COPY = 3
TASK_TYPE_SMB_EXTERNAL_MOVE = 4

TASK_TYPE_NAME_BY_TYPE = {
    TASK_TYPE_SMB_EXTERNAL_UPLOAD: "smbExternalUpload",
    TASK_TYPE_SMB_EXTERNAL_ZIP: "smbExternalZip",
    TASK_TYPE_SMB_EXTERNAL_COPY: "smbExternalCopy",
    TASK_TYPE_SMB_EXTERNAL_MOVE: "smbExternalMove",
}

TASK_STATUS_DISPLAY_NAME_DEFAULT = {
    TASK_STATUS_UNDERGOING: "running",
    TASK_STATUS_SUCCESS: "success",
    TASK_STATUS_FAIL: "fail",
    TASK_STATUS_CANCEL: "cancel",
}

BASE36_ALPHABET = string.digits + string.ascii_lowercase


def _to_text(value: Any):
    return str(value or "").strip()


def get_task_status_display_name(task_status: int):
    task_status_int = int(task_status or 0)
    try:
        project_config = load_project_config(_DIR_BASE)
    except Exception:
        project_config = {}
    display_name_config = project_config.get("task_status_display_name")
    if isinstance(display_name_config, dict):
        configured_value = display_name_config.get(task_status_int)
        if configured_value is None:
            configured_value = display_name_config.get(str(task_status_int))
        configured_text = _to_text(configured_value)
        if configured_text:
            return configured_text
    return TASK_STATUS_DISPLAY_NAME_DEFAULT.get(task_status_int, "unknown")


def create_task_id_int():
    now_ms = int(time.time() * 1000)
    offset = random.randint(0, 65535)
    return (now_ms << 16) | offset


def task_id_to_text(task_id: int):
    value = int(task_id or 0)
    if value <= 0:
        return ""
    chars = []
    while value > 0:
        value, remainder = divmod(value, 36)
        chars.append(BASE36_ALPHABET[remainder])
    return "".join(reversed(chars))


def task_id_from_text(task_id_text: Any):
    text = _to_text(task_id_text).lower()
    if not text:
        raise RuntimeError("taskId is required")
    if text.isdigit():
        return int(text)
    value = 0
    for char in text:
        if char not in BASE36_ALPHABET:
            raise RuntimeError("taskId is invalid")
        value = value * 36 + BASE36_ALPHABET.index(char)
    return value


def get_timezone_offset_minutes():
    now = datetime.now().astimezone()
    offset = now.utcoffset()
    if offset is None:
        return 0
    return int(offset.total_seconds() // 60)


def format_time_for_display(dt: datetime | None = None):
    current = dt or datetime.now().astimezone()
    offset = current.strftime("%z")
    offset_hour = offset[:3] if offset else "+00"
    return current.strftime("%Y%m%d_%H%M%S") + f"{current.microsecond // 10000:02d}{offset_hour}"


def make_progress_item(task_status: int, task_status_text: str):
    return {
        "taskStatus": int(task_status),
        "taskStatusMessage": _to_text(task_status_text),
        "updateAt": format_time_for_display(),
        "updateAtTimezone": get_timezone_offset_minutes(),
    }


def build_task_info(
    task_type: int,
    task_status: int,
    task_status_text: str,
    user_id: str,
    operation_info: dict[str, Any],
):
    task_status_display_name = get_task_status_display_name(task_status)
    return {
        "schemaVersion": 1,
        "taskBaseInfo": {
            "taskType": int(task_type),
            "taskTypeName": TASK_TYPE_NAME_BY_TYPE.get(int(task_type), "unknown"),
            "taskStatus": int(task_status),
            "taskStatusText": task_status_display_name,
        },
        "userInfo": {
            "userId": _to_text(user_id),
        },
        "operationInfo": operation_info or {},
        "taskProgress": {
            "itemCountTotal": len((operation_info or {}).get("itemList") or []),
            "itemCountDone": 0,
            "byteCountTotal": 0,
            "byteCountDone": 0,
            "progressList": [make_progress_item(task_status, task_status_text)],
        },
        "resultInfo": None,
        "exitInfo": None,
    }


def normalize_task_row(row: dict[str, Any]):
    task_id = int(row["taskid"])
    task_info = row["taskinfo"] if isinstance(row["taskinfo"], dict) else {}
    return {
        "taskId": task_id_to_text(task_id),
        "taskType": int(row["tasktype"] or 0),
        "taskStatus": int(row["taskstatus"] or 0),
        "taskStatusText": str(row["taskstatustext"] or ""),
        "taskInfo": task_info,
        "userId": str(row["userid"] or ""),
        "createdAt": str(row["createdat"] or ""),
        "createdAtTimeZone": int(row["createdattimezone"] or 0),
        "updatedAt": str(row["updatedat"] or ""),
        "updatedAtTimeZone": int(row["updatedattimezone"] or 0),
        "startedAt": str(row["startedat"] or ""),
        "startedAtTimeZone": int(row["startedattimezone"] or 0) if row["startedattimezone"] is not None else None,
        "finishedAt": str(row["finishedat"] or ""),
        "finishedAtTimeZone": int(row["finishedattimezone"] or 0) if row["finishedattimezone"] is not None else None,
    }


def insert_task(task_type: int, user_id: str, operation_info: dict[str, Any], task_status_text: str):
    task_id = create_task_id_int()
    timezone_offset = get_timezone_offset_minutes()
    task_info = build_task_info(task_type, TASK_STATUS_UNDERGOING, task_status_text, user_id, operation_info)
    task_status_display_name = get_task_status_display_name(TASK_STATUS_UNDERGOING)

    def action(db):
        with closing(db.cursor(row_factory=dict_row)) as cursor:
            cursor.execute(
                """
                insert into task(
                    taskId,
                    userId,
                    taskType,
                    taskStatus,
                    taskStatusText,
                    taskInfo,
                    createdAtTimeZone,
                    updatedAtTimeZone,
                    startedAt,
                    startedAtTimeZone
                )
                values (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, now(), %s)
                returning *
                """,
                (
                    task_id,
                    _to_text(user_id),
                    int(task_type),
                    TASK_STATUS_UNDERGOING,
                    task_status_display_name,
                    json.dumps(task_info),
                    timezone_offset,
                    timezone_offset,
                    timezone_offset,
                ),
            )
            return normalize_task_row(cursor.fetchone())

    return run_in_transaction(action)


def list_tasks(user_id: str, limit: int = 50):
    normalized_limit = max(1, min(200, int(limit or 50)))

    def action(db):
        with closing(db.cursor(row_factory=dict_row)) as cursor:
            cursor.execute(
                """
                select *
                from task
                where userId = %s
                order by createdAt desc
                limit %s
                """,
                (_to_text(user_id), normalized_limit),
            )
            return [normalize_task_row(row) for row in cursor.fetchall() or []]

    return run_in_transaction(action)


def get_task(task_id_text: Any, user_id: str | None = None):
    task_id = task_id_from_text(task_id_text)

    def action(db):
        with closing(db.cursor(row_factory=dict_row)) as cursor:
            if user_id is None:
                cursor.execute("select * from task where taskId = %s", (task_id,))
            else:
                cursor.execute("select * from task where taskId = %s and userId = %s", (task_id, _to_text(user_id)))
            row = cursor.fetchone()
            if row is None:
                return None
            return normalize_task_row(row)

    return run_in_transaction(action)


def is_task_cancel_requested(task_id_text: Any):
    task = get_task(task_id_text)
    return task is None or int(task.get("taskStatus") or 0) == TASK_STATUS_CANCEL


def update_task_progress(
    task_id_text: Any,
    task_status: int,
    task_status_text: str,
    progress_patch: dict[str, Any] | None = None,
    operation_info: dict[str, Any] | None = None,
):
    task_id = task_id_from_text(task_id_text)
    timezone_offset = get_timezone_offset_minutes()
    progress_item = make_progress_item(task_status, task_status_text)
    task_status_display_name = get_task_status_display_name(task_status)

    def action(db):
        with closing(db.cursor(row_factory=dict_row)) as cursor:
            cursor.execute("select * from task where taskId = %s for update", (task_id,))
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError(f"task not found: {task_id_to_text(task_id)}")
            task_info = row["taskinfo"] if isinstance(row["taskinfo"], dict) else {}
            task_base_info = task_info.get("taskBaseInfo") if isinstance(task_info.get("taskBaseInfo"), dict) else {}
            task_base_info["taskStatus"] = int(task_status)
            task_base_info["taskStatusText"] = task_status_display_name
            task_info["taskBaseInfo"] = task_base_info
            if operation_info is not None:
                task_info["operationInfo"] = operation_info
            task_progress = task_info.get("taskProgress") if isinstance(task_info.get("taskProgress"), dict) else {}
            if progress_patch:
                task_progress.update(progress_patch)
            progress_list = task_progress.get("progressList") if isinstance(task_progress.get("progressList"), list) else []
            progress_list.append(progress_item)
            task_progress["progressList"] = progress_list
            task_info["taskProgress"] = task_progress
            is_terminal = int(task_status) in (TASK_STATUS_SUCCESS, TASK_STATUS_FAIL, TASK_STATUS_CANCEL)
            if is_terminal and int(task_status) in (TASK_STATUS_FAIL, TASK_STATUS_CANCEL):
                task_info["exitInfo"] = {
                    "exitType": int(task_status),
                    "exitMessage": _to_text(task_status_text),
                    "exitAt": progress_item["updateAt"],
                    "exitAtTimezone": timezone_offset,
                }
            cursor.execute(
                """
                update task
                set taskStatus = %s,
                    taskStatusText = %s,
                    taskInfo = %s::jsonb,
                    updatedAt = now(),
                    updatedAtTimeZone = %s,
                    finishedAt = case when %s then now() else finishedAt end,
                    finishedAtTimeZone = case when %s then %s else finishedAtTimeZone end
                where taskId = %s
                returning *
                """,
                (
                    int(task_status),
                    task_status_display_name,
                    json.dumps(task_info),
                    timezone_offset,
                    is_terminal,
                    is_terminal,
                    timezone_offset,
                    task_id,
                ),
            )
            return normalize_task_row(cursor.fetchone())

    return run_in_transaction(action)


def set_task_result(task_id_text: Any, task_status_text: str, result_info: dict[str, Any], progress_patch: dict[str, Any] | None = None):
    task_id = task_id_from_text(task_id_text)
    timezone_offset = get_timezone_offset_minutes()
    progress_item = make_progress_item(TASK_STATUS_SUCCESS, task_status_text)
    task_status_display_name = get_task_status_display_name(TASK_STATUS_SUCCESS)

    def action(db):
        with closing(db.cursor(row_factory=dict_row)) as cursor:
            cursor.execute("select * from task where taskId = %s for update", (task_id,))
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError(f"task not found: {task_id_to_text(task_id)}")
            task_info = row["taskinfo"] if isinstance(row["taskinfo"], dict) else {}
            task_base_info = task_info.get("taskBaseInfo") if isinstance(task_info.get("taskBaseInfo"), dict) else {}
            task_base_info["taskStatus"] = TASK_STATUS_SUCCESS
            task_base_info["taskStatusText"] = task_status_display_name
            task_info["taskBaseInfo"] = task_base_info
            task_progress = task_info.get("taskProgress") if isinstance(task_info.get("taskProgress"), dict) else {}
            if progress_patch:
                task_progress.update(progress_patch)
            progress_list = task_progress.get("progressList") if isinstance(task_progress.get("progressList"), list) else []
            progress_list.append(progress_item)
            task_progress["progressList"] = progress_list
            task_info["taskProgress"] = task_progress
            task_info["resultInfo"] = result_info or {}
            cursor.execute(
                """
                update task
                set taskStatus = %s,
                    taskStatusText = %s,
                    taskInfo = %s::jsonb,
                    updatedAt = now(),
                    updatedAtTimeZone = %s,
                    finishedAt = now(),
                    finishedAtTimeZone = %s
                where taskId = %s
                returning *
                """,
                (
                    TASK_STATUS_SUCCESS,
                    task_status_display_name,
                    json.dumps(task_info),
                    timezone_offset,
                    timezone_offset,
                    task_id,
                ),
            )
            return normalize_task_row(cursor.fetchone())

    return run_in_transaction(action)


def cancel_task(task_id_text: Any, user_id: str):
    task = get_task(task_id_text, user_id)
    if task is None:
        raise RuntimeError(f"task not found: {_to_text(task_id_text)}")
    if int(task.get("taskStatus") or 0) != TASK_STATUS_UNDERGOING:
        return task
    return update_task_progress(task_id_text, TASK_STATUS_CANCEL, "cancel requested")


def delete_task(task_id_text: Any, user_id: str):
    task_id = task_id_from_text(task_id_text)

    def action(db):
        with closing(db.cursor(row_factory=dict_row)) as cursor:
            cursor.execute("select * from task where taskId = %s and userId = %s for update", (task_id, _to_text(user_id)))
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError(f"task not found: {task_id_to_text(task_id)}")
            if int(row["taskstatus"] or 0) == TASK_STATUS_UNDERGOING:
                raise RuntimeError("undergoing task cannot be deleted")
            task = normalize_task_row(row)
            cursor.execute("delete from task where taskId = %s", (task_id,))
            return task

    return run_in_transaction(action)
