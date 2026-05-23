## Backend

Entry:

- `../backend/app.py`

Core modules:

- `../backend/config_loader.py`: layered YAML loader
- `../backend/db.py`: database bootstrap and CRUD
- `../backend/smb_service.py`: SMB shared connection/session manager
- `../backend/file_access_point.py`: REST endpoints for SMB file access points

Service start:

1. ensure configured database exists
2. initialize schema
3. expose API and frontend static build

Runtime:

- API returns standard response shape: `{ code, data?, message? }`
- frontend build served from `DIR_BASE/build`
- default port: `9400`

Details:

- endpoint list: `./api.md`
- SMB file access point model: `./file_access_point.md`
