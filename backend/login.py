from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path
from typing import Any

from flask import make_response, request

_CURRENT_DIR = Path(__file__).resolve().parent
_DIR_BASE = Path(os.environ.get("DIR_BASE", str(_CURRENT_DIR.parent))).resolve()
_CONFIG_DIR = _DIR_BASE / "config"
if str(_CONFIG_DIR) not in sys.path:
    sys.path.insert(0, str(_CONFIG_DIR))

from config_loader import load_project_config

AUTH_COOKIE_NAME = "file_access_smb_auth"
AUTH_TOKEN_STORE_FILE = _DIR_BASE / ".runtime" / "auth_tokens.txt"


def _to_text(value: Any):
    return str(value or "").strip()


def _load_auth_config():
    project_config = load_project_config(_DIR_BASE)
    auth_config = project_config.get("auth") if isinstance(project_config.get("auth"), dict) else {}
    login_username = _to_text(auth_config.get("login_username")) or "example"
    login_password = str(auth_config.get("login_password") or "12345678")
    zip_encryption_key = _to_text(auth_config.get("zip_encryption_key")) or "20260501"
    return {
        "login_username": login_username,
        "login_password": login_password,
        "zip_encryption_key": zip_encryption_key,
    }


_auth_config = _load_auth_config()
LOGIN_USERNAME = _auth_config["login_username"]
LOGIN_PASSWORD = _auth_config["login_password"]
ZIP_ENCRYPTION_KEY = _auth_config["zip_encryption_key"]
_auth_token_set: set[str] = set()


def _load_persisted_tokens():
    if not AUTH_TOKEN_STORE_FILE.is_file():
        return
    try:
        for line in AUTH_TOKEN_STORE_FILE.read_text(encoding="utf-8").splitlines():
            token = _to_text(line)
            if token:
                _auth_token_set.add(token)
    except OSError:
        return


def _persist_token(token: str):
    normalized = _to_text(token)
    if not normalized:
        return
    try:
        AUTH_TOKEN_STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing_tokens = set()
        if AUTH_TOKEN_STORE_FILE.is_file():
            existing_tokens = {
                _to_text(line)
                for line in AUTH_TOKEN_STORE_FILE.read_text(encoding="utf-8").splitlines()
                if _to_text(line)
            }
        existing_tokens.add(normalized)
        AUTH_TOKEN_STORE_FILE.write_text(
            "\n".join(sorted(existing_tokens)) + "\n",
            encoding="utf-8",
        )
    except OSError:
        return


_load_persisted_tokens()


def issue_auth_token():
    token = secrets.token_urlsafe(24)
    _auth_token_set.add(token)
    _persist_token(token)
    return token


def validate_auth_token(token: str):
    normalized = _to_text(token)
    if not normalized:
        return False
    return normalized in _auth_token_set


def extract_request_auth_token():
    auth_header = _to_text(request.headers.get("Authorization"))
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    token_from_header = _to_text(request.headers.get("X-Auth-Token"))
    if token_from_header:
        return token_from_header
    token_from_query = _to_text(request.args.get("authToken"))
    if token_from_query:
        return token_from_query
    token_from_cookie = _to_text(request.cookies.get(AUTH_COOKIE_NAME))
    if token_from_cookie:
        return token_from_cookie
    return ""


def is_request_authorized():
    return validate_auth_token(extract_request_auth_token())


def _is_secure_request():
    forwarded_proto = _to_text(request.headers.get("X-Forwarded-Proto")).lower()
    if forwarded_proto:
        return forwarded_proto == "https"
    return request.is_secure


def attach_auth_token_cookie(response, token: str):
    resp = make_response(response)
    resp.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        httponly=True,
        samesite="Lax",
        secure=_is_secure_request(),
        path="/",
        max_age=60 * 60 * 24 * 30,
    )
    return resp


def clear_auth_token_cookie(response):
    resp = make_response(response)
    resp.set_cookie(
        AUTH_COOKIE_NAME,
        "",
        httponly=True,
        samesite="Lax",
        secure=_is_secure_request(),
        path="/",
        max_age=0,
    )
    return resp


def register_login_routes(app, make_json_response):
    @app.post("/login")
    @app.post("/api/login")
    def login_with_credentials():
        body = request.get_json(silent=True) or {}
        username = _to_text(body.get("username"))
        password = str(body.get("password") or "")
        if username != LOGIN_USERNAME or password != LOGIN_PASSWORD:
            return make_json_response(-1, message="invalid username or password"), 401
        token = issue_auth_token()
        return attach_auth_token_cookie(
            make_json_response(
                0,
                data={
                    "token": token,
                    "username": LOGIN_USERNAME,
                },
            ),
            token,
        )

    @app.post("/login/token")
    @app.post("/api/login/token")
    def login_with_token():
        body = request.get_json(silent=True) or {}
        token = _to_text(body.get("token"))
        if not validate_auth_token(token):
            return make_json_response(-1, message="invalid token"), 401
        return attach_auth_token_cookie(
            make_json_response(
                0,
                data={
                    "token": token,
                    "username": LOGIN_USERNAME,
                },
            ),
            token,
        )

    @app.get("/login/check")
    @app.get("/api/login/check")
    def login_check():
        if not is_request_authorized():
            return make_json_response(-1, message="unauthorized"), 401
        return make_json_response(
            0,
            data={
                "isLoggedIn": True,
                "username": LOGIN_USERNAME,
            },
        )
