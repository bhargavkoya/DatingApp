# 01 — Architecture Overview

## System context

```
┌─────────────────────────────┐         HTTPS / WSS          ┌──────────────────────────────┐
│  Browser (Angular 13 SPA)   │  ───────────────────────▶    │  ASP.NET Core 5 Web API       │
│                             │   REST  /api/*               │                              │
│  - components               │   SignalR  /hubs/presence    │  Controllers                 │
│  - _services (HttpClient)   │   SignalR  /hubs/message     │    │  IUnitOfWork              │
│  - 3 HTTP interceptors      │                              │    ▼                         │
│  - @microsoft/signalr       │                              │  Repositories → EF Core      │
│  - user in localStorage     │  ◀───────────────────────    │    │                         │
└─────────────────────────────┘   JSON + `Pagination` hdr    │    ▼                         │
                                                             │  PostgreSQL                  │
                                                             │                              │
                                                             │  PhotoService → Cloudinary   │
                                                             │  TokenService  → JWT         │
                                                             └──────────────────────────────┘
```

Two independently-built apps in one repo:

| | `API/` | `client/` |
|---|---|---|
| Stack | ASP.NET Core 5 (`net5.0`) | Angular 13 (Angular CLI) |
| Solution | `DatingApp.sln` (this project only) | standalone `npm` project, no `.sln` link |
| Entry | `API/Program.cs` → `API/Startup.cs` | `client/src/main.ts` → `AppModule` |
| Output | `dotnet publish` | `ng build` → **`../API/wwwroot`** (`angular.json` `outputPath`) |

## How the two connect

### Production (single origin)
`ng build` writes the SPA into `API/wwwroot/`. The API pipeline has
`UseDefaultFiles()` + `UseStaticFiles()`, and `FallbackController.Index` serves
`wwwroot/index.html` for any route not matched by a controller or hub
(`app.MapFallbackToController("Index","Fallback")`). So the browser loads the SPA and calls
`/api/*` + `/hubs/*` on the **same origin** — CORS is irrelevant.

### Development (two origins)
- API: `dotnet run` in `API/` → `https://localhost:5001` (+ `http://localhost:5000`).
  `ASPNETCORE_ENVIRONMENT=Development` comes from `API/Properties/launchSettings.json`.
- SPA: `ng serve` in `client/` → `http://localhost:4200`.
- `client/src/environments/environment.ts` hard-codes `apiUrl:
  'https://localhost:5001/api/'` and `hubUrl: 'https://localhost:5001/hubs/'`, so the dev SPA
  calls the API **cross-origin**.
- `Startup.Configure` allows exactly that origin:
  `app.UseCors(x => x.AllowAnyHeader().AllowAnyMethod().AllowCredentials().WithOrigins("http://localhost:4200"))`.
- The API also serves HTTPS with the ASP.NET dev cert → run `dotnet dev-certs https --trust`
  once or the SPA's XHR/WebSocket calls fail.

## Runtime topology / process model

- **Single API process.** No background workers, no message queue, no cache server.
- **`PresenceTracker` is an in-memory singleton** (`static Dictionary`). Online-user state
  lives in process memory → it does **not** survive a restart and is **not** correct across
  multiple API instances. The app is effectively single-instance today.
- **SignalR** uses the default in-memory backplane (no Redis) — same single-instance
  assumption.
- **Database**: PostgreSQL. Provider is `Npgsql.EntityFrameworkCore.PostgreSQL`. (`Sqlite`
  package + `API/Data/-- SQLite.sql` are dead leftovers from an earlier provider.)
- **Migrations + seed run at startup** in `Program.Main`: `await
  context.Database.MigrateAsync()` then `await Seed.SeedUsers(...)`. Just running the app
  brings a fresh DB fully up.
- **Photo binaries** are **not** in the API or the DB — they're uploaded straight to
  **Cloudinary** by `PhotoService`; only the URL + `PublicId` are persisted.

## Configuration & secrets

| Setting | Where (dev) | Where (prod) | Notes |
|---|---|---|---|
| DB connection | `API/appsettings.Development.json` → `ConnectionStrings:DefaultConnection` | `DATABASE_URL` env var, parsed in `ApplicationServiceExtensions` | dev/prod branch keyed off `ASPNETCORE_ENVIRONMENT` read directly |
| `TokenKey` (JWT signing) | **.NET user-secrets** (`dotnet user-secrets set "TokenKey" …`); `<UserSecretsId>` in `API.csproj` | env var / real config | never committed; must be ≥ 64 bytes for HMAC-SHA512 (see `05-auth-and-security.md`) |
| `CloudinarySettings` (CloudName/ApiKey/ApiSecret) | `API/appsettings.json` | env / config | bound via `IOptions<CloudinarySettings>` |
| SPA API/hub URLs | `client/src/environments/environment.ts` / `environment.prod.ts` | build-time `fileReplacements` | |

`API/appsettings.json` is **git-ignored**. `API/appsettings.Development.json` is committed and
currently carries the (placeholder) Cloudinary secret and token key.

## Deployment

Commit history (`deployheroku`, `deployherokumyapp`, `Switch to postgres`) shows **Heroku +
Heroku Postgres** as the target. `DATABASE_URL` is a `postgres://user:pass@host:port/db` URL
that `ApplicationServiceExtensions.AddApplicationServices` splits by hand into an Npgsql
connection string (with `SSL Mode=Require;TrustServerCertificate=True`). Heroku's free tier
was removed in Nov 2022; revisit hosting post-migration.

## Run it locally (current versions)

```bash
# 1. Postgres (matches appsettings.Development.json)
docker compose up -d db          # ../docker-compose.yml

# 2. One-time: put the JWT signing key in user-secrets (NEVER committed).
#    Any random string >= 64 bytes; HMAC-SHA512 requires it.
cd API
dotnet user-secrets set "TokenKey" "$(openssl rand -base64 64)"

# 3. API  -> https://localhost:5001  (auto-migrates + seeds)
dotnet run

# 4. SPA  -> http://localhost:4200
cd ../client && npm install && npm start
```

`TokenKey` is read from .NET user-secrets in Development (see
`05-auth-and-security.md`); it is deliberately **not** in `appsettings.Development.json`.
Non-Development reads `TokenKey` from an environment variable / real config.

Seed accounts (all password `Pa$$w0rd`): the users in `API/Data/UserSeedData.json`
(`lisa`, `karen`, …, lower-cased) all get the `Member` role; `admin` gets `Admin` +
`Moderator`.

## Repo landmarks

```
API/
  Program.cs, Startup.cs        app bootstrap + HTTP pipeline
  Controllers/                  9 controllers (see 02-backend.md)
  Data/                         DataContext, repositories, UnitOfWork, Seed, Migrations
  Entities/                     EF entities (see 04-data-model.md)
  DTOs/                         request/response shapes
  Extensions/                   service-registration + ClaimsPrincipal/HttpResponse/DateTime helpers
  Helpers/                      AutoMapper profiles, pagination, param objects, LogUserActivity filter
  Interfaces/                   repo + service abstractions
  Middleware/ExceptionMiddleware.cs
  Services/                     TokenService, PhotoService
  SignalR/                      PresenceHub, MessageHub, PresenceTracker
client/src/app/
  _services/  _guards/  _interceptors/  _models/  _resolvers/  _forms/  _directives/  _modules/
  home/ nav/ register/ members/ lists/ messages/ modals/ admin/ errors/
  app.module.ts  app-routing.module.ts
```
