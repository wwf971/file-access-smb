# file-access-smb

SMB network disk access service that does not require having the SMB disks mounted locally, by directly accessing them. The service comes with a simple login authentication feature.

- backend: Flask + `smbprotocol` (`smbclient`)
- frontend: Vite + React + MobX
- data: PostgreSQL (user-created SMB file access points)

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

## Dependency

- Frontend components: [github.com/wwf971/react-comp-misc](https://github.com/wwf971/react-comp-misc)