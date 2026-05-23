## Workflow

Main path:

1. setup config in `../config/config.yaml` and local override in `../config/config.0.yaml`
2. install frontend dependencies with `pnpm -C ../frontend install`
3. install backend dependencies with `pip install -r ../backend/requirements.txt`
4. run service with `pnpm -C .. test`
5. open `http://127.0.0.1:9400`

Reference docs:

- config model: `./config.md`
- backend behavior: `./backend.md`
- api endpoints: `./api.md`
- schema: `./database.md`
- file access point model: `./file_access_point.md`
