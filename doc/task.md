## Task

The service should use one unified task model for long-running or user-visible file operations.

Initial target operations:

- SMB external upload
- SMB external zip download
- SMB external copy
- SMB external move

Future operations can use the same model when the user benefits from progress, reconnect, cancellation, or operation history.

## Task Id

`taskId` uses the project `ms_48` id format.

- database storage: positive `bigint`
- API and UI display: base36 string using digits `0-9` and lowercase letters `a-z`
- id meaning: no semantic prefix or suffix

The id embeds creation time for ordering, but callers should still use `createdAt` when querying by time.

## Task Table

Table name:

- `task`

Columns:

- `taskId bigint primary key`
- `userId text not null default ''`
- `taskType integer not null`
- `taskStatus integer not null`
- `taskStatusText text not null default ''`
- `taskInfo jsonb not null default '{}'::jsonb`
- `createdAt timestamptz not null default now()`
- `createdAtTimeZone integer not null default 0`
- `updatedAt timestamptz not null default now()`
- `updatedAtTimeZone integer not null default 0`
- `startedAt timestamptz`
- `startedAtTimeZone integer`
- `finishedAt timestamptz`
- `finishedAtTimeZone integer`
- `heartbeatAt timestamptz`
- `heartbeatAtTimeZone integer`

Indexes:

- `idx_task_created_at` on `createdAt`
- `idx_task_status_created_at` on `(taskStatus, createdAt)`
- `idx_task_type_created_at` on `(taskType, createdAt)`
- `idx_task_user_created_at` on `(userId, createdAt)`
- `idx_task_heartbeat_at` on `heartbeatAt`

The table stores task state, task input, progress summary, and final result or exit information. It is not intended to store large binary data.

`userId` records the task submitter. The first implementation can use the login username as `userId`.

`taskStatusText` stores a short display name for `taskStatus`, for example `running`, `success`, `fail`, or `cancel`. Detailed progress and failure messages are stored in `taskInfo.taskProgress.progressList` and `taskInfo.exitInfo`.

All timezone columns store UTC offset in minutes. API display should use the project time format such as `20260520_23250530+09`.

## Task Type

`taskType` is an integer with hard-coded meaning.

- `1`: SMB external upload
- `2`: SMB external zip download
- `3`: SMB external copy
- `4`: SMB external move

More task types can be added later. Existing integer meanings must not be changed.

## Task Status

`taskStatus` is an integer with hard-coded meaning.

- `1`: undergoing
- `2`: success
- `3`: fail
- `4`: cancel

Status rules:

- new task starts as `1`
- terminal statuses are `2`, `3`, and `4`
- `finishedAt` is set only for terminal statuses
- `heartbeatAt` is updated by frontend-owned tasks while the page is still active
- `taskStatusText` is updated whenever task progress gets a new latest message
- `exitInfo.exitType` uses the same integer values as `taskStatus`
- ongoing tasks should have no `exitInfo`, or `exitInfo` should be `null`

## Task Info Schema

`taskInfo` is a JSON object. It should use the same top-level shape for all task types.

```json
{
  "schemaVersion": 1,
  "taskBaseInfo": {
    "taskType": 3,
    "taskTypeName": "smbExternalCopy",
    "taskStatus": 1,
    "taskStatusText": "running"
  },
  "userInfo": {
    "userId": "example"
  },
  "operationInfo": {
    "targetFolderPath": "[fap-smb-external:nas(config:nas)]/target",
    "targetFolderPathResolved": "/target",
    "fileAccessPointTarget": {
      "fileAccessPointType": "smb/external",
      "fileAccessPointId": "config:nas",
      "fileAccessPointName": "nas"
    },
    "itemList": [
      {
        "name": "example.txt",
        "pathSource": "/source/example.txt",
        "pathTarget": "/target/example.txt",
        "fileAccessPointSource": {
          "fileAccessPointType": "smb/external",
          "fileAccessPointId": "config:nas",
          "fileAccessPointName": "nas"
        },
        "fileAccessPointTarget": {
          "fileAccessPointType": "smb/external",
          "fileAccessPointId": "config:nas",
          "fileAccessPointName": "nas"
        },
        "isDirectory": false,
        "sizeBytes": 123
      }
    ],
    "isOverwriteAllowed": false,
    "isEnsureTargetFolder": true
  },
  "taskProgress": {
    "itemCountTotal": 1,
    "itemCountDone": 0,
    "byteCountTotal": 123,
    "byteCountDone": 0,
    "progressList": [
      {
        "taskStatus": 1,
        "taskStatusMessage": "copy submitted",
        "updateAt": "20260606_00350000+09",
        "updateAtTimezone": 540
      }
    ]
  },
  "resultInfo": null,
  "exitInfo": null
}
```

Required top-level fields:

- `schemaVersion`
- `taskBaseInfo`
- `operationInfo`
- `taskProgress`
- `resultInfo`
- `exitInfo`

Optional top-level fields:

- `userInfo`

`taskBaseInfo` fields:

- `taskType`: same integer as table `taskType`
- `taskTypeName`: stable string for debugging and UI labels
- `taskStatus`: latest task status, same integer as table `taskStatus`
- `taskStatusText`: short display name for the integer `taskStatus`

`operationInfo` is task dependent. Fields that are common for one task type do not need to be forced into every other task type.

For copy and move tasks, `operationInfo.itemList` entries should use this shape:

```json
{
  "name": "example.txt",
  "pathSource": "/source/example.txt",
  "pathTarget": "/target/example.txt",
  "fileAccessPointSource": {
    "fileAccessPointType": "smb/external",
    "fileAccessPointId": "config:nas",
    "fileAccessPointName": "nas"
  },
  "fileAccessPointTarget": {
    "fileAccessPointType": "smb/external",
    "fileAccessPointId": "config:nas",
    "fileAccessPointName": "nas"
  },
  "isDirectory": false,
  "sizeBytes": 123
}
```

`fileAccessPointSource` and `fileAccessPointTarget` are stored per entry. A copy or move task has one target folder and one target SMB external file access point, so every entry target should be derived from `operationInfo.targetFolderPathResolved` plus the entry `name`.

`operationInfo.targetFolderPath` is the user-facing target string. A plain path such as `/aaa/bbb` means the same SMB external file access point as the source. A cross-access-point target uses this form:

```text
[fap-smb-external:nas(config:nas)]/aaa/bbb
```

The display name before the parentheses is informational. The id inside the parentheses is authoritative and must resolve to an existing SMB external file access point.

`operationInfo.isEnsureTargetFolder` controls missing target folder behavior. It defaults to `true` for compatibility with older task records. When `true`, the backend creates missing folders in the task target path before each entry operation. When `false`, the backend fails the current entry if the target folder does not exist. Each entry keeps its own `taskStatus` and `taskStatusText`; the overall task fails if one or more entries fail.

Entry fields should not use an unnecessary `item` prefix. Use `name`, `path`, `pathSource`, `pathTarget`, and similar names.

`taskProgress` fields:

- `itemCountTotal`
- `itemCountDone`
- `byteCountTotal`
- `byteCountDone`
- `progressList`

Unknown totals should use `0`, not `null`.

`taskProgress.progressList` stores the progress history. Each entry must include:

- `taskStatus`
- `taskStatusMessage`
- `updateAt`

Each entry can include:

- `updateAtTimezone`

`updateAt` uses the project display format, for example `20260606_00350000+09`. `updateAtTimezone` stores UTC offset in minutes, for example `540` for Japan time.

The latest task status is mirrored to the table columns:

- `taskStatus`
- `taskStatusText`
- `updatedAt`
- `updatedAtTimeZone`

`taskStatusText` should stay short. Its display names can be configured in `config/config.yaml` under `task_status_display_name`.

`resultInfo` is `null` while the task is undergoing. On success, it should be an object containing the final result summary, for example copied item count, moved item count, zip download name, or uploaded file names.

`assetInfo` is optional. It exists when a task generates local temporary assets for later download.

```json
{
  "assetNextId": 2,
  "assetById": {
    "0": {
      "assetId": 0,
      "fileNameAsset": "l9x9o3x2-0.zip",
      "fileNameDownload": "photos.zip",
      "sizeBytes": 123456,
      "contentType": "application/zip"
    },
    "1": {
      "assetId": 1,
      "fileNameAsset": "l9x9o3x2-1.zip",
      "fileNameDownload": "docs.zip",
      "sizeBytes": 456789,
      "contentType": "application/zip"
    }
  }
}
```

`assetId` is a self-increasing integer inside one task. JSON object keys use the string form of that integer.

`exitInfo` is `null` while the task is undergoing. On fail or cancel, it should be an object.

```json
{
  "exitType": 3,
  "exitMessage": "frontend disconnected",
  "exitAt": "20260606_00350000+09",
  "exitAtTimezone": 540
}
```

`exitInfo.exitType` values:

- `2`: success
- `3`: fail
- `4`: cancel

For successful tasks, `resultInfo` is the main result holder. `exitInfo` may stay `null` unless the backend wants one consistent terminal object for all terminal statuses.

## SMB External Upload

Upload is special because the browser owns the local file stream. If the page closes, the backend cannot continue reading the local file.

Upload task behavior:

- frontend creates a task before starting upload
- backend marks task as undergoing
- frontend sends upload data through the normal upload request
- browser-side progress updates `taskProgress.byteCountDone`
- frontend updates `heartbeatAt` while upload is still active
- after backend writes the file to SMB, backend marks task as success
- if the upload request aborts before completion, backend marks task as fail
- if `heartbeatAt` expires before upload reaches a terminal status, backend marks task as fail
- failure should set `exitInfo.exitType` to `3`
- failure should set `exitInfo.exitMessage` to `frontend disconnected`

Upload task status can be traced after reopening the page, but upload cannot resume unless a later resumable upload design is added.

## SMB External Zip Download

Zip download already has a backend task concept, but it is currently in memory. It should be moved to the unified `task` table.

Zip task behavior:

- create task row before zip process starts
- update `taskProgress.progressList` while scanning and packing files
- mark success when zip file is ready
- store download information in `resultInfo`
- mark cancel when user aborts
- mark fail when zip creation errors or times out

Generated zip assets should be stored in the task asset folder. The asset file name should include the displayed task id.

For one generated asset:

- `{taskId}.zip`

For multiple generated assets:

- `{taskId}-0.zip`
- `{taskId}-1.zip`

The asset file name is only for backend lookup. The user-facing download name should be stored separately in `taskInfo.assetInfo.assetById` and used by the download response.

## SMB External Copy And Move

Copy and move tasks operate on SMB external file access points. The source and target can be the same access point or different SMB external access points.

Copy task behavior:

- create task row with per-entry source and target information
- copy each selected file or folder to the task target folder
- update item and byte progress when known
- mark success after all selected items are copied
- mark fail if any required source is missing or SMB operation fails
- mark cancel if user cancels before completion
- keep each entry status independent, even when the overall task later fails

Move task behavior:

- same task model as copy
- prefer SMB rename for same-folder or same-share moves when possible
- fall back to copy then delete for moves across SMB external file access points
- mark fail if delete fails after copy, and record clear `exitInfo.exitMessage`
- use one task target folder; recursive child paths are relative to that target folder

## Backend API Design

SMB external task endpoints:

- `POST /api/fap-smb-external/task/submit`
- `POST /api/fap-smb-external/task/list`
- `POST /api/fap-smb-external/task/get`
- `POST /api/fap-smb-external/task/status`
- `POST /api/fap-smb-external/task/resubmit`
- `POST /api/fap-smb-external/task/cancel`
- `POST /api/fap-smb-external/task/delete`
- `POST /api/fap-smb-external/task/asset/list`
- `GET /api/fap-smb-external/task/asset/get`

Submit request body should include:

- `taskType`

`taskType` values use the table task type integers.

Endpoint behavior:

- `task/submit`: submit a new task and return `taskId`
- `task/list`: return task rows including latest `taskStatus` and `taskStatusText`
- `task/status`: return `taskStatus` and `taskStatusText`
- `task/resubmit`: create a new copy or move task from a failed task's saved operation data
- `task/get`: return full `taskInfo`
- `task/cancel`: cancel an undergoing task when the task type supports cancellation
- `task/delete`: delete a non-undergoing task log and its related assets
- `task/asset/list`: return generated assets from `taskInfo.assetInfo.assetById`
- `task/asset/get`: return one generated asset by `assetId`

Task-specific data should be stored in a task-dependent request field. For example, copy and move `submit` requests can include `operationInfo`.

Example copy submit body:

```json
{
  "taskType": 3,
  "operationInfo": {
    "targetFolderPath": "/target",
    "isEnsureTargetFolder": true,
    "itemList": [
      {
        "name": "example.txt",
        "pathSource": "/source/example.txt",
        "pathTarget": "/target/example.txt",
        "fileAccessPointSource": {
          "fileAccessPointType": "smb/external",
          "fileAccessPointId": "config:nas",
          "fileAccessPointName": "nas"
        },
        "fileAccessPointTarget": {
          "fileAccessPointType": "smb/external",
          "fileAccessPointId": "config:nas",
          "fileAccessPointName": "nas"
        },
        "isDirectory": false,
        "sizeBytes": 123
      }
    ],
    "isOverwriteAllowed": false
  }
}
```

Upload heartbeat behavior:

- frontend sends heartbeat requests while the upload page is active
- frontend sends progress update requests from browser upload progress events
- backend sets `heartbeatAt` when heartbeat or progress update is received
- backend marks stale undergoing upload tasks as fail when `heartbeatAt` is too old
- stale upload failure uses `exitInfo.exitMessage` value `frontend disconnected`

Task status updates should be done by backend service functions, not by direct SQL scattered across endpoint handlers.

## Task Asset

Tasks that generate temporary files for later download should write them under a local task asset folder.

Folder:

- `.runtime/task_asset/`

Asset file naming:

- one file: `{taskId}.{suffix}`
- multiple files: `{taskId}-0.{suffix}`, `{taskId}-1.{suffix}`

`taskId` in file names is the base36 display id. The suffix should be the generated file suffix, such as `zip`.

`taskInfo.assetInfo.assetById` should store both the asset file name and the user-facing download name.

```json
{
  "assetNextId": 1,
  "assetById": {
    "0": {
      "assetId": 0,
      "fileNameAsset": "l9x9o3x2.zip",
      "fileNameDownload": "photos.zip",
      "sizeBytes": 123456,
      "contentType": "application/zip"
    }
  }
}
```

The asset folder is local runtime data. It can be cleaned by a maintenance task after assets are old enough or after the owning task is deleted. Deleting a task log should delete its related assets.

## Frontend Design

Frontend should treat task rows from the backend as the source of truth for task history and terminal status.

For upload, frontend still keeps local browser-file objects in memory because they cannot be stored in the backend. The task row stores progress and final state only.

For copy, move, and zip download, frontend can close and reopen. The task list can reload from `/api/fap-smb-external/task/list` and continue displaying current task state.

The frontend should subscribe to task updates through a shared task websocket. The backend can trigger websocket events from database updates or from task service updates. Websocket events only need to carry the latest task row; the full progress history remains in `taskInfo.taskProgress.progressList`.

Users should be able to:

- submit a task and get a `taskId`
- view ongoing and finished tasks after reopening the page
- cancel an undergoing task when the task type supports cancellation
- list generated assets through `task/asset/list`
- download generated assets through `task/asset/get`
