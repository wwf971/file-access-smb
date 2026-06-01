## SMB External File Access Point

An `smb/external` file access point is a direct SMB connection to a share. It is the low-level storage target used by the explorer and by `smb/internal` managed file access points.

Source types:

- `config`: loaded from `config.0.yaml`, not deletable from UI/API
- `database`: created by user and stored in PostgreSQL, editable and deletable

Metadata fields:

- `host`
- `username`
- `password`
- `share`
- `path` (default `/`)

`share` is the SMB share name. `path` is an optional base folder inside the share; every explore and managed-storage operation is resolved under it.

Validation:

- backend validates required metadata fields
- SMB session is created only if metadata is valid

SMB external connection model:

- backend keeps one active SMB session per file access point id
- requests share the same connection state with a lock
- UI/API can run:
  - connection check
  - force reconnect
  - directory list by path

UI model:

- root tree contains:
  - `Server`
  - `FileAccessPoint(SMB)`
- each file access point contains:
  - `config`
  - `explore`
