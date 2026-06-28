# file-access-smb

SMB network disk access service that does not require having the SMB disks mounted locally, by directly accessing them. The service can use its built-in login feature or an external `@wwf971/auth-jwt` service.

- backend: Flask + `smbprotocol` (`smbclient`)
- frontend: Vite + React + MobX
- data: PostgreSQL (user-created SMB file access points)

## File Access Point

`File access point` is the key concept of this service. A file access point is a abstraction of file resources on an SMB network disk. it specifies from where, and how files are accessed.

Currently supported file access point type: `smb/external`, which basically corresponds to a folder on an smb network disk. `smb/internal` where the service manages the files in side this file access point. `smb/internal` file access point is based on `smb/external` file access point.

`fap` is used as a short name for file access point. In code, `fapSmbExternal` means an `smb/external` file access point, and `fapSmbInternal` means an `smb/internal` file access point.

## Documents:

Documents are placed under `/doc/`, including:

- `/doc/workflow.md`
- `/doc/config.md`
- `/doc/backend.md`
- `/doc/api.md`
- `/doc/database.md`
- `/doc/task.md`
- `/doc/file_access_point_smb_external.md`
- `/doc/file_access_point_smb_internal.md`
- `/doc/dir_config.md`

## Config

Config about the service itself and config/metadata of existing file access points of different types are mainly database. It is also supported to specify config such as file access points in `/config/config.yaml` and `/config/config.0.yaml`(excluded by `/.gitngnore`), for convenience of testing.

Auth mode is configured under `auth.type`. Use `internal` when this service should run independently. Use `@wwf971/auth-jwt` when several services should share the same sign-in state.

## Dependency

- Frontend components: [github.com/wwf971/react-comp-misc](https://github.com/wwf971/react-comp-misc)