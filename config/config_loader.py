from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


class UniqueKeyLoader(yaml.SafeLoader):
    pass


def _construct_mapping_without_duplicate_keys(loader: UniqueKeyLoader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            line_number = key_node.start_mark.line + 1
            column_number = key_node.start_mark.column + 1
            raise ValueError(f"duplicate config key '{key}' at {loader.name}:{line_number}:{column_number}")
        value = loader.construct_object(value_node, deep=deep)
        mapping[key] = value
    return mapping


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_mapping_without_duplicate_keys,
)


def _deep_merge(base_value: Any, override_value: Any):
    if isinstance(base_value, dict) and isinstance(override_value, dict):
        merged = dict(base_value)
        for key, value in override_value.items():
            merged[key] = _deep_merge(merged.get(key), value)
        return merged
    return override_value if override_value is not None else base_value


def load_yaml_config_file(file_path: Path):
    if not file_path.is_file():
        return {}
    with file_path.open("r", encoding="utf-8") as file:
        loader = UniqueKeyLoader(file)
        loader.name = str(file_path)
        try:
            data = loader.get_single_data() or {}
        finally:
            loader.dispose()
    if not isinstance(data, dict):
        return {}
    return data


def load_project_config(dir_base: Path):
    config_dir = dir_base / "config"
    default_config = load_yaml_config_file(config_dir / "config.yaml")
    local_config = load_yaml_config_file(config_dir / "config.0.yaml")
    merged = _deep_merge(default_config, local_config)
    local_file_access_point_smb_external = (
        local_config.get("file_access_point_smb_external")
        or local_config.get("file_access_points")
    )
    if isinstance(local_file_access_point_smb_external, dict) and len(local_file_access_point_smb_external) > 0:
        merged["file_access_point_smb_external"] = local_file_access_point_smb_external
    local_file_access_point_smb_internal = local_config.get("file_access_point_smb_internal")
    if isinstance(local_file_access_point_smb_internal, dict) and len(local_file_access_point_smb_internal) > 0:
        merged["file_access_point_smb_internal"] = local_file_access_point_smb_internal
    local_databases = local_config.get("config_databases")
    if isinstance(local_databases, dict) and len(local_databases) > 0:
        merged["config_databases"] = local_databases
    if not isinstance(merged.get("config_databases"), dict):
        merged["config_databases"] = {}
    if not isinstance(merged.get("file_access_point_smb_external"), dict):
        legacy_file_access_points = merged.get("file_access_points")
        merged["file_access_point_smb_external"] = legacy_file_access_points if isinstance(legacy_file_access_points, dict) else {}
    if not isinstance(merged.get("file_access_point_smb_internal"), dict):
        merged["file_access_point_smb_internal"] = {}
    return merged
