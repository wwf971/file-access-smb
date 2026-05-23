from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import time
from typing import Any

from smbclient import delete_session, open_file, register_session, scandir
from smbprotocol.exceptions import SMBAuthenticationError, SMBOSError


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


smb_connection_manager = SmbConnectionManager()
