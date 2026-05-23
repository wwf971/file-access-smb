# file-access-smb deploy summary

## Core rule

Frontend build base path and reverse-proxy public prefix must match.

Example:
- frontend is built with base `/files/`
- nginx exposes `location /files/ { proxy_pass http://<backend-host>:9400/; }`
- browser requests `/files/assets/...` and `/files/api/...`
- nginx strips `/files/` and forwards to backend `/assets/...` and `/api/...`

If these two prefixes are different, assets and API calls will fail.

## How this project is designed

- Build-time base path is configurable through `VITE_APP_BASE_PATH`.
- Deploy scripts under `script/` should control that value.
  - Example: `script/deploy-to-xxx.sh` sets `DEPLOY_APP_BASE_PATH="/files/"` before building.
- Frontend URL helpers (`frontend/publicPath.ts`) build URLs from the configured base.
- API helpers (`frontend/apiRequest.ts`) apply auth headers/cookies and no-cache behavior for API requests.

## Portability pattern

To deploy on another machine or another URL prefix, keep code unchanged and only change deployment config.

Example migration from `/files/` to `/smb/`:
1. Set deploy base path to `/smb/` (`DEPLOY_APP_BASE_PATH="/smb/"`).
2. Configure nginx:
   - `location /smb/ { proxy_pass http://<backend-host>:9400/; }`
3. Deploy.

No frontend source edits are required for this change.

## Proxy/CDN requirements

For proxy/CDN environments, treat these as required:

- Forward auth data to origin:
  - `Authorization` header
  - cookies
  - query string (if used by some endpoints)
- Disable or tightly limit caching for dynamic API routes (for example `/files/api/*`).

Example policy:
- static assets: cache allowed
- `/files/api/*`: no cache

Notes:
- Critical explore endpoints support POST body, which reduces dependence on query-string forwarding.
