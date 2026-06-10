## SMB Internal File Access Point

An `smb/internal` file access point is a managed file store rooted inside an `smb/external` file access point.

Model:

- depends on one `smb/external` file access point, specified by id or case-sensitive name
- uses `pathRoot` under that SMB external file access point
- treats `pathRoot` as the root folder of this managed file access point
- stores file bytes under `pathRoot/files/`
- creates one file table per SMB internal file access point: `files_{fapId}`
- lists managed files with pagination
- surfaces missing SMB external file access points, root folder failures, and missing SMB files as API errors

Metadata:

- file access point metadata is stored in PostgreSQL table `smb_internal_file_access_point`
- per-file metadata is stored in the PostgreSQL table `files_{fapId}`
- per-file timezone fields use UTC offset in minutes, for example `540` is displayed as `UTC+0900`
- the SMB subfolder `pathRoot/metadata/` is only for explicit backup files
- normal operations should not read from `pathRoot/metadata/`
- normal operations should not create or write files in `pathRoot/metadata/`
- if `pathRoot/metadata/` is empty or absent, the internal file access point can still be valid

File storage:

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

File rename:

- renaming updates `files_{fapId}.fileName`
- if the file suffix changes, renaming also moves the SMB file to the matching physical name
- renaming should not create a backup metadata file

Storage rebalance:

- dynamic folder depth is handled by a maintenance API, not during normal read requests
- `POST /api/fap-smb-internal/file/storage/rebalance` plans or executes path changes
- request fields are `fileAccessPointId`, `maxFilesPerFolder`, `maxDepth`, `limit`, and `isDryRun`
- dry run returns the target depth and files that would move
- execution moves SMB files, updates each row's `filePath`, and stores `storageFolderDepth` in database-backed internal metadata

UI model:

- root tree contains `FileAccessPoint(Internal)`
- each file access point contains `config` and `explore`
