## Config

The local config will be parsed from two local config files under `/config/`:

- `/config/config.yaml` stores example config data.
- `/config/config.0.yaml` is excluded by `/.gitignore`. and it can be used to store config data when in test environment.

Parse rule:

- a config item will be attempted to be loaded from `/config/config.0.yaml`. if fail, it will be attempted to be loaded from `/config/config.yaml`.

- in other words, local config is fist loaded from `/config.yaml`, and will be updated/overwritten by `/config/config.0.yaml`.

Key sections:

- `auth`: auth mode, login users for internal mode, and auth-jwt endpoint for external mode
- `config_databases`: PostgreSQL targets
- `file_access_point_smb_external`: static SMB external file access points loaded from local config
- `file_access_point_smb_internal`: static SMB internal file access points loaded from local config

`auth` internal example:

```yaml
auth:
  type: internal
  users:
    - username: example_rw
      password: example_password
      permission: RW
      zip_encryption_key: example_zip_key
      zip_timeout: 60
```

`auth.type: internal` keeps the service self-contained. The backend checks users from local config and issues local tokens.

`auth` external example:

```yaml
auth:
  type: "@wwf971/auth-jwt"
  ip: 127.0.0.1
  port: 9531
  service_id: file-access-smb
  read_permission_code: 1
  write_permission_code: 2
  default_permission: RW
```

`auth.type: "@wwf971/auth-jwt"` makes the backend use auth-jwt for login and token verification. The service still keeps its own `R` and `W` permission checks. For now, externally verified users receive `default_permission`. The service permission fields describe the intended auth-jwt service permission mapping.

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
- SMB external file access point behavior: `./file_access_point_smb_external.md`
- SMB internal file access point behavior: `./file_access_point_smb_internal.md`
