## API

Health:

- `GET /api/health/ping`
- `GET /api/health/database`

File access point:

- `GET /api/fap-smb-external/list`
- `POST /api/fap-smb-external/create`
- `POST /api/fap-smb-external/update`
- `POST /api/fap-smb-external/delete`
- `GET /api/fap-smb-external/get-by-id`
- `POST /api/fap-smb-external/get-by-id`
- `GET /api/fap-smb-external/get-by-name`
- `POST /api/fap-smb-external/get-by-name`
- `POST /api/fap-smb-external/connection/check`
- `POST /api/fap-smb-external/connection/reconnect`
- `GET /api/fap-smb-external/explore/list`
- `POST /api/fap-smb-external/task/submit`
- `POST /api/fap-smb-external/task/list`
- `POST /api/fap-smb-external/task/get`
- `POST /api/fap-smb-external/task/status`
- `POST /api/fap-smb-external/task/cancel`
- `POST /api/fap-smb-external/task/delete`
- `POST /api/fap-smb-external/task/asset/list`
- `GET /api/fap-smb-external/task/asset/get`

Task:

- `POST /api/fap-smb-external/task/submit`
- `POST /api/fap-smb-external/task/list`
- `POST /api/fap-smb-external/task/get`
- `POST /api/fap-smb-external/task/status`
- `POST /api/fap-smb-external/task/cancel`
- `POST /api/fap-smb-external/task/delete`
- `POST /api/fap-smb-external/task/asset/list`
- `GET /api/fap-smb-external/task/asset/get`

SMB internal file access point:

- `GET /api/fap-smb-internal/list`
- `POST /api/fap-smb-internal/create`
- `POST /api/fap-smb-internal/update`
- `POST /api/fap-smb-internal/delete`
- `GET /api/fap-smb-internal/file/list`
- `POST /api/fap-smb-internal/file/list`
- `POST /api/fap-smb-internal/file/upload`
- `GET /api/fap-smb-internal/file/download`
- `POST /api/fap-smb-internal/file/download`
- `POST /api/fap-smb-internal/file/move`
- `POST /api/fap-smb-internal/file/storage/rebalance`
- `POST /api/fap-smb-internal/file/delete`

Notes:

- `create/update` accepts `name` and `metadata`
- `delete` only supports database source items
- `fap-smb-external/delete` removes database-backed `smb/external` config only; it does not delete SMB files
- `connection/check` and `connection/reconnect` require valid metadata
- `explore/list` args:
  - `fileAccessPointId`
  - `path`
- `fap-smb-external/task/submit` request body includes `taskType`

Task notes:

- `taskId` is returned as a base36 string
- `task/submit` starts a task and returns `taskId`
- `task/list` returns task rows including latest `taskStatus` and `taskStatusText`
- `task/status` returns `taskStatus` and `taskStatusText`
- `task/get` returns the full `taskInfo`
- `task/cancel` marks an undergoing task as cancel when the task type supports cancellation
- `task/delete` deletes a non-undergoing task log and its related assets
- `task/asset/list` returns assets listed in `taskInfo.assetInfo.assetById`
- `task/asset/get` downloads one asset by `assetId`
- task websocket support should notify frontend when `taskStatus` or `taskStatusText` changes

SMB internal notes:

- `create/update` accepts `name`, `fileAccessPointSmbExternalInfo`, `pathRoot`, and `metadata`
- `fileAccessPointSmbExternalInfo` can be `{ "id": "..." }` or `{ "name": "..." }`; name matching is case-sensitive
- `file/list` accepts `pageIndex` and `pageSize`, and returns `items`, `totalCount`, `pageIndex`, and `pageSize`
- `file/list` item timezone fields use minute offsets from UTC, for example `createAtTimeZone: 540`
- file upload accepts multipart form fields `fileAccessPointId`, `file`, optional `fileName`, `fileType`, and `metadata`
- file operations use the SMB internal `fileAccessPointId` and `fileId`
- `filePath` is stored relative to the internal `/files/` folder
- `file/storage/rebalance` accepts `fileAccessPointId`, `maxFilesPerFolder`, `maxDepth`, `limit`, and `isDryRun`
- `fap-smb-internal/delete` removes the internal access point row and its `files_{fapId}` table; it does not delete SMB files
