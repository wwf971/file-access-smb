## File Access Point (SMB)

Two source types:

- `config`: loaded from `config.0.yaml`, not deletable from UI/API
- `database`: created by user and stored in PostgreSQL, editable and deletable

Metadata fields:

- `host`
- `username`
- `password`
- `share`
- `path` (default `/`)

Validation:

- backend validates required metadata fields
- SMB session is created only if metadata is valid

Connection model:

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
