## File Access Point (SMB)

Types:

- `smb/external`: a direct SMB connection to a share
- `smb/internal`: a managed file store rooted inside an `smb/external` file access point

SMB external source types:

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

SMB internal model:

- stores its own metadata in PostgreSQL
- depends on one `smb/external` file access point, specified by id or case-sensitive name
- uses a `pathRoot` under that SMB external file access point
- treats `pathRoot` as the root folder of this managed file access point
- stores file bytes under `pathRoot/files/`
- stores metadata backup YAML files under `pathRoot/metadata/`
- creates one file table per SMB internal file access point: `files_{fapId}`
- lists managed files with pagination
- surfaces missing SMB external file access points, root folder failures, and missing SMB files as API errors

SMB internal file storage:

- file metadata is stored in PostgreSQL, and file bytes are stored in SMB
- `files_{fapId}.filePath` is relative to `pathRoot/files/`
- `filePath` should not start with `/files/`
- physical file names use `{fileId}.{lowercaseSuffix}`
- the original uploaded file name is stored as `fileName`
- new uploads use the current `storageFolderDepth` from internal metadata, defaulting to `1`
- existing files are read from the `filePath` stored in the database, so reads do not assume one fixed folder depth

Examples:

- `fileId=abcvef`, `fileName=a.xxx`, `storageFolderDepth=1` stores bytes at `pathRoot/files/ab/abcvef.xxx`, with DB `filePath=ab/abcvef.xxx`
- `fileId=abcvef`, `fileName=a.xxx`, `storageFolderDepth=2` stores bytes at `pathRoot/files/ab/cv/abcvef.xxx`, with DB `filePath=ab/cv/abcvef.xxx`
- `fileId=abcvef`, `fileName=a.xxx`, `storageFolderDepth=3` stores bytes at `pathRoot/files/ab/cv/ef/abcvef.xxx`, with DB `filePath=ab/cv/ef/abcvef.xxx`

Storage rebalance:

- dynamic folder depth is handled by a maintenance API, not during normal read requests
- `POST /api/smb-internal-file-access-point/file/storage/rebalance` plans or executes path changes
- request fields:
  - `fileAccessPointId`
  - `maxFilesPerFolder`, default `1000`
  - `maxDepth`, default `6`
  - `limit`, default `100`
  - `isDryRun`, default `true`
- dry run returns the target depth and files that would move
- execution moves SMB files, updates each row's `filePath`, writes a metadata backup, and stores `storageFolderDepth` in database-backed internal metadata

UI model:

- root tree contains:
  - `Server`
  - `FileAccessPoint(SMB)`
  - `FileAccessPoint(Internal)`
- each file access point contains:
  - `config`
  - `explore`
