from __future__ import annotations

import os
import queue
import re
import sys
import threading
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import pyzipper
from flask import request, send_file

_CURRENT_DIR = Path(__file__).resolve().parent
_DIR_BASE = Path(os.environ.get("DIR_BASE", str(_CURRENT_DIR.parent))).resolve()
_CONFIG_DIR = _DIR_BASE / "config"
if str(_CONFIG_DIR) not in sys.path:
    sys.path.insert(0, str(_CONFIG_DIR))

from config_loader import load_project_config, load_yaml_config_file
from db import delete_db_file_access_point, get_dir_base, list_db_file_access_points, upsert_db_file_access_point
from login import get_request_permission, get_request_user, get_request_zip_encryption_key, get_request_zip_timeout_seconds, has_request_permission
from smb_service import smb_connection_manager
from task_service import (
    TASK_STATUS_FAIL,
    TASK_STATUS_SUCCESS,
    TASK_STATUS_UNDERGOING,
    TASK_TYPE_SMB_EXTERNAL_COPY,
    TASK_TYPE_SMB_EXTERNAL_MOVE,
    cancel_task,
    delete_task,
    get_task,
    insert_task,
    list_tasks,
    set_task_result,
    update_task_progress,
)
from zip_task import create_zip_temp_path, sanitize_file_name, write_json_event, zip_task_manager

TEXT_EDITOR_MAX_SIZE_BYTES = 2 * 1024 * 1024
TASK_ASSET_DIR = _DIR_BASE / ".runtime" / "task_asset"


def _to_text(value: Any):
    return str(value or "").strip()


def _normalize_metadata(raw_metadata: dict[str, Any]):
    return {
        "host": _to_text(raw_metadata.get("host")),
        "username": _to_text(raw_metadata.get("username")),
        "password": str(raw_metadata.get("password") or ""),
        "share": _to_text(raw_metadata.get("share")),
        "path": _normalize_path(raw_metadata.get("path")),
    }


def _normalize_path(path_value: Any):
    path_text = _to_text(path_value) or "/"
    normalized = path_text.replace("\\", "/")
    while "//" in normalized:
        normalized = normalized.replace("//", "/")
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    normalized = normalized.rstrip("/")
    return normalized or "/"


def _join_path(base_path: str, name: str):
    normalized_base = _normalize_path(base_path)
    normalized_name = str(name or "").replace("\\", "/").strip("/")
    if not normalized_name:
        return normalized_base
    if normalized_base == "/":
        return f"/{normalized_name}"
    return f"{normalized_base}/{normalized_name}"


def _normalize_new_file_suffix(suffix_value: Any):
    suffix = _to_text(suffix_value)
    if not suffix:
        raise RuntimeError("suffix is required")
    if "/" in suffix or "\\" in suffix:
        raise RuntimeError("suffix cannot include path separator")
    if not suffix.startswith("."):
        suffix = f".{suffix}"
    if suffix == ".":
        raise RuntimeError("suffix cannot be only dot")
    return suffix


def _build_zip_archive(
    task,
    file_access_point_id: str,
    metadata: dict[str, Any],
    target_path: str,
    zip_encryption_key: str = "",
    target_is_directory: bool = True,
):
    target_name_raw = target_path.strip("/").split("/")[-1] or "root"
    target_name = sanitize_file_name(target_name_raw)
    zip_path = create_zip_temp_path(target_name)

    def ensure_not_aborted():
        if task.abort_event.is_set():
            raise RuntimeError("zip process aborted")

    def write_folder(folder_path: str, zip_file, rel_prefix: str):
        ensure_not_aborted()
        task.emit_log(f"scan {folder_path}")
        item_list = smb_connection_manager.list_dir(file_access_point_id, metadata, folder_path)
        for item in item_list:
            ensure_not_aborted()
            item_name = str(item.get("name") or "")
            is_directory = item.get("isDirectory") is True
            child_path = _join_path(folder_path, item_name)
            child_rel = f"{rel_prefix}/{item_name}" if rel_prefix else item_name
            if is_directory:
                write_folder(child_path, zip_file, child_rel)
                continue
            task.emit_log(f"pack {child_path}")
            file_bytes = smb_connection_manager.read_file_bytes(file_access_point_id, metadata, child_path)
            zip_file.writestr(child_rel, file_bytes)

    def write_file(file_path: str, zip_file):
        ensure_not_aborted()
        file_name = file_path.strip("/").split("/")[-1]
        if not file_name:
            raise RuntimeError("path should point to a file")
        task.emit_log(f"pack {file_path}")
        file_bytes = smb_connection_manager.read_file_bytes(file_access_point_id, metadata, file_path)
        zip_file.writestr(file_name, file_bytes)

    def write_target(zip_file):
        if target_is_directory:
            write_folder(target_path, zip_file, target_name)
            return
        write_file(target_path, zip_file)

    if zip_encryption_key:
        with pyzipper.AESZipFile(
            zip_path,
            mode="w",
            compression=pyzipper.ZIP_DEFLATED,
            encryption=pyzipper.WZ_AES,
        ) as zip_file:
            zip_file.setpassword(str(zip_encryption_key).encode("utf-8"))
            write_target(zip_file)
    else:
        with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
            write_target(zip_file)
    task.emit_log(f"zip ready {zip_path}")
    with task.lock:
        task.result_download_name = f"{target_name}.zip"
    return zip_path


def _validate_metadata(metadata: dict[str, Any]):
    error_text_list = []
    if not metadata.get("host"):
        error_text_list.append("host is required")
    if not metadata.get("username"):
        error_text_list.append("username is required")
    if metadata.get("password") is None:
        error_text_list.append("password is required")
    if not metadata.get("share"):
        error_text_list.append("share is required")
    return {
        "isMetadataValid": len(error_text_list) == 0,
        "validationErrorTextList": error_text_list,
    }


def _load_config_file_access_points():
    project_config = load_project_config(get_dir_base())
    raw_items = project_config.get("file_access_point_smb_external") or project_config.get("file_access_points") or {}
    item_list = []
    for key in raw_items:
        raw_item = raw_items.get(key)
        if not isinstance(raw_item, dict):
            continue
        metadata = _normalize_metadata(raw_item)
        validate_result = _validate_metadata(metadata)
        item_list.append(
            {
                "fileAccessPointId": f"config:{key}",
                "name": str(key),
                "metadata": metadata,
                "sourceType": "config",
                "isDeletable": False,
                **validate_result,
            }
        )
    return item_list


def _load_all_file_access_points(is_include_permission: bool = True):
    config_items = _load_config_file_access_points()
    db_items = []
    database_error_text = ""
    try:
        db_items = list_db_file_access_points()
    except Exception as error:
        database_error_text = str(error)
    normalized_db_items = []
    for item in db_items:
        metadata = _normalize_metadata(item.get("metadata") if isinstance(item.get("metadata"), dict) else {})
        validate_result = _validate_metadata(metadata)
        normalized_db_items.append(
            {
                "fileAccessPointId": str(item.get("fileAccessPointId") or ""),
                "name": str(item.get("name") or ""),
                "metadata": metadata,
                "sourceType": "database",
                "isDeletable": True,
                **validate_result,
            }
        )
    merged_list = [*config_items, *normalized_db_items]
    for item in merged_list:
        state = smb_connection_manager.get_state(item["fileAccessPointId"])
        item["connection"] = {
            "isConnected": state.is_connected,
            "lastCheckUnixMs": state.last_check_unix_ms,
            "lastErrorText": state.last_error_text,
        }
        if is_include_permission:
            item["permission"] = get_request_permission()
    return merged_list, database_error_text


def _decode_id_variants(raw_id: str):
    normalized = str(raw_id or "").strip()
    if not normalized:
        return set()
    once_decoded = unquote(normalized)
    twice_decoded = unquote(once_decoded)
    variant_set = {normalized, once_decoded, twice_decoded}
    if once_decoded.startswith("config:"):
        variant_set.add(once_decoded[len("config:"):])
    if twice_decoded.startswith("config:"):
        variant_set.add(twice_decoded[len("config:"):])
    return {item for item in variant_set if item}


def _find_file_access_point_by_id(file_access_point_id: str):
    target_variants = _decode_id_variants(file_access_point_id)
    if not target_variants:
        return None
    merged_list, _database_error_text = _load_all_file_access_points(is_include_permission=False)
    for item in merged_list:
        item_id = str(item.get("fileAccessPointId") or "").strip()
        if not item_id:
            continue
        if item_id in target_variants:
            return item
        if item_id.startswith("config:") and item_id[len("config:"):] in target_variants:
            return item
    return None


def _find_file_access_point_by_name(file_access_point_name: str):
    normalized_name = str(file_access_point_name or "").strip()
    if not normalized_name:
        return None
    merged_list, _database_error_text = _load_all_file_access_points(is_include_permission=False)
    for item in merged_list:
        if str(item.get("name") or "") == normalized_name:
            return item
    return None


TARGET_FOLDER_FAP_RE = re.compile(r"^\[fap-smb-external:(.*)\(([^()]+)\)\](/.*)?$")


def _parse_task_target_folder(raw_target_folder: Any, default_file_access_point: dict[str, Any] | None):
    target_text = _to_text(raw_target_folder) or "/"
    match = TARGET_FOLDER_FAP_RE.match(target_text)
    if not match:
        return {
            "fileAccessPoint": default_file_access_point,
            "folderPath": _normalize_path(target_text),
            "targetFolderPath": target_text,
        }
    file_access_point_id = _to_text(match.group(2))
    file_access_point = _find_file_access_point_by_id(file_access_point_id)
    if file_access_point is None:
        raise RuntimeError(f"smb/external file access point not found: {file_access_point_id}")
    return {
        "fileAccessPoint": file_access_point,
        "folderPath": _normalize_path(match.group(3) or "/"),
        "targetFolderPath": target_text,
    }


def _get_folder_path_from_file_path(path_value: Any):
    normalized_path = _normalize_path(path_value)
    if normalized_path == "/":
        return "/"
    part_list = [part for part in normalized_path.split("/") if part]
    part_list.pop()
    return f"/{'/'.join(part_list)}" if part_list else "/"


def _get_request_user_id():
    user = get_request_user()
    return _to_text(user.get("username") if user else "")


def _normalize_task_item_list(raw_item_list: Any):
    if not isinstance(raw_item_list, list):
        raise RuntimeError("operationInfo.itemList should be a list")
    item_list = []
    for raw_item in raw_item_list:
        if not isinstance(raw_item, dict):
            continue
        file_access_point_source = raw_item.get("fileAccessPointSource") if isinstance(raw_item.get("fileAccessPointSource"), dict) else {}
        file_access_point_target = raw_item.get("fileAccessPointTarget") if isinstance(raw_item.get("fileAccessPointTarget"), dict) else {}
        path_source = _normalize_path(raw_item.get("pathSource"))
        path_target = _normalize_path(raw_item.get("pathTarget"))
        name = _to_text(raw_item.get("name")) or path_source.strip("/").split("/")[-1]
        item_list.append(
            {
                "name": name,
                "pathSource": path_source,
                "pathTarget": path_target,
                "fileAccessPointSource": {
                    "fileAccessPointType": "smb/external",
                    "fileAccessPointId": _to_text(file_access_point_source.get("fileAccessPointId")),
                    "fileAccessPointName": _to_text(file_access_point_source.get("fileAccessPointName")),
                },
                "fileAccessPointTarget": {
                    "fileAccessPointType": "smb/external",
                    "fileAccessPointId": _to_text(file_access_point_target.get("fileAccessPointId")),
                    "fileAccessPointName": _to_text(file_access_point_target.get("fileAccessPointName")),
                },
                "isDirectory": raw_item.get("isDirectory") is True,
                "sizeBytes": int(raw_item.get("sizeBytes") or 0),
                "taskStatus": TASK_STATUS_UNDERGOING,
                "taskStatusText": "waiting",
            }
        )
    if not item_list:
        raise RuntimeError("operationInfo.itemList is required")
    return item_list


def _normalize_copy_move_operation_info(raw_operation_info: Any):
    operation_info = raw_operation_info if isinstance(raw_operation_info, dict) else {}
    raw_item_list = operation_info.get("itemList")
    item_list = _normalize_task_item_list(raw_item_list)
    first_item = item_list[0]
    default_target_fap = _get_task_item_fap(first_item, "fileAccessPointTarget") or _get_task_item_fap(first_item, "fileAccessPointSource")
    target_folder_path_raw = operation_info.get("targetFolderPath")
    if not _to_text(target_folder_path_raw):
        target_folder_path_raw = _get_folder_path_from_file_path(first_item.get("pathTarget"))
    target_info = _parse_task_target_folder(target_folder_path_raw, default_target_fap)
    target_fap = target_info["fileAccessPoint"]
    if target_fap is None:
        raise RuntimeError("target file access point not found")
    target_folder_path_resolved = target_info["folderPath"]
    normalized_target_fap_info = {
        "fileAccessPointType": "smb/external",
        "fileAccessPointId": _to_text(target_fap.get("fileAccessPointId")),
        "fileAccessPointName": _to_text(target_fap.get("name")),
    }
    for item_info in item_list:
        item_name = _to_text(item_info.get("name"))
        item_info["pathTarget"] = _join_path(target_folder_path_resolved, item_name)
        item_info["fileAccessPointTarget"] = dict(normalized_target_fap_info)
    return {
        "targetFolderPath": target_info["targetFolderPath"],
        "targetFolderPathResolved": target_folder_path_resolved,
        "fileAccessPointTarget": normalized_target_fap_info,
        "itemList": item_list,
        "isOverwriteAllowed": operation_info.get("isOverwriteAllowed") is True,
        "isEnsureTargetFolder": operation_info.get("isEnsureTargetFolder") is not False,
    }


def _get_task_item_fap(item_info: dict[str, Any], key: str):
    fap_info = item_info.get(key) if isinstance(item_info.get(key), dict) else {}
    file_access_point_id = _to_text(fap_info.get("fileAccessPointId"))
    file_access_point_name = _to_text(fap_info.get("fileAccessPointName"))
    if file_access_point_id:
        return _find_file_access_point_by_id(file_access_point_id)
    if file_access_point_name:
        return _find_file_access_point_by_name(file_access_point_name)
    return None


def _get_task_asset_by_id(task: dict[str, Any], asset_id: str):
    task_info = task.get("taskInfo") if isinstance(task.get("taskInfo"), dict) else {}
    asset_info = task_info.get("assetInfo") if isinstance(task_info.get("assetInfo"), dict) else {}
    asset_by_id = asset_info.get("assetById") if isinstance(asset_info.get("assetById"), dict) else {}
    return asset_by_id.get(str(asset_id))


def _delete_task_assets(task: dict[str, Any]):
    task_info = task.get("taskInfo") if isinstance(task.get("taskInfo"), dict) else {}
    asset_info = task_info.get("assetInfo") if isinstance(task_info.get("assetInfo"), dict) else {}
    asset_by_id = asset_info.get("assetById") if isinstance(asset_info.get("assetById"), dict) else {}
    for asset in asset_by_id.values():
        if not isinstance(asset, dict):
            continue
        file_name_asset = _to_text(asset.get("fileNameAsset"))
        if not file_name_asset or "/" in file_name_asset or "\\" in file_name_asset:
            continue
        try:
            (TASK_ASSET_DIR / file_name_asset).unlink(missing_ok=True)
        except OSError:
            pass


def _run_smb_external_copy_move_task(task_id: str, task_type: int):
    task = get_task(task_id)
    if not task:
        return
    task_info = task.get("taskInfo") if isinstance(task.get("taskInfo"), dict) else {}
    operation_info = task_info.get("operationInfo") if isinstance(task_info.get("operationInfo"), dict) else {}
    item_list = operation_info.get("itemList") if isinstance(operation_info.get("itemList"), list) else []
    target_folder_path = _normalize_path(operation_info.get("targetFolderPathResolved") or operation_info.get("targetFolderPath") or "/")
    is_ensure_target_folder = operation_info.get("isEnsureTargetFolder") is not False
    item_count_done = 0
    item_count_fail = 0
    task_action_text = "copy" if task_type == TASK_TYPE_SMB_EXTERNAL_COPY else "move"
    try:
        for index, item_info in enumerate(item_list):
            current_task = get_task(task_id)
            if int(current_task.get("taskStatus") if current_task else 0) != TASK_STATUS_UNDERGOING:
                return
            item_info["taskStatus"] = TASK_STATUS_UNDERGOING
            item_info["taskStatusText"] = f"{task_action_text} running"
            update_task_progress(
                task_id,
                TASK_STATUS_UNDERGOING,
                f"{task_action_text} item {index + 1}/{len(item_list)}",
                {
                    "itemCountTotal": len(item_list),
                    "itemCountDone": item_count_done,
                },
                operation_info,
            )
            try:
                fap_source = _get_task_item_fap(item_info, "fileAccessPointSource")
                fap_target = _get_task_item_fap(item_info, "fileAccessPointTarget")
                if not fap_source or not fap_target:
                    raise RuntimeError("source or target file access point not found")
                if not fap_source.get("isMetadataValid"):
                    raise RuntimeError("source file access point metadata is invalid")
                if not fap_target.get("isMetadataValid"):
                    raise RuntimeError("target file access point metadata is invalid")
                target_file_access_point_id = str(fap_target["fileAccessPointId"])
                if is_ensure_target_folder:
                    smb_connection_manager.ensure_dir(target_file_access_point_id, fap_target["metadata"], target_folder_path)
                elif not smb_connection_manager.path_exists(target_file_access_point_id, fap_target["metadata"], target_folder_path):
                    raise RuntimeError(f"target folder does not exist: {target_folder_path}")
                path_source = _normalize_path(item_info.get("pathSource"))
                path_target = _normalize_path(item_info.get("pathTarget"))
                is_same_file_access_point = fap_source.get("fileAccessPointId") == fap_target.get("fileAccessPointId")
                if task_type == TASK_TYPE_SMB_EXTERNAL_COPY and is_same_file_access_point:
                    smb_connection_manager.copy_path(
                        str(fap_source["fileAccessPointId"]),
                        fap_source["metadata"],
                        path_source,
                        path_target,
                    )
                elif task_type == TASK_TYPE_SMB_EXTERNAL_COPY:
                    smb_connection_manager.copy_path_between(
                        str(fap_source["fileAccessPointId"]),
                        fap_source["metadata"],
                        target_file_access_point_id,
                        fap_target["metadata"],
                        path_source,
                        path_target,
                    )
                elif is_same_file_access_point:
                    smb_connection_manager.move_path(
                        str(fap_source["fileAccessPointId"]),
                        fap_source["metadata"],
                        path_source,
                        path_target,
                    )
                else:
                    smb_connection_manager.copy_path_between(
                        str(fap_source["fileAccessPointId"]),
                        fap_source["metadata"],
                        target_file_access_point_id,
                        fap_target["metadata"],
                        path_source,
                        path_target,
                    )
                    smb_connection_manager.remove_path(str(fap_source["fileAccessPointId"]), fap_source["metadata"], path_source)
                item_count_done += 1
                item_info["taskStatus"] = TASK_STATUS_SUCCESS
                item_info["taskStatusText"] = "success"
            except Exception as item_error:
                item_count_done += 1
                item_count_fail += 1
                item_info["taskStatus"] = TASK_STATUS_FAIL
                item_info["taskStatusText"] = str(item_error)
            update_task_progress(
                task_id,
                TASK_STATUS_UNDERGOING,
                f"{task_action_text} item {item_count_done}/{len(item_list)}",
                {
                    "itemCountTotal": len(item_list),
                    "itemCountDone": item_count_done,
                },
                operation_info,
            )
        if item_count_fail:
            update_task_progress(
                task_id,
                TASK_STATUS_FAIL,
                f"{task_action_text} failed: {item_count_fail}/{len(item_list)} item(s)",
                {
                    "itemCountTotal": len(item_list),
                    "itemCountDone": item_count_done,
                },
                operation_info,
            )
            return
        set_task_result(
            task_id,
            f"{task_action_text} success: {item_count_done}/{len(item_list)} item(s)",
            {
                "itemCountDone": item_count_done,
                "itemCountFail": item_count_fail,
            },
            {
                "itemCountTotal": len(item_list),
                "itemCountDone": item_count_done,
            },
        )
    except Exception as error:
        update_task_progress(task_id, TASK_STATUS_FAIL, str(error), operation_info=operation_info)


def _submit_smb_external_copy_move_task(task_type: int, user_id: str, raw_operation_info: Any):
    operation_info = _normalize_copy_move_operation_info(raw_operation_info)
    task_action_text = "copy" if task_type == TASK_TYPE_SMB_EXTERNAL_COPY else "move"
    task = insert_task(task_type, user_id, operation_info, f"{task_action_text} submitted")
    thread = threading.Thread(
        target=_run_smb_external_copy_move_task,
        args=(task["taskId"], task_type),
        daemon=True,
    )
    thread.start()
    return task


def register_fap_smb_external_routes(app, sock, make_json_response, validate_auth_token):
    @app.get("/fap-smb-external/get-by-id")
    @app.post("/fap-smb-external/get-by-id")
    def file_access_point_get_by_id():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId") or request.args.get("fileAccessPointId"))
        if not file_access_point_id:
            return make_json_response(-1, message="fileAccessPointId is required"), 400
        item = _find_file_access_point_by_id(file_access_point_id)
        if item is None:
            return make_json_response(-1, message=f"smb/external file access point not found: {file_access_point_id}"), 404
        return make_json_response(0, data={"item": item})

    @app.get("/fap-smb-external/get-by-name")
    @app.post("/fap-smb-external/get-by-name")
    def file_access_point_get_by_name():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_name = _to_text(body.get("fileAccessPointName") or request.args.get("fileAccessPointName"))
        if not file_access_point_name:
            return make_json_response(-1, message="fileAccessPointName is required"), 400
        item = _find_file_access_point_by_name(file_access_point_name)
        if item is None:
            return make_json_response(-1, message=f"smb/external file access point not found by name: {file_access_point_name}"), 404
        return make_json_response(0, data={"item": item})

    @app.get("/fap-smb-external/list")
    def file_access_point_list():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        item_list, database_error_text = _load_all_file_access_points()
        return make_json_response(
            0,
            data={
                "items": item_list,
                "count": len(item_list),
                "databaseErrorText": database_error_text,
            },
        )

    @app.post("/fap-smb-external/task/submit")
    def fap_smb_external_task_submit():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        task_type = int(body.get("taskType") or 0)
        if task_type not in (TASK_TYPE_SMB_EXTERNAL_COPY, TASK_TYPE_SMB_EXTERNAL_MOVE):
            return make_json_response(-1, message=f"unsupported taskType: {task_type}"), 400
        try:
            user_id = _get_request_user_id()
            task = _submit_smb_external_copy_move_task(task_type, user_id, body.get("operationInfo"))
            return make_json_response(0, data={"task": task, "taskId": task["taskId"]})
        except Exception as error:
            return make_json_response(-1, message=str(error)), 400

    @app.post("/fap-smb-external/task/resubmit")
    def fap_smb_external_task_resubmit():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        task_id = _to_text(body.get("taskId"))
        user_id = _get_request_user_id()
        old_task = get_task(task_id, user_id)
        if old_task is None:
            return make_json_response(-1, message=f"task not found: {task_id}"), 404
        task_type = int(old_task.get("taskType") or 0)
        if task_type not in (TASK_TYPE_SMB_EXTERNAL_COPY, TASK_TYPE_SMB_EXTERNAL_MOVE):
            return make_json_response(-1, message=f"unsupported taskType: {task_type}"), 400
        if int(old_task.get("taskStatus") or 0) != TASK_STATUS_FAIL:
            return make_json_response(-1, message="only failed tasks can be resubmitted"), 400
        task_info = old_task.get("taskInfo") if isinstance(old_task.get("taskInfo"), dict) else {}
        operation_info = task_info.get("operationInfo") if isinstance(task_info.get("operationInfo"), dict) else {}
        try:
            task = _submit_smb_external_copy_move_task(task_type, user_id, operation_info)
            return make_json_response(0, data={"task": task, "taskId": task["taskId"]})
        except Exception as error:
            return make_json_response(-1, message=str(error)), 400

    @app.post("/fap-smb-external/task/list")
    def fap_smb_external_task_list():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        try:
            return make_json_response(
                0,
                data={
                    "items": list_tasks(_get_request_user_id(), int(body.get("limit") or 50)),
                },
            )
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/fap-smb-external/task/get")
    def fap_smb_external_task_get():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        task_id = _to_text(body.get("taskId"))
        task = get_task(task_id, _get_request_user_id())
        if task is None:
            return make_json_response(-1, message=f"task not found: {task_id}"), 404
        return make_json_response(0, data={"task": task, "taskInfo": task.get("taskInfo")})

    @app.post("/fap-smb-external/task/status")
    def fap_smb_external_task_status():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        task_id = _to_text(body.get("taskId"))
        task = get_task(task_id, _get_request_user_id())
        if task is None:
            return make_json_response(-1, message=f"task not found: {task_id}"), 404
        return make_json_response(
            0,
            data={
                "taskId": task["taskId"],
                "taskStatus": task["taskStatus"],
                "taskStatusText": task["taskStatusText"],
            },
        )

    @app.post("/fap-smb-external/task/cancel")
    def fap_smb_external_task_cancel():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        try:
            task = cancel_task(body.get("taskId"), _get_request_user_id())
            return make_json_response(0, data={"task": task})
        except Exception as error:
            return make_json_response(-1, message=str(error)), 400

    @app.post("/fap-smb-external/task/delete")
    def fap_smb_external_task_delete():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        try:
            task = get_task(body.get("taskId"), _get_request_user_id())
            if task is None:
                return make_json_response(-1, message=f"task not found: {_to_text(body.get('taskId'))}"), 404
            if int(task.get("taskStatus") or 0) == TASK_STATUS_UNDERGOING:
                return make_json_response(-1, message="undergoing task cannot be deleted"), 400
            _delete_task_assets(task)
            task = delete_task(body.get("taskId"), _get_request_user_id())
            return make_json_response(0, data={"task": task})
        except Exception as error:
            return make_json_response(-1, message=str(error)), 400

    @app.post("/fap-smb-external/task/asset/list")
    def fap_smb_external_task_asset_list():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        task_id = _to_text(body.get("taskId"))
        task = get_task(task_id, _get_request_user_id())
        if task is None:
            return make_json_response(-1, message=f"task not found: {task_id}"), 404
        task_info = task.get("taskInfo") if isinstance(task.get("taskInfo"), dict) else {}
        asset_info = task_info.get("assetInfo") if isinstance(task_info.get("assetInfo"), dict) else {}
        asset_by_id = asset_info.get("assetById") if isinstance(asset_info.get("assetById"), dict) else {}
        return make_json_response(0, data={"assetById": asset_by_id, "items": list(asset_by_id.values())})

    @app.get("/fap-smb-external/task/asset/get")
    def fap_smb_external_task_asset_get():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        task_id = _to_text(request.args.get("taskId"))
        asset_id = _to_text(request.args.get("assetId"))
        task = get_task(task_id, _get_request_user_id())
        if task is None:
            return make_json_response(-1, message=f"task not found: {task_id}"), 404
        asset = _get_task_asset_by_id(task, asset_id)
        if not isinstance(asset, dict):
            return make_json_response(-1, message=f"asset not found: {asset_id}"), 404
        file_name_asset = _to_text(asset.get("fileNameAsset"))
        if not file_name_asset or "/" in file_name_asset or "\\" in file_name_asset:
            return make_json_response(-1, message="asset file name is invalid"), 400
        file_path = TASK_ASSET_DIR / file_name_asset
        if not file_path.is_file():
            return make_json_response(-1, message="asset file not found"), 404
        return send_file(
            file_path,
            as_attachment=True,
            download_name=_to_text(asset.get("fileNameDownload")) or file_name_asset,
            mimetype=_to_text(asset.get("contentType")) or "application/octet-stream",
        )

    @app.post("/fap-smb-external/create")
    def file_access_point_create():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        name = _to_text(body.get("name"))
        metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
        normalized_metadata = _normalize_metadata(metadata)
        create_result = upsert_db_file_access_point("", name, normalized_metadata)
        return make_json_response(0, data=create_result)

    @app.post("/fap-smb-external/update")
    def file_access_point_update():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId"))
        if not file_access_point_id:
            return make_json_response(-1, message="fileAccessPointId is required"), 400
        if file_access_point_id.startswith("config:"):
            return make_json_response(-1, message="config file access point cannot be updated"), 400
        name = _to_text(body.get("name"))
        metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
        normalized_metadata = _normalize_metadata(metadata)
        update_result = upsert_db_file_access_point(file_access_point_id, name, normalized_metadata)
        smb_connection_manager.disconnect(file_access_point_id, normalized_metadata)
        return make_json_response(0, data=update_result)

    @app.post("/fap-smb-external/delete")
    def file_access_point_delete():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId"))
        if not file_access_point_id:
            return make_json_response(-1, message="fileAccessPointId is required"), 400
        if file_access_point_id.startswith("config:"):
            return make_json_response(-1, message="config file access point cannot be deleted"), 400
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item:
            smb_connection_manager.disconnect(file_access_point_id, current_item["metadata"])
        delete_result = delete_db_file_access_point(file_access_point_id)
        return make_json_response(0, data=delete_result)

    @app.post("/fap-smb-external/connection/check")
    def file_access_point_connection_check():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId"))
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        try:
            state = smb_connection_manager.connect(file_access_point_id, current_item["metadata"], force_reconnect=False)
            return make_json_response(
                0,
                data={
                    "fileAccessPointId": file_access_point_id,
                    "isConnected": state.is_connected,
                    "lastErrorText": state.last_error_text,
                    "lastCheckUnixMs": state.last_check_unix_ms,
                },
            )
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/fap-smb-external/connection/reconnect")
    def file_access_point_connection_reconnect():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId"))
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        try:
            state = smb_connection_manager.connect(file_access_point_id, current_item["metadata"], force_reconnect=True)
            return make_json_response(
                0,
                data={
                    "fileAccessPointId": file_access_point_id,
                    "isConnected": state.is_connected,
                    "lastErrorText": state.last_error_text,
                    "lastCheckUnixMs": state.last_check_unix_ms,
                },
            )
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.get("/fap-smb-external/explore/list")
    @app.post("/fap-smb-external/explore/list")
    def file_access_point_explore_list():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId") or request.args.get("fileAccessPointId"))
        target_path = _normalize_path(body.get("path") or request.args.get("path"))
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        try:
            item_list = smb_connection_manager.list_dir(file_access_point_id, current_item["metadata"], target_path)
            return make_json_response(
                0,
                data={
                    "fileAccessPointId": file_access_point_id,
                    "path": target_path,
                    "items": item_list,
                },
            )
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.get("/fap-smb-external/explore/download")
    @app.post("/fap-smb-external/explore/download")
    def file_access_point_explore_download():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId") or request.args.get("fileAccessPointId"))
        target_path = _normalize_path(body.get("path") or request.args.get("path"))
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        file_name = target_path.split("/")[-1].strip()
        if not file_name:
            return make_json_response(-1, message="path should point to a file"), 400
        try:
            file_bytes = smb_connection_manager.read_file_bytes(file_access_point_id, current_item["metadata"], target_path)
            return send_file(
                BytesIO(file_bytes),
                as_attachment=True,
                download_name=file_name,
                mimetype="application/octet-stream",
            )
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/fap-smb-external/explore/rename")
    def file_access_point_explore_rename():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId"))
        target_path = _normalize_path(body.get("path"))
        next_name = _to_text(body.get("nextName"))
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        try:
            rename_result = smb_connection_manager.rename_path(
                file_access_point_id,
                current_item["metadata"],
                target_path,
                next_name,
            )
            return make_json_response(0, data=rename_result)
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/fap-smb-external/explore/upload")
    def file_access_point_explore_upload():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        file_access_point_id = _to_text(request.form.get("fileAccessPointId"))
        target_path = _normalize_path(request.form.get("path"))
        upload_name = _to_text(request.form.get("uploadName"))
        file_obj = request.files.get("file")
        if file_obj is None:
            return make_json_response(-1, message="file is required"), 400
        if not upload_name:
            upload_name = _to_text(file_obj.filename)
        if not upload_name:
            return make_json_response(-1, message="uploadName is required"), 400
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        try:
            file_bytes = file_obj.read()
            upload_result = smb_connection_manager.write_new_file_bytes(
                file_access_point_id,
                current_item["metadata"],
                target_path,
                upload_name,
                file_bytes,
            )
            return make_json_response(
                0,
                data={
                    "fileAccessPointId": file_access_point_id,
                    "folderPath": target_path,
                    **upload_result,
                },
            )
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/fap-smb-external/explore/new-file")
    def file_access_point_explore_new_file():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId"))
        target_path = _normalize_path(body.get("path"))
        try:
            suffix = _normalize_new_file_suffix(body.get("suffix"))
        except RuntimeError as error:
            return make_json_response(-1, message=str(error)), 400
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        try:
            create_result = smb_connection_manager.write_new_file_bytes(
                file_access_point_id,
                current_item["metadata"],
                target_path,
                f"new{suffix}",
                b"",
            )
            return make_json_response(
                0,
                data={
                    "fileAccessPointId": file_access_point_id,
                    "folderPath": target_path,
                    **create_result,
                },
            )
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/fap-smb-external/explore/text/open")
    def file_access_point_explore_text_open():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId"))
        target_path = _normalize_path(body.get("path"))
        target_is_directory = body.get("isDirectory") is not False
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        try:
            backup_result = smb_connection_manager.create_backup_file(
                file_access_point_id,
                current_item["metadata"],
                target_path,
                max_size_bytes=TEXT_EDITOR_MAX_SIZE_BYTES,
            )
            file_bytes = smb_connection_manager.read_file_bytes(file_access_point_id, current_item["metadata"], target_path)
            is_decode_lossy = False
            try:
                content_text = file_bytes.decode("utf-8")
            except UnicodeDecodeError:
                content_text = file_bytes.decode("utf-8", errors="replace")
                is_decode_lossy = True
            return make_json_response(
                0,
                data={
                    "fileAccessPointId": file_access_point_id,
                    "path": target_path,
                    "content": content_text,
                    "sizeBytes": len(file_bytes),
                    "backupPath": backup_result["backupPath"],
                    "backupName": backup_result["backupName"],
                    "backupSizeBytes": backup_result["sizeBytes"],
                    "isDecodeLossy": is_decode_lossy,
                    "maxSizeBytes": TEXT_EDITOR_MAX_SIZE_BYTES,
                },
            )
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/fap-smb-external/explore/text/save")
    def file_access_point_explore_text_save():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId"))
        target_path = _normalize_path(body.get("path"))
        content = str(body.get("content") or "")
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        try:
            file_bytes = content.encode("utf-8")
            if len(file_bytes) > TEXT_EDITOR_MAX_SIZE_BYTES:
                return make_json_response(-1, message=f"file is too large for text editor: {len(file_bytes)} bytes"), 400
            save_result = smb_connection_manager.write_file_bytes(
                file_access_point_id,
                current_item["metadata"],
                target_path,
                file_bytes,
            )
            return make_json_response(
                0,
                data={
                    **save_result,
                    "content": content,
                },
            )
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/fap-smb-external/explore/text/clean-bak")
    def file_access_point_explore_text_clean_bak():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId"))
        target_path = _normalize_path(body.get("path"))
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        try:
            clean_result = smb_connection_manager.clean_backup_files(
                file_access_point_id,
                current_item["metadata"],
                target_path,
            )
            return make_json_response(0, data=clean_result)
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/fap-smb-external/zip/start")
    def file_access_point_zip_start():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId"))
        target_path = _normalize_path(body.get("path"))
        current_item = _find_file_access_point_by_id(file_access_point_id)
        if current_item is None:
            return make_json_response(-1, message=f"file access point not found: {file_access_point_id}"), 404
        if not current_item["isMetadataValid"]:
            return make_json_response(
                -1,
                message=f"metadata invalid: {' | '.join(current_item['validationErrorTextList'])}",
            ), 400
        zip_encryption_key = get_request_zip_encryption_key()
        zip_timeout_seconds = get_request_zip_timeout_seconds()
        task = zip_task_manager.create_task()
        zip_task_manager.start_task(
            task,
            lambda task_item: _build_zip_archive(
                task_item,
                file_access_point_id,
                current_item["metadata"],
                target_path,
                zip_encryption_key,
                target_is_directory,
            ),
            timeout_seconds=zip_timeout_seconds,
        )
        return make_json_response(
            0,
            data={
                "taskId": task.task_id,
            },
        )

    @app.post("/fap-smb-external/zip/abort")
    def file_access_point_zip_abort():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        task_id = _to_text(body.get("taskId"))
        task = zip_task_manager.abort_task(task_id)
        if task is None:
            return make_json_response(-1, message=f"task not found: {task_id}"), 404
        return make_json_response(
            0,
            data={
                "taskId": task.task_id,
                "status": "aborting",
            },
        )

    @app.get("/fap-smb-external/zip/download")
    def file_access_point_zip_download():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        task_id = _to_text(request.args.get("taskId"))
        task = zip_task_manager.get_task(task_id)
        if task is None:
            return make_json_response(-1, message=f"task not found: {task_id}"), 404
        with task.lock:
            if task.status != "success":
                return make_json_response(-1, message=f"task status is not success: {task.status}"), 400
            zip_path = str(task.result_zip_path or "")
            download_name = str(task.result_download_name or "")
        if not zip_path or not Path(zip_path).is_file():
            return make_json_response(-1, message="zip file not found"), 404
        return send_file(
            zip_path,
            as_attachment=True,
            download_name=download_name or os.path.basename(zip_path),
            mimetype="application/zip",
        )

    @app.get("/fap-smb-external/zip/status")
    def file_access_point_zip_status():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        task_id = _to_text(request.args.get("taskId"))
        task = zip_task_manager.get_task(task_id)
        if task is None:
            return make_json_response(-1, message=f"task not found: {task_id}"), 404
        with task.lock:
            return make_json_response(
                0,
                data={
                    "taskId": task.task_id,
                    "status": task.status,
                    "statusMessage": task.status_message,
                    "errorText": task.error_text,
                },
            )

    @sock.route("/fap-smb-external/zip/ws/<task_id>")
    def file_access_point_zip_ws(ws, task_id: str):
        auth_token = _to_text(request.args.get("authToken"))
        if not validate_auth_token(auth_token):
            write_json_event(
                ws,
                {
                    "type": "status",
                    "status": "failed",
                    "messageText": "unauthorized websocket",
                },
            )
            return
        if not has_request_permission("R"):
            write_json_event(
                ws,
                {
                    "type": "status",
                    "status": "failed",
                    "messageText": "read permission required",
                },
            )
            return
        task = zip_task_manager.get_task(task_id)
        if task is None:
            write_json_event(
                ws,
                {
                    "type": "status",
                    "status": "failed",
                    "messageText": f"task not found: {task_id}",
                },
            )
            return
        while True:
            try:
                event_obj = task.event_queue.get(timeout=1.0)
                write_json_event(ws, event_obj)
            except queue.Empty:
                pass
            except Exception:
                return
            with task.lock:
                is_done = task.status in ("success", "failed", "aborted")
                status = task.status
                status_message = task.status_message
            if is_done and task.event_queue.empty():
                try:
                    write_json_event(
                        ws,
                        {
                            "type": "status",
                            "status": status,
                            "messageText": status_message,
                        },
                    )
                except Exception:
                    return
                return
