# Railway Environment Sync

Manages environment variables for Railway deployments. Variables are stored locally in `.env` files and synced to Railway via the CLI.

## Structure

```
.railway/
├── sync.ps1                        # Sync script (parallel, batched)
├── README.md                       # This file
├── configs/
│   ├── servers/                    # Railway configs for backend services
│   └── clients/                    # Railway configs for frontend services
└── envs/
    ├── shared.env                  # Shared vars — all environments
    ├── shared.development.env      # Shared vars — dev
    ├── shared.staging.env          # Shared vars — staging
    ├── shared.production.env       # Shared vars — production
    ├── server/
    │   ├── backend.env             # Backend service vars
    │   ├── worker.env              # Worker service vars
    │   └── redirector.env          # Redirector service vars
    └── client/
        └── client.env              # ONE env file for ALL frontends
```

## How it works

1. **Shared env files** (`shared.env` + `shared.<environment>.env`) hold the variable values. Environment-specific values win over `shared.env`.

2. **Service env files** declare which variables a service receives, referencing shared values with `${{shared.VAR}}` (or direct values / Railway refs like `Redis.REDIS_URL`).

3. **All frontends share the single `envs/client/client.env`** — frontend vars are public `VITE_*` build values, so one file covers every client. Do **not** create per-frontend env files; the `$serviceMap` in `sync.ps1` points every client service at `client\client`.

## Usage

```powershell
railway login
railway link

# Sync + redeploy ALL services for an environment
./.railway/sync.ps1 development
./.railway/sync.ps1 staging
./.railway/sync.ps1 production
```

## Adding a new variable

1. Add the value to `shared.env` (all environments) or `shared.<env>.env` for each environment it differs in.
2. Reference it from the service env file(s) that need it — for a frontend var, that's `client/client.env` (once, for all frontends).
3. Run `./.railway/sync.ps1 <environment>` to push.

## Adding a new frontend service

No new env file. Just add `"<Railway service name>" = "client\client"` to the `$serviceMap` in `sync.ps1` (plus the `configs/clients/<name>.json` Railway config).

## ⚠️ Important

- These files contain **secrets** — they are gitignored.
- Never commit `.env` files to the repository.
- When adding a new environment variable, check all three environments get a value.
