# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Active migration — read first

A staged migration is in progress: **.NET 5 → .NET 10** and **Angular 13 → Angular 21**.
Before making changes:

- **`CLAUDE.local.md`** — the working agreement, branch/PR workflow, review gates, stage
  status board, and the decision log. Update it in the same commit as any decision or stage
  change. **Rule: no coding-standards refactors during the migration** — only changes required
  to advance a version or keep behaviour identical. Standards pass happens after.
- **`MIGRATION_PLAN.md`** — the full step-by-step plan (backend gotchas G1–G12; the Angular
  major-by-major ladder; local run + smoke-test checklist).
- **`docs/`** — codebase reference. `docs/08-invariants-and-contracts.md` is the "do not
  break" checklist every stage is reviewed against.

Work happens on `migrate/*` / `chore/*` branches; nothing merges to `main` without both an
agent review and the user's approval (see `CLAUDE.local.md` §2–§3).

Sections below describe the **current** (pre-migration) state.

## Overview

Two apps in one repo:

- `API/` — ASP.NET Core **.NET 5** Web API (`DatingApp.sln` contains only this project).
- `client/` — **Angular 13** SPA (Angular CLI), separate `npm` project with no solution reference.

In production the Angular build is copied into `API/wwwroot/` and served by the API; `FallbackController` returns `wwwroot/index.html` for any unmatched route (`MapFallbackToController` in `Startup`).

## Commands

### API (run from `API/`)
- `dotnet run` — starts on `https://localhost:5001` / `http://localhost:5000`. `launchSettings.json` sets `ASPNETCORE_ENVIRONMENT=Development`, which is required for local config to load (see Configuration below).
- `dotnet watch run` — hot reload.
- `dotnet build`
- EF Core migrations (needs `dotnet tool install --global dotnet-ef`):
  - `dotnet ef migrations add <Name>`
  - `dotnet ef database update`
  - Migrations are **also applied automatically at startup** in `Program.Main`, which then runs `Seed.SeedUsers`. Just running the app brings the DB up to date and seeds users/roles.
- There is **no API test project**.

### Client (run from `client/`)
- `npm install`
- `npm start` (`ng serve`) — dev server at `http://localhost:4200`, expects the API at `https://localhost:5001` (`src/environments/environment.ts`).
- `npm run build` — output to `client/dist/`.
- `npm test` — Karma + Jasmine, all specs.
- Single spec: `ng test --include=src/app/path/to/thing.spec.ts` (or `--include='**/member-*.spec.ts'`).
- No e2e is configured.

## Configuration & secrets

- `API/appsettings.json` is **gitignored**. `API/appsettings.Development.json` holds the local `ConnectionStrings:DefaultConnection` (Postgres) and `TokenKey` (JWT signing key). When adding a new required setting, update both the Development file and any deployment env vars.
- Cloudinary credentials live under `CloudinarySettings` in appsettings and are bound to `CloudinarySettings` via `IOptions`.
- Non-Development environments (Heroku) get their DB from the `DATABASE_URL` env var, parsed into an Npgsql connection string inside `ApplicationServiceExtensions.AddApplicationServices`. The `Development` vs. other branch is chosen by reading `ASPNETCORE_ENVIRONMENT` directly there.
- DB provider is **PostgreSQL** (`Npgsql.EntityFrameworkCore.PostgreSQL`). The `Sqlite` package and `Data/-- SQLite.sql` are legacy from an earlier provider.

## API architecture

- **Service wiring** is split into extension methods, called from `Startup.ConfigureServices`:
  - `AddApplicationServices` (`Extensions/ApplicationServiceExtensions.cs`) — DbContext, AutoMapper, `IUnitOfWork`, `IPhotoService`, `ITokenService`, `LogUserActivity`, singleton `PresenceTracker`.
  - `AddIdentityServices` (`Extensions/IdentityServiceExtensions.cs`) — Identity, JWT bearer, authorization policies.
- **Unit of Work + Repository.** Controllers and SignalR hubs depend only on `IUnitOfWork`, which lazily exposes `UserRepository`, `MessageRepository`, `LikesRepository`, `PhotoRepository`. Repositories stage changes; `await _unitOfWork.Complete()` calls `SaveChangesAsync` and returns whether rows changed. The common controller pattern is `... ; if (await _unitOfWork.Complete()) return Ok(); return BadRequest(...)`.
- **`BaseApiController`** (all controllers except `Fallback`/`WeatherForecast` inherit it) supplies `[ApiController]`, `[Route("api/[controller]")]`, and `[ServiceFilter(typeof(LogUserActivity))]` — an action filter that stamps `AppUser.LastActive` after every authenticated request.
- **AutoMapper** profiles: `Helpers/AutoMapperProfiles.cs`. DTOs in `DTOs/`.
- **Pagination.** Query-param classes in `Helpers/` (`UserParams`, `MessageParams`, `LikesParams`, base `PaginationParams`). Repos return `PagedList<T>`; controllers call `Response.AddPaginationHeader(...)` which emits a `Pagination` response header the client parses (`paginationHelper.ts`).
- **Errors.** `Middleware/ExceptionMiddleware` converts unhandled exceptions to a JSON `ApiException`. `BuggyController` exists only to exercise these paths from the client's test-errors page. Swagger is registered but `UseSwagger`/`UseSwaggerUI` are commented out in `Startup.Configure`.
- **DateTimes.** `DataContext.OnModelCreating` calls `ApplyUtcDateTimeConverter()`, which forces every `DateTime`/`DateTime?` property to be read back as `DateTimeKind.Utc`. Store UTC.

### Identity & auth

- `DataContext` extends `IdentityDbContext` with **int keys** and custom join entity `AppUserRole` (`Entities/AppUser`, `AppRole`, `AppUserRole`). Uses `AddIdentityCore` (no cookie UI).
- Auth is **JWT bearer** only. `TokenService` builds tokens from `config["TokenKey"]`; issuer/audience validation is off.
- Roles: `Admin`, `Moderator`, `Member` (seeded). Policies: `RequireAdminRole` (Admin), `ModeratePhotoRole` (Admin or Moderator) — used by `AdminController`.
- `ClaimsPrincipleExtensions` provides `User.GetUsername()` / `User.GetUserId()`, used throughout controllers and hubs.

### SignalR

- Hubs mapped in `Startup`: `/hubs/presence` (`PresenceHub`) and `/hubs/message` (`MessageHub`).
- Hub clients pass the JWT as an `access_token` **query string** param; `JwtBearerEvents.OnMessageReceived` in `IdentityServiceExtensions` promotes it to the bearer token for paths under `/hubs`.
- `PresenceTracker` is a singleton holding an in-memory online-users dictionary (does not survive restarts / scale-out).
- `MessageHub.OnConnectedAsync` joins a deterministic per-pair group (`GetGroupName` sorts the two usernames), loads the thread, and marks messages read while the recipient is in-group.

### Photos

- Uploads go to **Cloudinary** via `PhotoService`; `Photo.PublicId` is the Cloudinary handle used for deletion.
- `DataContext` applies a global query filter `builder.Entity<Photo>().HasQueryFilter(p => p.IsApproved)` — unapproved photos are invisible to normal queries. `AdminController` uses `IgnoreQueryFilters()` for the moderation queue (approve/reject).

## Client architecture

- Angular 13, single `AppModule` (no lazy feature modules). Shared third-party modules bundled in `_modules/shared.module.ts`.
- Folder convention: `_services/`, `_guards/`, `_interceptors/`, `_models/`, `_resolvers/`, `_forms/`, `_directives/`, `_modules/`.
- **State**: `AccountService` holds `currentUser$` (a `ReplaySubject`), persisted to `localStorage`.
- **HTTP interceptors** (registered in `AppModule` providers, order matters): `ErrorInterceptor` (toastr + routing on 4xx/5xx), `JwtInterceptor` (attaches `Authorization: Bearer` from `currentUser$`), `LoadingInterceptor` (ngx-spinner via `busy.service`).
- **Guards**: `auth.guard` (logged in), `admin.guard` (Admin/Moderator role), `prevent-unsaved-changes.guard` (dirty-form confirm on member-edit).
- API base URL and SignalR hub URL come from `src/environments/environment*.ts`.

## Deployment

Targeted at **Heroku** with Heroku Postgres (`DATABASE_URL`). Commit history shows the release flow is: build the Angular client into `API/wwwroot/`, publish the API, deploy. CORS in `Startup.Configure` only whitelists `http://localhost:4200` for dev; same-origin in production via the wwwroot fallback.
