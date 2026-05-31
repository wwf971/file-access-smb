## Config

The local config will be parsed from two local config files under `/config/`:

- `/config/config.yaml` stores example config data.
- `/config/config.0.yaml` is excluded by `/.gitignore`. and it can be used to store config data when in test environment.

Parse rule:

- a config item will be attempted to be loaded from `/config/config.0.yaml`. if fail, it will be attempted to be loaded from `/config/config.yaml`.

- in other words, local config is fist loaded from `/config.yaml`, and will be updated/overwritten by `/config/config.0.yaml`.

Key sections:

- `auth`: login username/password and zip encryption key
- `config_databases`: PostgreSQL targets
- `file_access_point_smb_external`: static SMB external file access points loaded from local config
- `file_access_point_smb_internal`: static SMB internal file access points loaded from local config

`auth` example:

```yaml
auth:
  login_username: example
  login_password: example_password
  zip_encryption_key: example_zip_key
```

`config_databases` example:

```yaml
config_databases:
  raspi5:
    ip: 192.168.0.5
    port: 5432
    database_name: servier_file_access_point_smb
    username: example_username
    password: example_password
```

`file_access_point_smb_external` example:

```yaml
file_access_point_smb_external:
  nas:
    host: 192.168.0.7
    username: example_username
    password: example_password
    share: /Data
    path: /media/data/
```

`share` names the SMB share. `path` is an optional base folder inside the share. The service normalizes `path`, so `media/data`, `/media/data/`, `\media\data\`, and `//media//data//` are treated as the same base folder.

`file_access_point_smb_internal` example:

```yaml
file_access_point_smb_internal:
  managed-files:
    name: managed-files
    file_access_point_smb_external_info:
      name: nas
    path_root: /file-access-smb-managed
    metadata:
      purpose: example
```

Related docs:

- database details: `./database.md`
- file access point behavior: `./file_access_point.md`
