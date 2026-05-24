from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from threading import Lock
from time import time
from typing import Any

from smbclient import delete_session, open_file, register_session, remove, rename, scandir
from smbprotocol.exceptions import SMBAuthenticationError, SMBOSError

BACKUP_FILE_NAME_RE = re.compile(r"^.+-bak-\d{8}_\d{8}[+-]\d{2}(?:\.[^./\\]+)?$")


def _normalize_share_name(share_value: str):
    text = str(share_value or "").strip()
    if text.startswith("/"):
        text = text[1:]
    if text.startswith("\\"):
        text = text[1:]
    return text


def build_unc_path(host: str, share: str, inner_path: str):
    normalized_share = _normalize_share_name(share)
    normalized_inner = str(inner_path or "/").replace("\\", "/")
    if not normalized_inner.startswith("/"):
        normalized_inner = f"/{normalized_inner}"
    normalized_inner = normalized_inner.rstrip("/")
    if normalized_inner == "":
        normalized_inner = "/"
    inner_segment = normalized_inner[1:] if normalized_inner.startswith("/") else normalized_inner
    if inner_segment:
        return f"\\\\{host}\\{normalized_share}\\{inner_segment}"
    return f"\\\\{host}\\{normalized_share}"


def normalize_path(path_value: str):
    normalized = str(path_value or "/").replace("\\", "/").strip()
    if not normalized:
        return "/"
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    return normalized


def split_parent_and_name(path_value: str):
    normalized = normalize_path(path_value)
    if normalized == "/":
        return "/", ""
    path_parts = [part for part in normalized.split("/") if part]
    if len(path_parts) == 0:
        return "/", ""
    file_name = path_parts[-1]
    parent_path = "/" + "/".join(path_parts[:-1]) if len(path_parts) > 1 else "/"
    return parent_path, file_name


def build_backup_file_name(file_name: str):
    name = str(file_name or "").strip()
    if not name:
        raise RuntimeError("file name is required")
    now = datetime.now().astimezone()
    timestamp = now.strftime("%Y%m%d_%H%M%S") + f"{now.microsecond // 10000:02d}"
    offset = now.strftime("%z")
    offset_hour = f"{offset[:3]}" if offset else "+00"
    stem, separator, suffix = name.rpartition(".")
    if separator and stem:
        return f"{stem}-bak-{timestamp}{offset_hour}.{suffix}"
    return f"{name}-bak-{timestamp}{offset_hour}"


def is_backup_file_name(file_name: str):
    return BACKUP_FILE_NAME_RE.match(str(file_name or "")) is not None


@dataclass
class ConnectionState:
    is_connected: bool = False
    last_check_unix_ms: int = 0
    last_error_text: str = ""


class SmbConnectionManager:
    def __init__(self):
        self._state_by_id: dict[str, ConnectionState] = {}
        self._lock_by_id: dict[str, Lock] = {}

    def _get_lock(self, file_access_point_id: str):
        if file_access_point_id not in self._lock_by_id:
            self._lock_by_id[file_access_point_id] = Lock()
        return self._lock_by_id[file_access_point_id]

    def get_state(self, file_access_point_id: str):
        if file_access_point_id not in self._state_by_id:
            self._state_by_id[file_access_point_id] = ConnectionState()
        return self._state_by_id[file_access_point_id]

    def disconnect(self, file_access_point_id: str, metadata: dict[str, Any]):
        lock = self._get_lock(file_access_point_id)
        with lock:
            host = str(metadata.get("host") or "").strip()
            username = str(metadata.get("username") or "").strip()
            if host and username:
                try:
                    delete_session(server=host, username=username)
                except Exception:
                    pass
            state = self.get_state(file_access_point_id)
            state.is_connected = False
            state.last_check_unix_ms = int(time() * 1000)
            state.last_error_text = "disconnected"
            return state

    def connect(self, file_access_point_id: str, metadata: dict[str, Any], force_reconnect: bool = False):
        lock = self._get_lock(file_access_point_id)
        with lock:
            host = str(metadata.get("host") or "").strip()
            username = str(metadata.get("username") or "").strip()
            password = str(metadata.get("password") or "")
            share = str(metadata.get("share") or "").strip()
            if not host or not username or not share:
                raise RuntimeError("host, username, share are required to establish smb connection")
            if force_reconnect:
                try:
                    delete_session(server=host, username=username)
                except Exception:
                    pass
            state = self.get_state(file_access_point_id)
            try:
                register_session(
                    server=host,
                    username=username,
                    password=password,
                    connection_timeout=8,
                )
                root_path = build_unc_path(host, share, "/")
                list(scandir(root_path))
                state.is_connected = True
                state.last_error_text = ""
            except (SMBAuthenticationError, SMBOSError, OSError) as error:
                state.is_connected = False
                state.last_error_text = str(error)
                raise
            finally:
                state.last_check_unix_ms = int(time() * 1000)
            return state

    def list_dir(self, file_access_point_id: str, metadata: dict[str, Any], target_path: str):
        self.connect(file_access_point_id, metadata, force_reconnect=False)
        lock = self._get_lock(file_access_point_id)
        with lock:
            host = str(metadata.get("host") or "").strip()
            share = str(metadata.get("share") or "").strip()
            unc_path = build_unc_path(host, share, target_path)
            item_list = []
            for entry in scandir(unc_path):
                item_list.append(
                    {
                        "name": str(entry.name),
                        "isDirectory": bool(entry.is_dir()),
                        "sizeBytes": int(entry.stat().st_size if not entry.is_dir() else 0),
                    }
                )
            item_list.sort(key=lambda item: (not item["isDirectory"], item["name"].lower()))
            return item_list

    def read_file_bytes(self, file_access_point_id: str, metadata: dict[str, Any], target_path: str):
        self.connect(file_access_point_id, metadata, force_reconnect=False)
        lock = self._get_lock(file_access_point_id)
        with lock:
            host = str(metadata.get("host") or "").strip()
            share = str(metadata.get("share") or "").strip()
            unc_path = build_unc_path(host, share, target_path)
            with open_file(unc_path, mode="rb") as file_obj:
                return file_obj.read()

    def write_file_bytes(self, file_access_point_id: str, metadata: dict[str, Any], target_path: str, file_bytes: bytes):
        self.connect(file_access_point_id, metadata, force_reconnect=False)
        lock = self._get_lock(file_access_point_id)
        with lock:
            host = str(metadata.get("host") or "").strip()
            share = str(metadata.get("share") or "").strip()
            unc_path = build_unc_path(host, share, target_path)
            with open_file(unc_path, mode="wb") as file_obj:
                file_obj.write(file_bytes)
            return {
                "path": normalize_path(target_path),
                "sizeBytes": len(file_bytes),
            }

    def create_backup_file(
        self,
        file_access_point_id: str,
        metadata: dict[str, Any],
        target_path: str,
        max_size_bytes: int | None = None,
    ):
        self.connect(file_access_point_id, metadata, force_reconnect=False)
        lock = self._get_lock(file_access_point_id)
        with lock:
            host = str(metadata.get("host") or "").strip()
            share = str(metadata.get("share") or "").strip()
            normalized_path = normalize_path(target_path)
            parent_path, file_name = split_parent_and_name(normalized_path)
            if not file_name:
                raise RuntimeError("path should point to a file")
            backup_name = build_backup_file_name(file_name)
            backup_path = f"{parent_path.rstrip('/')}/{backup_name}" if parent_path != "/" else f"/{backup_name}"
            parent_unc_path = build_unc_path(host, share, parent_path)
            existing_name_set = {str(entry.name) for entry in scandir(parent_unc_path)}
            if backup_name in existing_name_set:
                raise RuntimeError(f"backup file already exists: {backup_name}")
            source_unc_path = build_unc_path(host, share, normalized_path)
            backup_unc_path = build_unc_path(host, share, backup_path)
            with open_file(source_unc_path, mode="rb") as source_obj:
                file_bytes = source_obj.read()
            if max_size_bytes is not None and len(file_bytes) > max_size_bytes:
                raise RuntimeError(f"file is too large for text editor: {len(file_bytes)} bytes")
            with open_file(backup_unc_path, mode="wb") as backup_obj:
                backup_obj.write(file_bytes)
            return {
                "path": normalized_path,
                "backupPath": backup_path,
                "backupName": backup_name,
                "sizeBytes": len(file_bytes),
            }

    def clean_backup_files(self, file_access_point_id: str, metadata: dict[str, Any], target_path: str):
        self.connect(file_access_point_id, metadata, force_reconnect=False)
        lock = self._get_lock(file_access_point_id)
        with lock:
            host = str(metadata.get("host") or "").strip()
            share = str(metadata.get("share") or "").strip()
            normalized_path = normalize_path(target_path)
            folder_unc_path = build_unc_path(host, share, normalized_path)
            removed_name_list = []
            for entry in list(scandir(folder_unc_path)):
                name = str(entry.name)
                if entry.is_dir() or not is_backup_file_name(name):
                    continue
                remove(build_unc_path(host, share, f"{normalized_path.rstrip('/')}/{name}" if normalized_path != "/" else f"/{name}"))
                removed_name_list.append(name)
            return {
                "path": normalized_path,
                "removedNames": removed_name_list,
                "removedCount": len(removed_name_list),
            }

    def rename_path(self, file_access_point_id: str, metadata: dict[str, Any], target_path: str, next_name: str):
        self.connect(file_access_point_id, metadata, force_reconnect=False)
        lock = self._get_lock(file_access_point_id)
        with lock:
            normalized_name = str(next_name or "").strip()
            if not normalized_name:
                raise RuntimeError("nextName is required")
            if "/" in normalized_name or "\\" in normalized_name:
                raise RuntimeError("nextName cannot include path separator")
            host = str(metadata.get("host") or "").strip()
            share = str(metadata.get("share") or "").strip()
            normalized_path = normalize_path(target_path)
            parent_path, old_name = split_parent_and_name(normalized_path)
            if not old_name:
                raise RuntimeError("cannot rename root path")
            src_unc_path = build_unc_path(host, share, normalized_path)
            dst_path = f"{parent_path.rstrip('/')}/{normalized_name}" if parent_path != "/" else f"/{normalized_name}"
            dst_unc_path = build_unc_path(host, share, dst_path)
            rename(src_unc_path, dst_unc_path)
            return {
                "path": normalized_path,
                "nextPath": dst_path,
                "oldName": old_name,
                "nextName": normalized_name,
            }


smb_connection_manager = SmbConnectionManager()
