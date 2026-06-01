from __future__ import annotations

import json
import random
import re
import string
from contextlib import closing
from datetime import datetime
from io import BytesIO
from typing import Any

import yaml
from flask import request, send_file
from psycopg import sql
from psycopg.rows import dict_row

from db import create_file_access_point_id, get_dir_base, run_in_transaction
from fap_smb_external import _find_file_access_point_by_id, _find_file_access_point_by_name, load_project_config
from login import has_request_permission
from smb_service import normalize_path, smb_connection_manager, split_parent_and_name

FILE_ACCESS_POINT_ID_RE = re.compile(r"^[a-z0-9_]+$")
FILE_ID_ALPHABET = string.ascii_lowercase + string.digits


def _to_text(value: Any):
    return str(value or "").strip()


def _to_bool(value: Any, default: bool = False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _format_timestamp():
    now = datetime.now().astimezone()
    timestamp = now.strftime("%Y%m%d_%H%M%S") + f"{now.microsecond // 10000:02d}"
    offset = now.strftime("%z")
    offset_hour = f"{offset[:3]}" if offset else "+00"
    return f"{timestamp}{offset_hour}"


def _normalize_path(path_value: Any):
    return normalize_path(str(path_value or "/"))


def _join_path(base_path: str, name: str):
    normalized_base = _normalize_path(base_path)
    normalized_name = str(name or "").replace("\\", "/").strip("/")
    if not normalized_name:
        return normalized_base
    if normalized_base == "/":
        return f"/{normalized_name}"
    return f"{normalized_base}/{normalized_name}"


def _normalize_file_name(file_name: Any):
    normalized_name = _to_text(file_name)
    if not normalized_name:
        raise RuntimeError("fileName is required")
    if "/" in normalized_name or "\\" in normalized_name:
        raise RuntimeError("fileName cannot include path separator")
    return normalized_name


def _create_file_id():
    return "".join(random.choice(FILE_ID_ALPHABET) for _ in range(12))


def _get_file_suffix(file_name: str):
    name = str(file_name or "")
    if "." not in name:
        return ""
    suffix = name.rsplit(".", 1)[-1].strip().lower()
    if not suffix:
        return ""
    return suffix


def _get_file_name_storage(file_id: str, file_name: str):
    suffix = _get_file_suffix(file_name)
    file_name_storage = file_id
    if suffix:
        file_name_storage = f"{file_name_storage}.{suffix}"
    return file_name_storage


def _get_file_path_storage(file_id: str, file_name: str, folder_depth: int = 1):
    normalized_file_id = _to_text(file_id)
    normalized_depth = max(1, min(int(folder_depth or 1), max(1, len(normalized_file_id) // 2)))
    folder_list = [
        normalized_file_id[index:index + 2]
        for index in range(0, normalized_depth * 2, 2)
        if normalized_file_id[index:index + 2]
    ]
    return "/".join([*folder_list, _get_file_name_storage(normalized_file_id, file_name)])


def _normalize_file_path_storage(file_path: str):
    normalized_path = normalize_path(str(file_path or "/")).strip("/")
    if normalized_path == "files":
        return ""
    if normalized_path.startswith("files/"):
        return normalized_path[len("files/"):]
    return normalized_path


def _get_storage_folder_depth(internal_fap: dict[str, Any]):
    metadata = internal_fap.get("metadata") if isinstance(internal_fap.get("metadata"), dict) else {}
    try:
        return max(1, int(metadata.get("storageFolderDepth") or 1))
    except (TypeError, ValueError):
        return 1


def _get_file_path_storage_for_rename(file_path: str, file_id: str, file_name: str):
    normalized_path = _normalize_file_path_storage(file_path)
    folder_path = normalized_path.rsplit("/", 1)[0] if "/" in normalized_path else ""
    file_name_storage = _get_file_name_storage(file_id, file_name)
    return f"{folder_path}/{file_name_storage}" if folder_path else file_name_storage


def _get_storage_folder_path(file_id: str, folder_depth: int):
    normalized_file_id = _to_text(file_id)
    normalized_depth = max(1, min(int(folder_depth or 1), max(1, len(normalized_file_id) // 2)))
    return "/".join(
        normalized_file_id[index:index + 2]
        for index in range(0, normalized_depth * 2, 2)
        if normalized_file_id[index:index + 2]
    )


def _get_storage_folder_depth_for_count(file_list: list[dict[str, Any]], max_files_per_folder: int, max_depth: int):
    normalized_max_files = max(1, int(max_files_per_folder or 1))
    normalized_max_depth = max(1, int(max_depth or 1))
    for depth in range(1, normalized_max_depth + 1):
        folder_count_map = {}
        for file_info in file_list:
            folder_path = _get_storage_folder_path(str(file_info["fileId"]), depth)
            folder_count_map[folder_path] = folder_count_map.get(folder_path, 0) + 1
        if not folder_count_map or max(folder_count_map.values()) <= normalized_max_files:
            return depth
    return normalized_max_depth


def _get_file_access_point_table_name(file_access_point_id: str):
    normalized_id = _to_text(file_access_point_id).lower()
    if not FILE_ACCESS_POINT_ID_RE.match(normalized_id):
        raise RuntimeError("smb/internal fileAccessPointId must only contain lowercase letters, digits, and underscore")
    return f"files_{normalized_id}"


def _normalize_file_access_point_smb_external_info(raw_info: Any):
    info = raw_info if isinstance(raw_info, dict) else {}
    file_access_point_smb_external_id = _to_text(info.get("id") or info.get("fileAccessPointId"))
    file_access_point_smb_external_name = _to_text(info.get("name") or info.get("fileAccessPointName"))
    if file_access_point_smb_external_id:
        return {"id": file_access_point_smb_external_id}
    if file_access_point_smb_external_name:
        return {"name": file_access_point_smb_external_name}
    raise RuntimeError("fileAccessPointSmbExternalInfo.id or fileAccessPointSmbExternalInfo.name is required")


def _normalize_metadata(
    metadata: dict[str, Any],
    file_access_point_smb_external_info: dict[str, str],
    path_root: str,
):
    data = dict(metadata or {})
    data["fileAccessPointSmbExternalInfo"] = file_access_point_smb_external_info
    data["pathRoot"] = path_root
    return data


def _normalize_fap_body(body: dict[str, Any]):
    metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
    file_access_point_smb_external_info = _normalize_file_access_point_smb_external_info(
        body.get("fileAccessPointSmbExternalInfo")
        or metadata.get("fileAccessPointSmbExternalInfo")
        or {
            "id": body.get("fileAccessPointSmbExternalId") or metadata.get("fileAccessPointSmbExternalId"),
            "name": body.get("fileAccessPointSmbExternalName") or metadata.get("fileAccessPointSmbExternalName"),
        }
    )
    path_root = _normalize_path(body.get("pathRoot") or metadata.get("pathRoot") or "/")
    return {
        "name": _to_text(body.get("name")),
        "fileAccessPointSmbExternalInfo": file_access_point_smb_external_info,
        "pathRoot": path_root,
        "metadata": _normalize_metadata(metadata, file_access_point_smb_external_info, path_root),
    }


def _row_to_internal_fap(row):
    file_access_point_id = str(row["fileaccesspointid"])
    metadata = row["metadata"] if isinstance(row["metadata"], dict) else {}
    file_access_point_smb_external_info = (
        row["fileaccesspointsmbexternalinfo"]
        if isinstance(row["fileaccesspointsmbexternalinfo"], dict)
        else {}
    )
    return {
        "fileAccessPointId": file_access_point_id,
        "name": str(row["name"] or ""),
        "fileAccessPointType": "smb/internal",
        "fileAccessPointSmbExternalInfo": file_access_point_smb_external_info,
        "pathRoot": str(row["pathroot"] or "/"),
        "metadata": metadata,
        "fileTableName": _get_file_access_point_table_name(file_access_point_id),
        "sourceType": str(row["sourcetype"] if "sourcetype" in row else "database"),
        "isDeletable": True,
        "createdAt": str(row["createdat"] or ""),
        "updatedAt": str(row["updatedat"] or ""),
    }


def _ensure_file_table(cursor, file_access_point_id: str):
    table_name = _get_file_access_point_table_name(file_access_point_id)
    cursor.execute(
        sql.SQL(
            """
            create table if not exists {} (
              fileId text primary key,
              fileName text not null,
              filePath text not null unique,
              fileType text not null default '',
              sizeBytes bigint not null default 0,
              metadata jsonb not null default '{{}}'::jsonb,
              isDeleted boolean not null default false,
              createdAt timestamptz not null default now(),
              createAtTimeZone integer not null default 0,
              updatedAt timestamptz not null default now(),
              updateAtTimeZone integer not null default 0,
              deletedAt timestamptz
            )
            """
        ).format(sql.Identifier(table_name))
    )
    cursor.execute(
        sql.SQL("alter table {} add column if not exists createAtTimeZone integer not null default 0").format(
            sql.Identifier(table_name)
        )
    )
    cursor.execute(
        sql.SQL("alter table {} add column if not exists updateAtTimeZone integer not null default 0").format(
            sql.Identifier(table_name)
        )
    )
    cursor.execute(
        sql.SQL("create index if not exists {} on {} (createdAt)").format(
            sql.Identifier(f"idx_{table_name}_created_at"),
            sql.Identifier(table_name),
        )
    )
    return table_name


def _get_internal_fap_by_id_db(cursor, file_access_point_id: str):
    cursor.execute(
        """
        select
            fileAccessPointId,
            name,
            fileAccessPointSmbExternalInfo,
            pathRoot,
            metadata,
            createdAt,
            updatedAt
        from smb_internal_file_access_point
        where fileAccessPointId = %s
        """,
        (_to_text(file_access_point_id),),
    )
    row = cursor.fetchone()
    if row is None:
        return None
    return _row_to_internal_fap(row)


def _safe_config_file_access_point_id(name: str):
    safe_name = re.sub(r"[^a-z0-9_]+", "_", str(name or "").strip().lower()).strip("_")
    if not safe_name:
        raise RuntimeError("config smb/internal file access point name is invalid")
    return f"config_{safe_name}"


def _is_example_internal_fap_config_item(key: str, raw_item: dict[str, Any], metadata: dict[str, Any]):
    return (
        key == "file_access_point_smb_internal_example"
        or _to_bool(raw_item.get("isExample"))
        or _to_bool(raw_item.get("is_example"))
        or _to_bool(metadata.get("isExample"))
        or _to_bool(metadata.get("is_example"))
    )


def _has_local_internal_fap_config():
    config_path = get_dir_base() / "config" / "config.0.yaml"
    if not config_path.is_file():
        return False
    with config_path.open("r", encoding="utf-8") as file_obj:
        data = yaml.safe_load(file_obj) or {}
    if not isinstance(data, dict):
        return False
    internal_config = data.get("file_access_point_smb_internal")
    return isinstance(internal_config, dict) and len(internal_config) > 0


def _filter_visible_internal_faps(item_list: list[dict[str, Any]]):
    if len(item_list) <= 1:
        return item_list
    return [item for item in item_list if not item.get("isExample")]


def _load_config_internal_faps():
    project_config = load_project_config(get_dir_base())
    raw_items = project_config.get("file_access_point_smb_internal") or {}
    is_from_example_config = not _has_local_internal_fap_config()
    item_list = []
    for key, raw_item in raw_items.items():
        if not isinstance(raw_item, dict):
            continue
        metadata = raw_item.get("metadata") if isinstance(raw_item.get("metadata"), dict) else {}
        file_access_point_smb_external_info = _normalize_file_access_point_smb_external_info(
            raw_item.get("fileAccessPointSmbExternalInfo")
            or raw_item.get("file_access_point_smb_external_info")
            or metadata.get("fileAccessPointSmbExternalInfo")
            or metadata.get("file_access_point_smb_external_info")
            or {
                "id": raw_item.get("fileAccessPointSmbExternalId") or raw_item.get("file_access_point_smb_external_id"),
                "name": raw_item.get("fileAccessPointSmbExternalName") or raw_item.get("file_access_point_smb_external_name"),
            }
        )
        path_root = _normalize_path(raw_item.get("pathRoot") or raw_item.get("path_root") or "/")
        file_access_point_id = _safe_config_file_access_point_id(key)
        metadata_normalized = _normalize_metadata(metadata, file_access_point_smb_external_info, path_root)
        item_list.append(
            {
                "fileAccessPointId": file_access_point_id,
                "name": str(raw_item.get("name") or key),
                "fileAccessPointType": "smb/internal",
                "fileAccessPointSmbExternalInfo": file_access_point_smb_external_info,
                "pathRoot": path_root,
                "metadata": metadata_normalized,
                "fileTableName": _get_file_access_point_table_name(file_access_point_id),
                "sourceType": "config",
                "isExample": is_from_example_config and _is_example_internal_fap_config_item(key, raw_item, metadata),
                "isDeletable": False,
                "createdAt": "",
                "updatedAt": "",
            }
        )
    return item_list


def _get_internal_fap_by_id(cursor, file_access_point_id: str):
    normalized_id = _to_text(file_access_point_id).lower()
    for item in _load_config_internal_faps():
        if item["fileAccessPointId"] == normalized_id:
            return item
    return _get_internal_fap_by_id_db(cursor, normalized_id)


def _get_fap_smb_external(internal_fap: dict[str, Any]):
    info = internal_fap.get("fileAccessPointSmbExternalInfo")
    if not isinstance(info, dict):
        info = {}
    file_access_point_smb_external_id = _to_text(info.get("id") or info.get("fileAccessPointId"))
    file_access_point_smb_external_name = _to_text(info.get("name") or info.get("fileAccessPointName"))
    fap_smb_external = None
    if file_access_point_smb_external_id:
        fap_smb_external = _find_file_access_point_by_id(file_access_point_smb_external_id)
    elif file_access_point_smb_external_name:
        fap_smb_external = _find_file_access_point_by_name(file_access_point_smb_external_name)
    else:
        raise RuntimeError("fileAccessPointSmbExternalInfo.id or fileAccessPointSmbExternalInfo.name is required")
    if fap_smb_external is None:
        query_text = file_access_point_smb_external_id or file_access_point_smb_external_name
        raise RuntimeError(f"smb/external file access point not found: {query_text}")
    if not fap_smb_external.get("isMetadataValid"):
        message = " | ".join(fap_smb_external.get("validationErrorTextList") or [])
        raise RuntimeError(f"smb/external metadata invalid: {message}")
    return fap_smb_external


def _to_external_path(internal_fap: dict[str, Any], internal_path: str):
    return _join_path(str(internal_fap.get("pathRoot") or "/"), internal_path)


def _to_file_external_path(internal_fap: dict[str, Any], file_path: str):
    return _join_path(_join_path(str(internal_fap.get("pathRoot") or "/"), "files"), _normalize_file_path_storage(file_path))


def _ensure_internal_dirs(internal_fap: dict[str, Any], fap_smb_external: dict[str, Any]):
    file_access_point_smb_external_id = str(fap_smb_external["fileAccessPointId"])
    metadata = fap_smb_external["metadata"]
    root_path = str(internal_fap.get("pathRoot") or "/")
    smb_connection_manager.ensure_dir(file_access_point_smb_external_id, metadata, root_path)
    smb_connection_manager.ensure_dir(file_access_point_smb_external_id, metadata, _join_path(root_path, "files"))
    smb_connection_manager.ensure_dir(file_access_point_smb_external_id, metadata, _join_path(root_path, "metadata"))


def _write_metadata_backup(internal_fap: dict[str, Any], fap_smb_external: dict[str, Any], metadata_backup: dict[str, Any]):
    timestamp = _format_timestamp()
    metadata_path = _to_external_path(internal_fap, f"/metadata/{timestamp}_metadata.yaml")
    metadata_bytes = yaml.safe_dump(metadata_backup, sort_keys=False, allow_unicode=False).encode("utf-8")
    smb_connection_manager.write_file_bytes(
        str(fap_smb_external["fileAccessPointId"]),
        fap_smb_external["metadata"],
        metadata_path,
        metadata_bytes,
    )
    return metadata_path


def _row_to_file(row):
    return {
        "fileId": str(row["fileid"]),
        "fileName": str(row["filename"] or ""),
        "filePath": _normalize_file_path_storage(str(row["filepath"] or "")),
        "fileType": str(row["filetype"] or ""),
        "sizeBytes": int(row["sizebytes"] or 0),
        "metadata": row["metadata"] if isinstance(row["metadata"], dict) else {},
        "isDeleted": bool(row["isdeleted"]),
        "createdAt": str(row["createdat"] or ""),
        "createAtTimeZone": int(row["createattimezone"] or 0),
        "updatedAt": str(row["updatedat"] or ""),
        "updateAtTimeZone": int(row["updateattimezone"] or 0),
        "deletedAt": str(row["deletedat"] or ""),
    }


def _get_file_by_id_db(cursor, table_name: str, file_id: str, include_deleted: bool = False):
    where_deleted_sql = sql.SQL("") if include_deleted else sql.SQL("and isDeleted = false")
    cursor.execute(
        sql.SQL(
            """
            select
                fileId,
                fileName,
                filePath,
                fileType,
                sizeBytes,
                metadata,
                isDeleted,
                createdAt,
                createAtTimeZone,
                updatedAt,
                updateAtTimeZone,
                deletedAt
            from {}
            where fileId = %s
            {}
            """
        ).format(sql.Identifier(table_name), where_deleted_sql),
        (_to_text(file_id),),
    )
    row = cursor.fetchone()
    if row is None:
        return None
    return _row_to_file(row)


def _list_internal_faps():
    def action(db):
        with closing(db.cursor(row_factory=dict_row)) as cursor:
            cursor.execute(
                """
                select
                    fileAccessPointId,
                    name,
                    fileAccessPointSmbExternalInfo,
                    pathRoot,
                    metadata,
                    createdAt,
                    updatedAt,
                    'database' as sourceType
                from smb_internal_file_access_point
                order by createdAt asc
                """
            )
            item_list = [*_load_config_internal_faps(), *[_row_to_internal_fap(row) for row in cursor.fetchall() or []]]
            return _filter_visible_internal_faps(item_list)

    return run_in_transaction(action)


def _upsert_internal_fap(file_access_point_id: str, fap_data: dict[str, Any]):
    normalized_id = _to_text(file_access_point_id).lower()
    if not normalized_id:
        normalized_id = create_file_access_point_id()
    if not FILE_ACCESS_POINT_ID_RE.match(normalized_id):
        raise RuntimeError("fileAccessPointId must only contain lowercase letters, digits, and underscore")
    name = _to_text(fap_data.get("name")) or normalized_id

    def action(db):
        with closing(db.cursor(row_factory=dict_row)) as cursor:
            cursor.execute(
                """
                insert into smb_internal_file_access_point(
                    fileAccessPointId,
                    name,
                    fileAccessPointSmbExternalInfo,
                    pathRoot,
                    metadata,
                    updatedAt
                )
                values (%s, %s, %s, %s, %s::jsonb, now())
                on conflict (fileAccessPointId) do update set
                    name = excluded.name,
                    fileAccessPointSmbExternalInfo = excluded.fileAccessPointSmbExternalInfo,
                    pathRoot = excluded.pathRoot,
                    metadata = excluded.metadata,
                    updatedAt = now()
                """,
                (
                    normalized_id,
                    name,
                    json.dumps(fap_data["fileAccessPointSmbExternalInfo"]),
                    fap_data["pathRoot"],
                    json.dumps(fap_data["metadata"]),
                ),
            )
            _ensure_file_table(cursor, normalized_id)
            internal_fap = _get_internal_fap_by_id_db(cursor, normalized_id)
            fap_smb_external = _get_fap_smb_external(internal_fap)
            _ensure_internal_dirs(internal_fap, fap_smb_external)
            return internal_fap

    return run_in_transaction(action)


def _delete_internal_fap(file_access_point_id: str):
    normalized_id = _to_text(file_access_point_id).lower()
    if not normalized_id:
        raise RuntimeError("fileAccessPointId is required")

    def action(db):
        with closing(db.cursor()) as cursor:
            table_name = _get_file_access_point_table_name(normalized_id)
            cursor.execute(sql.SQL("drop table if exists {}").format(sql.Identifier(table_name)))
            cursor.execute(
                "delete from smb_internal_file_access_point where fileAccessPointId = %s",
                (normalized_id,),
            )
        return {"fileAccessPointId": normalized_id}

    return run_in_transaction(action)


def register_fap_smb_internal_routes(app, make_json_response):
    @app.get("/smb-internal-file-access-point/list")
    def smb_internal_file_access_point_list():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        try:
            item_list = _list_internal_faps()
            return make_json_response(0, data={"items": item_list, "count": len(item_list)})
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/smb-internal-file-access-point/create")
    def smb_internal_file_access_point_create():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        try:
            body = request.get_json(silent=True) or {}
            fap_data = _normalize_fap_body(body)
            result = _upsert_internal_fap("", fap_data)
            return make_json_response(0, data=result)
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/smb-internal-file-access-point/update")
    def smb_internal_file_access_point_update():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        try:
            body = request.get_json(silent=True) or {}
            file_access_point_id = _to_text(body.get("fileAccessPointId")).lower()
            if not file_access_point_id:
                return make_json_response(-1, message="fileAccessPointId is required"), 400
            fap_data = _normalize_fap_body(body)
            result = _upsert_internal_fap(file_access_point_id, fap_data)
            return make_json_response(0, data=result)
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/smb-internal-file-access-point/delete")
    def smb_internal_file_access_point_delete():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        try:
            body = request.get_json(silent=True) or {}
            result = _delete_internal_fap(body.get("fileAccessPointId"))
            return make_json_response(0, data=result)
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.get("/smb-internal-file-access-point/file/list")
    @app.post("/smb-internal-file-access-point/file/list")
    def smb_internal_file_list():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId") or request.args.get("fileAccessPointId")).lower()
        page_index = int(body.get("pageIndex") or request.args.get("pageIndex") or 0)
        page_size = int(body.get("pageSize") or request.args.get("pageSize") or 50)
        page_index = max(0, page_index)
        page_size = max(1, min(200, page_size))
        if not file_access_point_id:
            return make_json_response(-1, message="fileAccessPointId is required"), 400

        def action(db):
            with closing(db.cursor(row_factory=dict_row)) as cursor:
                internal_fap = _get_internal_fap_by_id(cursor, file_access_point_id)
                if internal_fap is None:
                    raise RuntimeError(f"smb/internal file access point not found: {file_access_point_id}")
                table_name = _ensure_file_table(cursor, file_access_point_id)
                cursor.execute(
                    sql.SQL("select count(*) as count from {} where isDeleted = false").format(sql.Identifier(table_name))
                )
                count_row = cursor.fetchone()
                total_count = int(count_row["count"] or 0)
                cursor.execute(
                    sql.SQL(
                        """
                        select
                            fileId,
                            fileName,
                            filePath,
                            fileType,
                            sizeBytes,
                            metadata,
                            isDeleted,
                            createdAt,
                            createAtTimeZone,
                            updatedAt,
                            updateAtTimeZone,
                            deletedAt
                        from {}
                        where isDeleted = false
                        order by createdAt desc
                        limit %s offset %s
                        """
                    ).format(sql.Identifier(table_name)),
                    (page_size, page_index * page_size),
                )
                item_list = [_row_to_file(row) for row in cursor.fetchall() or []]
                return {
                    "fileAccessPointId": file_access_point_id,
                    "items": item_list,
                    "count": len(item_list),
                    "totalCount": total_count,
                    "pageIndex": page_index,
                    "pageSize": page_size,
                }

        try:
            return make_json_response(0, data=run_in_transaction(action))
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/smb-internal-file-access-point/file/upload")
    def smb_internal_file_upload():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        try:
            file_access_point_id = _to_text(request.form.get("fileAccessPointId")).lower()
            file_obj = request.files.get("file")
            if not file_access_point_id:
                return make_json_response(-1, message="fileAccessPointId is required"), 400
            if file_obj is None:
                return make_json_response(-1, message="file is required"), 400
            file_name = _normalize_file_name(request.form.get("fileName") or file_obj.filename)
            file_type = _to_text(request.form.get("fileType"))
            metadata_text = _to_text(request.form.get("metadata"))
            metadata = {}
            if metadata_text:
                metadata = json.loads(metadata_text)
                if not isinstance(metadata, dict):
                    raise RuntimeError("metadata should be an object")
            file_bytes = file_obj.read()
        except Exception as error:
            return make_json_response(-1, message=str(error)), 400

        def action(db):
            with closing(db.cursor(row_factory=dict_row)) as cursor:
                internal_fap = _get_internal_fap_by_id(cursor, file_access_point_id)
                if internal_fap is None:
                    raise RuntimeError(f"smb/internal file access point not found: {file_access_point_id}")
                table_name = _ensure_file_table(cursor, file_access_point_id)
                fap_smb_external = _get_fap_smb_external(internal_fap)
                file_id = _create_file_id()
                file_path = _get_file_path_storage(file_id, file_name, _get_storage_folder_depth(internal_fap))
                file_path_external = _to_file_external_path(internal_fap, file_path)
                folder_path_external, _file_name_storage = split_parent_and_name(file_path_external)
                _ensure_internal_dirs(internal_fap, fap_smb_external)
                smb_connection_manager.ensure_dir(
                    str(fap_smb_external["fileAccessPointId"]),
                    fap_smb_external["metadata"],
                    folder_path_external,
                )
                smb_connection_manager.write_file_bytes(
                    str(fap_smb_external["fileAccessPointId"]),
                    fap_smb_external["metadata"],
                    file_path_external,
                    file_bytes,
                )
                cursor.execute(
                    sql.SQL(
                        """
                        insert into {}(
                            fileId,
                            fileName,
                            filePath,
                            fileType,
                            sizeBytes,
                            metadata,
                            updatedAt
                        )
                        values (%s, %s, %s, %s, %s, %s::jsonb, now())
                        """
                    ).format(sql.Identifier(table_name)),
                    (file_id, file_name, file_path, file_type, len(file_bytes), json.dumps(metadata)),
                )
                file_info = _get_file_by_id_db(cursor, table_name, file_id)
                metadata_backup_path = _write_metadata_backup(
                    internal_fap,
                    fap_smb_external,
                    {
                        "operation": "upload",
                        "fileAccessPointId": file_access_point_id,
                        "file": file_info,
                    },
                )
                return {
                    "fileAccessPointId": file_access_point_id,
                    "file": file_info,
                    "metadataBackupPath": metadata_backup_path,
                }

        try:
            return make_json_response(0, data=run_in_transaction(action))
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.get("/smb-internal-file-access-point/file/download")
    @app.post("/smb-internal-file-access-point/file/download")
    def smb_internal_file_download():
        if not has_request_permission("R"):
            return make_json_response(-1, message="read permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId") or request.args.get("fileAccessPointId")).lower()
        file_id = _to_text(body.get("fileId") or request.args.get("fileId"))
        if not file_access_point_id or not file_id:
            return make_json_response(-1, message="fileAccessPointId and fileId are required"), 400

        def action(db):
            with closing(db.cursor(row_factory=dict_row)) as cursor:
                internal_fap = _get_internal_fap_by_id(cursor, file_access_point_id)
                if internal_fap is None:
                    raise RuntimeError(f"smb/internal file access point not found: {file_access_point_id}")
                file_info = _get_file_by_id_db(cursor, _get_file_access_point_table_name(file_access_point_id), file_id)
                if file_info is None:
                    raise RuntimeError(f"file not found: {file_id}")
                fap_smb_external = _get_fap_smb_external(internal_fap)
                file_path_external = _to_file_external_path(internal_fap, file_info["filePath"])
                file_bytes = smb_connection_manager.read_file_bytes(
                    str(fap_smb_external["fileAccessPointId"]),
                    fap_smb_external["metadata"],
                    file_path_external,
                )
                return file_info, file_bytes

        try:
            file_info, file_bytes = run_in_transaction(action)
            return send_file(
                BytesIO(file_bytes),
                as_attachment=True,
                download_name=file_info["fileName"],
                mimetype=file_info["fileType"] or "application/octet-stream",
            )
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/smb-internal-file-access-point/file/move")
    def smb_internal_file_move():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        try:
            body = request.get_json(silent=True) or {}
            file_access_point_id = _to_text(body.get("fileAccessPointId")).lower()
            file_id = _to_text(body.get("fileId"))
            file_name_next = _normalize_file_name(body.get("fileNameNext"))
            if not file_access_point_id or not file_id:
                return make_json_response(-1, message="fileAccessPointId and fileId are required"), 400
        except Exception as error:
            return make_json_response(-1, message=str(error)), 400

        def action(db):
            with closing(db.cursor(row_factory=dict_row)) as cursor:
                internal_fap = _get_internal_fap_by_id(cursor, file_access_point_id)
                if internal_fap is None:
                    raise RuntimeError(f"smb/internal file access point not found: {file_access_point_id}")
                table_name = _get_file_access_point_table_name(file_access_point_id)
                file_info = _get_file_by_id_db(cursor, table_name, file_id)
                if file_info is None:
                    raise RuntimeError(f"file not found: {file_id}")
                fap_smb_external = _get_fap_smb_external(internal_fap)
                file_path_next = _get_file_path_storage_for_rename(file_info["filePath"], file_id, file_name_next)
                source_path_external = _to_file_external_path(internal_fap, file_info["filePath"])
                target_path_external = _to_file_external_path(internal_fap, file_path_next)
                target_folder_path_external, _target_name = split_parent_and_name(target_path_external)
                smb_connection_manager.ensure_dir(
                    str(fap_smb_external["fileAccessPointId"]),
                    fap_smb_external["metadata"],
                    target_folder_path_external,
                )
                if source_path_external != target_path_external:
                    smb_connection_manager.move_file(
                        str(fap_smb_external["fileAccessPointId"]),
                        fap_smb_external["metadata"],
                        source_path_external,
                        target_path_external,
                    )
                try:
                    cursor.execute(
                        sql.SQL(
                            """
                            update {}
                            set
                                fileName = %s,
                                filePath = %s,
                                updatedAt = now()
                            where fileId = %s and isDeleted = false
                            """
                        ).format(sql.Identifier(table_name)),
                        (file_name_next, file_path_next, file_id),
                    )
                    if cursor.rowcount != 1:
                        raise RuntimeError(f"file row update failed: {file_id}")
                    file_info_next = _get_file_by_id_db(cursor, table_name, file_id)
                except Exception:
                    if source_path_external != target_path_external:
                        smb_connection_manager.move_file(
                            str(fap_smb_external["fileAccessPointId"]),
                            fap_smb_external["metadata"],
                            target_path_external,
                            source_path_external,
                        )
                    raise
                return {"file": file_info_next}

        try:
            return make_json_response(0, data=run_in_transaction(action))
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/smb-internal-file-access-point/file/storage/rebalance")
    def smb_internal_file_storage_rebalance():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        try:
            body = request.get_json(silent=True) or {}
            file_access_point_id = _to_text(body.get("fileAccessPointId")).lower()
            max_files_per_folder = max(1, int(body.get("maxFilesPerFolder") or 1000))
            max_depth = max(1, min(6, int(body.get("maxDepth") or 6)))
            limit = max(1, min(1000, int(body.get("limit") or 100)))
            is_dry_run = _to_bool(body.get("isDryRun"), default=True)
            if not file_access_point_id:
                return make_json_response(-1, message="fileAccessPointId is required"), 400
        except Exception as error:
            return make_json_response(-1, message=str(error)), 400

        def action(db):
            with closing(db.cursor(row_factory=dict_row)) as cursor:
                internal_fap = _get_internal_fap_by_id(cursor, file_access_point_id)
                if internal_fap is None:
                    raise RuntimeError(f"smb/internal file access point not found: {file_access_point_id}")
                table_name = _ensure_file_table(cursor, file_access_point_id)
                cursor.execute(
                    sql.SQL(
                        """
                        select
                            fileId,
                            fileName,
                            filePath,
                            fileType,
                            sizeBytes,
                            metadata,
                            isDeleted,
                            createdAt,
                            createAtTimeZone,
                            updatedAt,
                            updateAtTimeZone,
                            deletedAt
                        from {}
                        where isDeleted = false
                        order by fileId asc
                        """
                    ).format(sql.Identifier(table_name))
                )
                file_list = [_row_to_file(row) for row in cursor.fetchall() or []]
                folder_depth = _get_storage_folder_depth_for_count(file_list, max_files_per_folder, max_depth)
                change_list = []
                for file_info in file_list:
                    file_path_current = _normalize_file_path_storage(file_info["filePath"])
                    file_path_next = _get_file_path_storage(file_info["fileId"], file_info["fileName"], folder_depth)
                    if file_path_current == file_path_next:
                        continue
                    change_list.append(
                        {
                            "fileId": file_info["fileId"],
                            "fileName": file_info["fileName"],
                            "filePathBefore": file_path_current,
                            "filePathAfter": file_path_next,
                        }
                    )

                if is_dry_run:
                    return {
                        "fileAccessPointId": file_access_point_id,
                        "isDryRun": True,
                        "folderDepth": folder_depth,
                        "maxFilesPerFolder": max_files_per_folder,
                        "changeCount": len(change_list),
                        "items": change_list[:limit],
                    }

                fap_smb_external = _get_fap_smb_external(internal_fap)
                moved_list = []
                for item in change_list[:limit]:
                    source_path_external = _to_file_external_path(internal_fap, item["filePathBefore"])
                    target_path_external = _to_file_external_path(internal_fap, item["filePathAfter"])
                    target_folder_path_external, _target_name = split_parent_and_name(target_path_external)
                    smb_connection_manager.ensure_dir(
                        str(fap_smb_external["fileAccessPointId"]),
                        fap_smb_external["metadata"],
                        target_folder_path_external,
                    )
                    smb_connection_manager.move_file(
                        str(fap_smb_external["fileAccessPointId"]),
                        fap_smb_external["metadata"],
                        source_path_external,
                        target_path_external,
                    )
                    cursor.execute(
                        sql.SQL(
                            """
                            update {}
                            set
                                filePath = %s,
                                updatedAt = now()
                            where fileId = %s and isDeleted = false
                            """
                        ).format(sql.Identifier(table_name)),
                        (item["filePathAfter"], item["fileId"]),
                    )
                    moved_list.append(item)

                if internal_fap.get("sourceType") == "database":
                    metadata_next = dict(internal_fap.get("metadata") or {})
                    metadata_next["storageFolderDepth"] = folder_depth
                    cursor.execute(
                        """
                        update smb_internal_file_access_point
                        set metadata = %s::jsonb, updatedAt = now()
                        where fileAccessPointId = %s
                        """,
                        (json.dumps(metadata_next), file_access_point_id),
                    )

                metadata_backup_path = _write_metadata_backup(
                    internal_fap,
                    fap_smb_external,
                    {
                        "operation": "storage_rebalance",
                        "fileAccessPointId": file_access_point_id,
                        "folderDepth": folder_depth,
                        "maxFilesPerFolder": max_files_per_folder,
                        "movedFiles": moved_list,
                    },
                )
                return {
                    "fileAccessPointId": file_access_point_id,
                    "isDryRun": False,
                    "folderDepth": folder_depth,
                    "maxFilesPerFolder": max_files_per_folder,
                    "changeCount": len(change_list),
                    "movedCount": len(moved_list),
                    "remainingCount": max(0, len(change_list) - len(moved_list)),
                    "items": moved_list,
                    "metadataBackupPath": metadata_backup_path,
                }

        try:
            return make_json_response(0, data=run_in_transaction(action))
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500

    @app.post("/smb-internal-file-access-point/file/delete")
    def smb_internal_file_delete():
        if not has_request_permission("W"):
            return make_json_response(-1, message="write permission required"), 403
        body = request.get_json(silent=True) or {}
        file_access_point_id = _to_text(body.get("fileAccessPointId")).lower()
        file_id = _to_text(body.get("fileId"))
        if not file_access_point_id or not file_id:
            return make_json_response(-1, message="fileAccessPointId and fileId are required"), 400

        def action(db):
            with closing(db.cursor(row_factory=dict_row)) as cursor:
                internal_fap = _get_internal_fap_by_id(cursor, file_access_point_id)
                if internal_fap is None:
                    raise RuntimeError(f"smb/internal file access point not found: {file_access_point_id}")
                table_name = _get_file_access_point_table_name(file_access_point_id)
                file_info = _get_file_by_id_db(cursor, table_name, file_id)
                if file_info is None:
                    raise RuntimeError(f"file not found: {file_id}")
                fap_smb_external = _get_fap_smb_external(internal_fap)
                file_path_external = _to_file_external_path(internal_fap, file_info["filePath"])
                smb_connection_manager.remove_file(
                    str(fap_smb_external["fileAccessPointId"]),
                    fap_smb_external["metadata"],
                    file_path_external,
                )
                cursor.execute(
                    sql.SQL(
                        """
                        update {}
                        set
                            isDeleted = true,
                            deletedAt = now(),
                            updatedAt = now()
                        where fileId = %s and isDeleted = false
                        """
                    ).format(sql.Identifier(table_name)),
                    (file_id,),
                )
                file_info_deleted = _get_file_by_id_db(cursor, table_name, file_id, include_deleted=True)
                metadata_backup_path = _write_metadata_backup(
                    internal_fap,
                    fap_smb_external,
                    {
                        "operation": "delete",
                        "fileAccessPointId": file_access_point_id,
                        "file": file_info_deleted,
                    },
                )
                return {"file": file_info_deleted, "metadataBackupPath": metadata_backup_path}

        try:
            return make_json_response(0, data=run_in_transaction(action))
        except Exception as error:
            return make_json_response(-1, message=str(error)), 500
