from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory
from flask_sock import Sock

from db import database_config, ensure_database_exists, get_dir_base, init_schema
from login import is_request_authorized, register_login_routes, validate_auth_token
from fap_smb_external import register_fap_smb_external_routes
from fap_smb_internal import register_fap_smb_internal_routes


def make_json_response(code: int, data: Any = None, message: str = ""):
    response_data = {"code": code}
    if data is not None:
        response_data["data"] = data
    if message:
        response_data["message"] = message
    return jsonify(response_data)


def get_build_dir():
    return get_dir_base() / "build"


def serve_management_page():
    build_dir = get_build_dir()
    index_file = build_dir / "index.html"
    if index_file.is_file():
        return send_from_directory(build_dir, "index.html")
    return make_json_response(-1, message=f"build not found: {build_dir}"), 404


app = Flask(__name__)
sock = Sock(app)
is_database_bootstrap_ok = False
database_bootstrap_error_text = ""


@app.get("/health/ping")
def health_ping():
    return make_json_response(
        0,
        data={
            "status": "ok",
            "service": "file-access-smb",
            "isDatabaseBootstrapOk": is_database_bootstrap_ok,
            "databaseBootstrapErrorText": database_bootstrap_error_text,
        },
    )


@app.get("/health/database")
def health_database():
    return make_json_response(
        0,
        data={
            "databaseKey": database_config["key"],
            "databaseName": database_config["database_name"],
            "host": database_config["host"],
            "port": database_config["port"],
            "username": database_config["username"],
            "isDatabaseBootstrapOk": is_database_bootstrap_ok,
            "databaseBootstrapErrorText": database_bootstrap_error_text,
        },
    )


register_login_routes(app, make_json_response)
register_fap_smb_external_routes(app, sock, make_json_response, validate_auth_token)
register_fap_smb_internal_routes(app, make_json_response)


@app.before_request
def auth_guard():
    path = str(request.path or "")
    protected_prefixes = (
        "/file-access-point/",
        "/smb-internal-file-access-point/",
        "/health/database",
        "/login/check",
    )
    if not path.startswith(protected_prefixes):
        return None
    if path.startswith("/file-access-point/zip/ws/"):
        return None
    if path in (
        "/login",
        "/login/token",
        "/health/ping",
    ):
        return None
    if is_request_authorized():
        return None
    return make_json_response(-1, message="unauthorized"), 401


@app.errorhandler(404)
def handle_not_found(_error):
    if request.method == "POST":
        return make_json_response(-1, message=f"POST endpoint not found: {request.path}"), 404
    if request.method == "GET":
        return serve_management_page()
    return make_json_response(-1, message=f"endpoint not found: {request.path}"), 404


@app.errorhandler(405)
def handle_method_not_allowed(_error):
    if request.method == "POST":
        return make_json_response(-1, message=f"POST method not allowed: {request.path}"), 405
    return make_json_response(-1, message=f"method not allowed: {request.path}"), 405


@app.get("/", defaults={"resource_path": ""})
@app.get("/<path:resource_path>")
def serve_frontend(resource_path: str):
    build_dir = get_build_dir()
    if resource_path:
        file_path = build_dir / resource_path
        if file_path.is_file():
            return send_from_directory(build_dir, resource_path)
    return serve_management_page()


def bootstrap_app():
    global is_database_bootstrap_ok
    global database_bootstrap_error_text
    try:
        ensure_database_exists()
        init_schema()
        is_database_bootstrap_ok = True
        database_bootstrap_error_text = ""
    except Exception as error:
        is_database_bootstrap_ok = False
        database_bootstrap_error_text = str(error)


if __name__ == "__main__":
    bootstrap_app()
    port = int(os.environ.get("PORT", "9400"))
    app.run(host="0.0.0.0", port=port)
