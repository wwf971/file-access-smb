from __future__ import annotations

import os
import secrets
import sys
import json
from pathlib import Path
from typing import Any

import requests
from jwt import PyJWTError, decode, get_unverified_header
from jwt.algorithms import RSAAlgorithm
from flask import make_response, request

_CURRENT_DIR = Path(__file__).resolve().parent
_DIR_BASE = Path(os.environ.get("DIR_BASE", str(_CURRENT_DIR.parent))).resolve()
_CONFIG_DIR = _DIR_BASE / "config"
if str(_CONFIG_DIR) not in sys.path:
    sys.path.insert(0, str(_CONFIG_DIR))

from config_loader import load_project_config

AUTH_COOKIE_NAME = "file_access_smb_auth"
AUTH_TOKEN_STORE_FILE = _DIR_BASE / ".runtime" / "auth_tokens.txt"
DEFAULT_PERMISSION = "R"
DEFAULT_ZIP_TIMEOUT_SECONDS = 60
AUTH_TYPE_INTERNAL = "internal"
AUTH_TYPE_AUTH_JWT = "@wwf971/auth-jwt"


def _to_text(value: Any):
    return str(value or "").strip()


def _normalize_permission(value: Any):
    raw_text = _to_text(value).upper()
    permission_text = "".join([char for char in raw_text if char in ("R", "W")])
    if not permission_text:
        return DEFAULT_PERMISSION
    return permission_text


def _normalize_auth_user(raw_user: Any, fallback_username: str = ""):
    if not isinstance(raw_user, dict):
        return None
    username = _to_text(raw_user.get("username")) or _to_text(fallback_username)
    password = str(raw_user.get("password") or "")
    if not username or not password:
        return None
    zip_timeout_raw = raw_user.get("zip_timeout")
    try:
        zip_timeout_seconds = int(zip_timeout_raw)
    except (TypeError, ValueError):
        zip_timeout_seconds = DEFAULT_ZIP_TIMEOUT_SECONDS
    return {
        "username": username,
        "password": password,
        "permission": _normalize_permission(raw_user.get("permission")),
        "zip_encryption_key": _to_text(raw_user.get("zip_encryption_key")),
        "zip_timeout": max(1, zip_timeout_seconds),
    }


def _normalize_auth_provider(auth_config: Any):
    if not isinstance(auth_config, dict):
        auth_config = {}
    auth_type = _to_text(auth_config.get("type")) or AUTH_TYPE_INTERNAL
    ip = _to_text(auth_config.get("ip")) or _to_text(auth_config.get("host")) or "127.0.0.1"
    port = int(auth_config.get("port") or 9531)
    base_url = _to_text(auth_config.get("base_url") or auth_config.get("baseUrl"))
    if not base_url:
        base_url = f"http://{ip}:{port}"
    return {
        "type": auth_type,
        "baseUrl": base_url.rstrip("/"),
        "timeout": max(1, int(auth_config.get("timeout") or 20)),
        "service_id": _to_text(auth_config.get("service_id") or auth_config.get("serviceId")),
        "read_permission_code": auth_config.get("read_permission_code") or auth_config.get("readPermissionCode"),
        "write_permission_code": auth_config.get("write_permission_code") or auth_config.get("writePermissionCode"),
        "default_permission": _normalize_permission(auth_config.get("default_permission") or auth_config.get("defaultPermission") or "RW"),
    }


def _load_auth_config():
    project_config = load_project_config(_DIR_BASE)
    auth_config = project_config.get("auth")
    auth_provider = _normalize_auth_provider(auth_config)
    users = []
    if isinstance(auth_config, dict):
        raw_users = auth_config.get("users")
        if isinstance(raw_users, list):
            for raw_user in raw_users:
                user = _normalize_auth_user(raw_user)
                if user:
                    users.append(user)
        if not users:
            legacy_user = _normalize_auth_user(
                {
                    "username": auth_config.get("login_username"),
                    "password": auth_config.get("login_password"),
                    "permission": auth_config.get("permission", "RW"),
                    "zip_encryption_key": auth_config.get("zip_encryption_key"),
                    "zip_timeout": auth_config.get("zip_timeout"),
                },
                "example",
            )
            if legacy_user:
                users.append(legacy_user)
    elif isinstance(auth_config, list):
        for raw_entry in auth_config:
            if not isinstance(raw_entry, dict):
                continue
            fallback_username = ""
            if len(raw_entry) == 1:
                fallback_username = _to_text(next(iter(raw_entry.keys())))
            user = _normalize_auth_user(raw_entry, fallback_username)
            if user:
                users.append(user)
    if not users:
        users.append(
            {
                "username": "example",
                "password": "12345678",
                "permission": "RW",
                "zip_encryption_key": "",
                "zip_timeout": DEFAULT_ZIP_TIMEOUT_SECONDS,
            }
        )
    return {"users": users, "provider": auth_provider}


_auth_config = _load_auth_config()
AUTH_USERS = _auth_config["users"]
AUTH_PROVIDER = _auth_config["provider"]
_auth_user_by_username = {user["username"]: user for user in AUTH_USERS}
_auth_token_user_by_token: dict[str, str] = {}
_temporary_token_user_by_token: dict[str, str] = {}


def _load_persisted_tokens():
    if not AUTH_TOKEN_STORE_FILE.is_file():
        return
    try:
        for line in AUTH_TOKEN_STORE_FILE.read_text(encoding="utf-8").splitlines():
            token = _to_text(line)
            if not token:
                continue
            if "\t" in token:
                token_text, username = token.split("\t", 1)
                if token_text and username in _auth_user_by_username:
                    _auth_token_user_by_token[token_text] = username
                continue
            first_user = AUTH_USERS[0]["username"]
            _auth_token_user_by_token[token] = first_user
    except OSError:
        return


def _persist_token(token: str, username: str):
    normalized = _to_text(token)
    normalized_username = _to_text(username)
    if not normalized or not normalized_username:
        return
    try:
        AUTH_TOKEN_STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing_tokens = {}
        if AUTH_TOKEN_STORE_FILE.is_file():
            for line in AUTH_TOKEN_STORE_FILE.read_text(encoding="utf-8").splitlines():
                line_text = _to_text(line)
                if not line_text:
                    continue
                if "\t" in line_text:
                    token_text, token_username = line_text.split("\t", 1)
                    if token_text and token_username in _auth_user_by_username:
                        existing_tokens[token_text] = token_username
        existing_tokens[normalized] = normalized_username
        AUTH_TOKEN_STORE_FILE.write_text(
            "\n".join([f"{token}\t{user}" for token, user in sorted(existing_tokens.items())]) + "\n",
            encoding="utf-8",
        )
    except OSError:
        return


_load_persisted_tokens()


def issue_auth_token(username: str):
    token = secrets.token_urlsafe(24)
    _auth_token_user_by_token[token] = username
    _persist_token(token, username)
    return token


def is_auth_jwt_enabled():
    return AUTH_PROVIDER.get("type") == AUTH_TYPE_AUTH_JWT


def _auth_jwt_post(path: str, body: dict[str, Any]):
    response = requests.post(
        f"{AUTH_PROVIDER['baseUrl']}{path}",
        json=body,
        timeout=AUTH_PROVIDER["timeout"],
    )
    response.raise_for_status()
    data = response.json()
    if int(data.get("code", -1)) != 0:
        raise RuntimeError(data.get("message") or f"auth-jwt request failed: {path}")
    return data.get("data") or {}


def _auth_jwt_login(username: str, password: str):
    return _auth_jwt_post("/api/token", {"username": username, "password": password})


def _auth_jwt_logout(token: str):
    return _auth_jwt_post("/api/logout", {"session_token": token})


def _auth_jwt_verify_token(token: str):
    token_text = _to_text(token)
    if not token_text:
        return None
    try:
        data = _auth_jwt_post("/api/verify_jwt_token", {"session_token": token_text})
    except Exception:
        return None
    if data.get("valid") is False:
        return None
    username = _to_text(data.get("username")) or "external"
    return {
        "username": username,
        "permission": AUTH_PROVIDER["default_permission"],
        "zip_encryption_key": "",
        "zip_timeout": DEFAULT_ZIP_TIMEOUT_SECONDS,
    }


def _auth_jwt_issue_temporary_token(token: str):
    return _auth_jwt_post("/api/temporary-token", {"token": token})


def _auth_jwt_verify_temporary_token(token: str):
    token_text = _to_text(token)
    if not token_text:
        return None
    try:
        header = get_unverified_header(token_text)
        key_id = _to_text(header.get("kid"))
        response = requests.get(
            f"{AUTH_PROVIDER['baseUrl']}/.well-known/jwks.json",
            timeout=AUTH_PROVIDER["timeout"],
        )
        response.raise_for_status()
        key_items = response.json().get("keys") or []
        key_item = None
        for item in key_items:
            if key_id and _to_text(item.get("kid")) == key_id:
                key_item = item
                break
        if key_item is None and key_items and not key_id:
            key_item = key_items[0]
        if key_item is None:
            return None
        signing_key = RSAAlgorithm.from_jwk(json.dumps(key_item))
        claims = decode(token_text, signing_key, algorithms=[_to_text(key_item.get("alg")) or "RS256"])
    except (PyJWTError, requests.RequestException, ValueError, TypeError):
        return _auth_jwt_verify_token(token_text)
    if claims.get("token_type") != "temp":
        return None
    return {
        "username": _temporary_token_user_by_token.get(token_text) or "external",
        "permission": AUTH_PROVIDER["default_permission"],
        "zip_encryption_key": "",
        "zip_timeout": DEFAULT_ZIP_TIMEOUT_SECONDS,
    }


def validate_auth_token(token: str):
    if is_auth_jwt_enabled():
        return _auth_jwt_verify_temporary_token(token) is not None
    normalized = _to_text(token)
    if not normalized:
        return False
    return normalized in _auth_token_user_by_token


def get_user_by_token(token: str):
    if is_auth_jwt_enabled():
        return _auth_jwt_verify_temporary_token(token)
    username = _auth_token_user_by_token.get(_to_text(token))
    if not username:
        return None
    return _auth_user_by_username.get(username)


def get_request_user():
    return get_user_by_token(extract_request_auth_token())


def get_request_permission():
    user = get_request_user()
    return _normalize_permission(user.get("permission") if user else "")


def has_request_permission(permission_char: str):
    permission = get_request_permission()
    return _to_text(permission_char).upper() in permission


def get_request_zip_encryption_key():
    user = get_request_user()
    if not user:
        return ""
    return _to_text(user.get("zip_encryption_key"))


def get_request_zip_timeout_seconds():
    user = get_request_user()
    try:
        return max(1, int(user.get("zip_timeout"))) if user else DEFAULT_ZIP_TIMEOUT_SECONDS
    except (TypeError, ValueError):
        return DEFAULT_ZIP_TIMEOUT_SECONDS


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
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        if isinstance(body, dict):
            token_from_body = _to_text(body.get("authToken"))
            if token_from_body:
                return token_from_body
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
    def login_with_credentials():
        body = request.get_json(silent=True) or {}
        username = _to_text(body.get("username"))
        password = str(body.get("password") or "")
        if is_auth_jwt_enabled():
            try:
                data = _auth_jwt_login(username, password)
            except Exception as error:
                return make_json_response(-1, message=str(error)), 401
            token = _to_text(data.get("token"))
            return attach_auth_token_cookie(
                make_json_response(
                    0,
                    data={
                        "token": token,
                        "username": _to_text(data.get("username")) or username,
                        "permission": AUTH_PROVIDER["default_permission"],
                    },
                ),
                token,
            )
        user = _auth_user_by_username.get(username)
        if not user or password != user["password"]:
            return make_json_response(-1, message="invalid username or password"), 401
        token = issue_auth_token(username)
        return attach_auth_token_cookie(
            make_json_response(
                0,
                data={
                    "token": token,
                    "username": username,
                    "permission": user["permission"],
                },
            ),
            token,
        )

    @app.post("/login/token")
    def login_with_token():
        body = request.get_json(silent=True) or {}
        token = _to_text(body.get("token"))
        user = _auth_jwt_verify_token(token) if is_auth_jwt_enabled() else get_user_by_token(token)
        if not user:
            return make_json_response(-1, message="invalid token"), 401
        return attach_auth_token_cookie(
            make_json_response(
                0,
                data={
                    "token": token,
                    "username": user["username"],
                    "permission": user["permission"],
                },
            ),
            token,
        )

    @app.post("/login/temporary-token")
    def issue_temporary_token():
        body = request.get_json(silent=True) or {}
        token = _to_text(body.get("token")) or extract_request_auth_token()
        if not is_auth_jwt_enabled():
            return make_json_response(0, data={"token": token, "expires_at": 9007199254740991})
        user = _auth_jwt_verify_token(token)
        if not user:
            return make_json_response(-1, message="invalid token"), 401
        try:
            data = _auth_jwt_issue_temporary_token(token)
        except Exception as error:
            return make_json_response(-1, message=str(error)), 502
        temporary_token = _to_text(data.get("token"))
        if not temporary_token:
            return make_json_response(-1, message="temporary token was not issued"), 502
        _temporary_token_user_by_token[temporary_token] = user["username"]
        return make_json_response(0, data={"token": temporary_token, "expires_at": int(data.get("expires_at") or 0)})

    @app.post("/logout")
    def logout():
        body = request.get_json(silent=True) or {}
        token = _to_text(body.get("token") or body.get("session_token")) or extract_request_auth_token()
        if is_auth_jwt_enabled() and token:
            try:
                _auth_jwt_logout(token)
            except Exception as error:
                return make_json_response(-1, message=str(error)), 400
        return clear_auth_token_cookie(make_json_response(0))

    @app.get("/login/check")
    @app.post("/login/check")
    def login_check():
        user = get_request_user()
        if not user:
            return make_json_response(-1, message="unauthorized"), 401
        return make_json_response(
            0,
            data={
                "isLoggedIn": True,
                "username": user["username"],
                "permission": user["permission"],
            },
        )
