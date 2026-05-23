from __future__ import annotations

import json
import os
import random
import string
import sys
import time
from contextlib import closing
from pathlib import Path
from typing import Any

from psycopg import connect
from psycopg.rows import dict_row

_CURRENT_DIR = Path(__file__).resolve().parent
_DIR_BASE = Path(os.environ.get("DIR_BASE", str(_CURRENT_DIR.parent))).resolve()
_CONFIG_DIR = _DIR_BASE / "config"
if str(_CONFIG_DIR) not in sys.path:
    sys.path.insert(0, str(_CONFIG_DIR))

from config_loader import load_project_config


def get_dir_base() -> Path:
    current_dir = Path(__file__).resolve().parent
    default_base = current_dir.parent
    return Path(os.environ.get("DIR_BASE", str(default_base))).resolve()


def _normalize_db_item(item_key: str, raw_item: dict[str, Any]):
    return {
        "key": str(item_key or "").strip(),
        "label": str(raw_item.get("label") or raw_item.get("name") or item_key).strip(),
        "host": str(raw_item.get("ip") or raw_item.get("host") or "127.0.0.1").strip(),
        "port": int(raw_item.get("port") or 5432),
        "database_name": str(raw_item.get("database_name") or "postgres").strip(),
        "username": str(raw_item.get("username") or "postgres").strip(),
        "password": str(raw_item.get("password") or "postgres"),
    }


def load_database_config():
    config = load_project_config(get_dir_base())
    raw_databases = config.get("config_databases") or {}
    if not raw_databases:
        return _normalize_db_item("default", {})
    first_key = list(raw_databases.keys())[0]
    first_item = raw_databases[first_key]
    if not isinstance(first_item, dict):
        return _normalize_db_item("default", {})
    return _normalize_db_item(str(first_key), first_item)


database_config = load_database_config()


def ensure_database_exists():
    admin_db_config = {
        "host": database_config["host"],
        "port": database_config["port"],
        "dbname": os.environ.get("DB_BOOTSTRAP_NAME", "postgres"),
        "user": database_config["username"],
        "password": database_config["password"],
    }
    target_database_name = str(database_config["database_name"])
    with connect(**admin_db_config, autocommit=True) as db:
        with closing(db.cursor()) as cursor:
            cursor.execute("select 1 from pg_database where datname = %s", (target_database_name,))
            if cursor.fetchone():
                return
            cursor.execute(f'create database "{target_database_name}"')


def _to_runtime_db_config():
    return {
        "host": database_config["host"],
        "port": database_config["port"],
        "dbname": database_config["database_name"],
        "user": database_config["username"],
        "password": database_config["password"],
    }


def run_in_transaction(action):
    db = None
    try:
        db = connect(**_to_runtime_db_config())
        db.autocommit = False
        result = action(db)
        db.commit()
        return result
    except Exception:
        if db is not None:
            db.rollback()
        raise
    finally:
        if db is not None:
            db.close()


def init_schema():
    init_sql_file = get_dir_base() / "database" / "init_db.sql"
    sql_text = init_sql_file.read_text(encoding="utf-8")

    def action(db):
        with closing(db.cursor()) as cursor:
            cursor.execute(sql_text)
        return True

    run_in_transaction(action)


def create_file_access_point_id():
    now_ms = int(time.time() * 1000)
    random_part = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(4))
    return f"fap_{now_ms}_{random_part}"


def list_db_file_access_points():
    def action(db):
        with closing(db.cursor(row_factory=dict_row)) as cursor:
            cursor.execute(
                """
                select
                    fileAccessPointId,
                    name,
                    metadata,
                    createdAt,
                    updatedAt
                from smb_file_access_point
                order by createdAt asc
                """
            )
            row_list = cursor.fetchall() or []
            return [
                {
                    "fileAccessPointId": str(row["fileaccesspointid"]),
                    "name": str(row["name"] or ""),
                    "metadata": row["metadata"] if isinstance(row["metadata"], dict) else {},
                    "sourceType": "database",
                    "isDeletable": True,
                    "createdAt": str(row["createdat"] or ""),
                    "updatedAt": str(row["updatedat"] or ""),
                }
                for row in row_list
            ]

    return run_in_transaction(action)


def upsert_db_file_access_point(file_access_point_id: str, name: str, metadata: dict[str, Any]):
    normalized_id = str(file_access_point_id or "").strip()
    normalized_name = str(name or "").strip()
    if not normalized_id:
        normalized_id = create_file_access_point_id()
    if not normalized_name:
        normalized_name = normalized_id

    def action(db):
        with closing(db.cursor()) as cursor:
            cursor.execute(
                """
                insert into smb_file_access_point(
                    fileAccessPointId,
                    name,
                    metadata,
                    updatedAt
                )
                values (%s, %s, %s::jsonb, now())
                on conflict (fileAccessPointId) do update set
                    name = excluded.name,
                    metadata = excluded.metadata,
                    updatedAt = now()
                """,
                (
                    normalized_id,
                    normalized_name,
                    json.dumps(metadata or {}),
                ),
            )
        return {
            "fileAccessPointId": normalized_id,
            "name": normalized_name,
        }

    return run_in_transaction(action)


def delete_db_file_access_point(file_access_point_id: str):
    normalized_id = str(file_access_point_id or "").strip()
    if not normalized_id:
        raise RuntimeError("fileAccessPointId is required")

    def action(db):
        with closing(db.cursor()) as cursor:
            cursor.execute(
                """
                delete from smb_file_access_point
                where fileAccessPointId = %s
                """,
                (normalized_id,),
            )
        return {"fileAccessPointId": normalized_id}

    return run_in_transaction(action)
