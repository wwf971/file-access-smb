# file-access-smb

SMB network disk access service that does not require having the SMB disks mounted locally, by directly accessing them. The service comes with a simple login authentication feature.

- backend: Flask + `smbprotocol` (`smbclient`)
- frontend: Vite + React + MobX
- data: PostgreSQL (user-created SMB file access points)

Doc map:

- `./doc/workflow.md`
- `./doc/config.md`
- `./doc/backend.md`
- `./doc/api.md`
- `./doc/database.md`
- `./doc/file_access_point.md`
- `./doc/dir_config.md`

