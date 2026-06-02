from __future__ import annotations

import os
import queue
import sys
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
from login import get_request_permission, get_request_zip_encryption_key, get_request_zip_timeout_seconds, has_request_permission
from smb_service import smb_connection_manager
from zip_task import create_zip_temp_path, sanitize_file_name, write_json_event, zip_task_manager

TEXT_EDITOR_MAX_SIZE_BYTES = 2 * 1024 * 1024


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


def _build_zip_archive(
    task,
    file_access_point_id: str,
    metadata: dict[str, Any],
    target_path: str,
    zip_encryption_key: str = "",
):
    folder_name_raw = target_path.strip("/").split("/")[-1] or "root"
    folder_name = sanitize_file_name(folder_name_raw)
    zip_path = create_zip_temp_path(folder_name)

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

    if zip_encryption_key:
        with pyzipper.AESZipFile(
            zip_path,
            mode="w",
            compression=pyzipper.ZIP_DEFLATED,
            encryption=pyzipper.WZ_AES,
        ) as zip_file:
            zip_file.setpassword(str(zip_encryption_key).encode("utf-8"))
            write_folder(target_path, zip_file, folder_name)
    else:
        with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
            write_folder(target_path, zip_file, folder_name)
    task.emit_log(f"zip ready {zip_path}")
    with task.lock:
        task.result_download_name = f"{folder_name}.zip"
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


def _load_all_file_access_points():
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
    merged_list, _database_error_text = _load_all_file_access_points()
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
    merged_list, _database_error_text = _load_all_file_access_points()
    for item in merged_list:
        if str(item.get("name") or "") == normalized_name:
            return item
    return None


def register_fap_smb_external_routes(app, sock, make_json_response, validate_auth_token):
    @app.get("/file-access-point/get-by-id")
    @app.post("/file-access-point/get-by-id")
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

    @app.get("/file-access-point/get-by-name")
    @app.post("/file-access-point/get-by-name")
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

    @app.get("/file-access-point/list")
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

    @app.post("/file-access-point/create")
    def file_access_point_create():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        name = _to_text(body.get("name"))
        metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
        normalized_metadata = _normalize_metadata(metadata)
        create_result = upsert_db_file_access_point("", name, normalized_metadata)
        return make_json_response(0, data=create_result)

    @app.post("/file-access-point/update")
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

    @app.post("/file-access-point/delete")
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

    @app.post("/file-access-point/connection/check")
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

    @app.post("/file-access-point/connection/reconnect")
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

    @app.get("/file-access-point/explore/list")
    @app.post("/file-access-point/explore/list")
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

    @app.get("/file-access-point/explore/download")
    @app.post("/file-access-point/explore/download")
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

    @app.post("/file-access-point/explore/rename")
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

    @app.post("/file-access-point/explore/upload")
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

    @app.post("/file-access-point/explore/text/open")
    def file_access_point_explore_text_open():
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

    @app.post("/file-access-point/explore/text/save")
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

    @app.post("/file-access-point/explore/text/clean-bak")
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

    @app.post("/file-access-point/zip/start")
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
            ),
            timeout_seconds=zip_timeout_seconds,
        )
        return make_json_response(
            0,
            data={
                "taskId": task.task_id,
            },
        )

    @app.post("/file-access-point/zip/abort")
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

    @app.get("/file-access-point/zip/download")
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

    @app.get("/file-access-point/zip/status")
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

    @sock.route("/file-access-point/zip/ws/<task_id>")
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
