## Database

This service stores user-created SMB file access points, SMB internal file metadata, and task state.

SMB external table:

- `smb_file_access_point`
  - `fileAccessPointId` text primary key
  - `name` text
  - `metadata` jsonb
  - `createdAt` timestamptz
  - `updatedAt` timestamptz

SMB internal file access point table:

- `smb_internal_file_access_point`
  - `fileAccessPointId` text primary key
  - `name` text
  - `fileAccessPointSmbExternalInfo` jsonb
  - `pathRoot` text
  - `metadata` jsonb
  - `createdAt` timestamptz
  - `updatedAt` timestamptz

Task table:

- `task`
  - `taskId` bigint primary key
  - `userId` text
  - `taskType` integer
  - `taskStatus` integer
  - `taskStatusText` text
  - `taskInfo` jsonb
  - `createdAt` timestamptz
  - `createdAtTimeZone` integer
  - `updatedAt` timestamptz
  - `updatedAtTimeZone` integer
  - `startedAt` timestamptz
  - `startedAtTimeZone` integer
  - `finishedAt` timestamptz
  - `finishedAtTimeZone` integer
  - `heartbeatAt` timestamptz
  - `heartbeatAtTimeZone` integer

`taskId` uses the project `ms_48` id format. It is stored as a positive `bigint` in PostgreSQL and displayed by API/UI as a base36 string with digits `0-9` and lowercase letters `a-z`.

`taskType` values:

- `1`: SMB external upload
- `2`: SMB external zip download
- `3`: SMB external copy
- `4`: SMB external move

`taskStatus` values:

- `1`: undergoing
- `2`: success
- `3`: fail
- `4`: cancel

`taskInfo` stores task input, progress, result, and exit information as JSON. Its schema is documented in `./task.md`.

`taskStatusText` stores the latest task status message. It mirrors the latest item in `taskInfo.taskProgress.progressList`.

Timezone columns store UTC offset in minutes. API display should follow the project time format, for example `20260520_23250530+09`.

`heartbeatAt` is used by frontend-owned tasks, especially upload, so the backend can fail stale undergoing tasks when the page disconnects before completion.

Generated task assets are stored under `.runtime/task_asset/`. Asset file names include the base36 display task id, for example `{taskId}.zip` or `{taskId}-0.zip`. Asset metadata is stored in `taskInfo.assetInfo.assetById`.

Per SMB internal file table:

- `files_{fapId}`
  - `fileId` text primary key
  - `fileName` text
  - `filePath` text unique
  - `fileType` text
  - `sizeBytes` bigint
  - `metadata` jsonb
  - `isDeleted` boolean
  - `createdAt` timestamptz
  - `createAtTimeZone` integer
  - `updatedAt` timestamptz
  - `updateAtTimeZone` integer
  - `deletedAt` timestamptz

`files_{fapId}` is created when an SMB internal file access point is created or first used. The table name uses the internal file access point id and only allows lowercase letters, digits, and underscore.
`createAtTimeZone` and `updateAtTimeZone` store UTC offset in minutes. For example, Japan time is `540` and is displayed as `UTC+0900`.
Deleting a database-backed SMB internal file access point drops this table but does not remove SMB files.

SMB internal storage layout:

- `/files/`: file bytes stored under the SMB internal root
- `/metadata/`: metadata backup files named `{timestamp}_metadata.yaml`
- `files_{fapId}.filePath`: relative path from `/files/`, not from the SMB internal root

`fileAccessPointSmbExternalInfo` identifies the underlying SMB external file access point. It can use id or name:

```json
{ "id": "fap_..." }
```

```json
{ "name": "nas" }
```

Name matching is case-sensitive. The timestamp uses the project format, for example `20260520_23250530+09`.

When migrating old `local/internal` file docs, `createdAt` is populated from old `createAt`, `updatedAt` is populated from old `updateAt`, and second, millisecond, microsecond, or nanosecond epoch values are normalized only if they fall in 2020-2030. `createAtTimeZone` and `updateAtTimeZone` are normalized to minute offsets; hour-based values such as `9` become `540`, while minute-based values such as `540` stay unchanged.

Expected failure cases:

- SMB external file access point is not found by id or name
- SMB external metadata is invalid
- SMB internal root folder cannot be created or reached
- file metadata exists in the database but the corresponding SMB file is missing
- SMB file operation fails while the database transaction is active

Schema file:

- `../database/init_db.sql`

Startup behavior:

1. read first item from `config_databases`
2. if `database_name` does not exist, create it
3. run schema init SQL

Used by:

- backend runtime and endpoints in `./backend.md`
- task model in `./task.md`
