## Database

This service stores only user-created SMB file access points.

Table:

- `smb_file_access_point`
  - `fileAccessPointId` text primary key
  - `name` text
  - `metadata` jsonb
  - `createdAt` timestamptz
  - `updatedAt` timestamptz

Schema file:

- `../database/init_db.sql`

Startup behavior:

1. read first item from `config_databases`
2. if `database_name` does not exist, create it
3. run schema init SQL

Used by:

- backend runtime and endpoints in `./backend.md`
