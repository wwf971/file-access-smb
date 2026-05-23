## API

Health:

- `GET /api/health/ping`
- `GET /api/health/database`

File access point:

- `GET /api/file-access-point/list`
- `POST /api/file-access-point/create`
- `POST /api/file-access-point/update`
- `POST /api/file-access-point/delete`
- `POST /api/file-access-point/connection/check`
- `POST /api/file-access-point/connection/reconnect`
- `GET /api/file-access-point/explore/list`

Notes:

- `create/update` accepts `name` and `metadata`
- `delete` only supports database source items
- `connection/check` and `connection/reconnect` require valid metadata
- `explore/list` args:
  - `fileAccessPointId`
  - `path`
