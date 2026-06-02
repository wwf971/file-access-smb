## API

Health:

- `GET /api/health/ping`
- `GET /api/health/database`

File access point:

- `GET /api/file-access-point/list`
- `POST /api/file-access-point/create`
- `POST /api/file-access-point/update`
- `POST /api/file-access-point/delete`
- `GET /api/file-access-point/get-by-id`
- `POST /api/file-access-point/get-by-id`
- `GET /api/file-access-point/get-by-name`
- `POST /api/file-access-point/get-by-name`
- `POST /api/file-access-point/connection/check`
- `POST /api/file-access-point/connection/reconnect`
- `GET /api/file-access-point/explore/list`

SMB internal file access point:

- `GET /api/smb-internal-file-access-point/list`
- `POST /api/smb-internal-file-access-point/create`
- `POST /api/smb-internal-file-access-point/update`
- `POST /api/smb-internal-file-access-point/delete`
- `GET /api/smb-internal-file-access-point/file/list`
- `POST /api/smb-internal-file-access-point/file/list`
- `POST /api/smb-internal-file-access-point/file/upload`
- `GET /api/smb-internal-file-access-point/file/download`
- `POST /api/smb-internal-file-access-point/file/download`
- `POST /api/smb-internal-file-access-point/file/move`
- `POST /api/smb-internal-file-access-point/file/storage/rebalance`
- `POST /api/smb-internal-file-access-point/file/delete`

Notes:

- `create/update` accepts `name` and `metadata`
- `delete` only supports database source items
- `file-access-point/delete` removes database-backed `smb/external` config only; it does not delete SMB files
- `connection/check` and `connection/reconnect` require valid metadata
- `explore/list` args:
  - `fileAccessPointId`
  - `path`

SMB internal notes:

- `create/update` accepts `name`, `fileAccessPointSmbExternalInfo`, `pathRoot`, and `metadata`
- `fileAccessPointSmbExternalInfo` can be `{ "id": "..." }` or `{ "name": "..." }`; name matching is case-sensitive
- `file/list` accepts `pageIndex` and `pageSize`, and returns `items`, `totalCount`, `pageIndex`, and `pageSize`
- `file/list` item timezone fields use minute offsets from UTC, for example `createAtTimeZone: 540`
- file upload accepts multipart form fields `fileAccessPointId`, `file`, optional `fileName`, `fileType`, and `metadata`
- file operations use the SMB internal `fileAccessPointId` and `fileId`
- `filePath` is stored relative to the internal `/files/` folder
- `file/storage/rebalance` accepts `fileAccessPointId`, `maxFilesPerFolder`, `maxDepth`, `limit`, and `isDryRun`
- `smb-internal-file-access-point/delete` removes the internal access point row and its `files_{fapId}` table; it does not delete SMB files
