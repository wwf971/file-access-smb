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
- `file_access_points`: static SMB file access points loaded from local config

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

`file_access_points` example:

```yaml
file_access_points:
  nas:
    host: 192.168.0.7
    username: example_username
    password: example_password
    share: /Data
    path: /
```

Related docs:

- database details: `./database.md`
- file access point behavior: `./file_access_point.md`
