# DatingApp Migration Plan — .NET 5 → .NET 10, Angular 13 → Angular 21

Prepared 2026‑09‑09. Follow top to bottom. Do the **backend first** (contained, low risk,
keeps a stable API), then upgrade Angular **one major version at a time**, then clean up.

The frontend stays Angular. There is a supported, incremental upgrade path (13→14→…→21 via
`ng update`); the effort is in third‑party library compatibility, the Bootstrap 4→5 CSS
change, and a few framework refactors (functional guards, standalone bootstrap, the new
build system). Estimate: backend 1–2 days, Angular chain 2–4 days, cleanup ½ day.

---

## 0. Scope & reality check

| Area | Now | Target |
|---|---|---|
| Backend runtime | .NET 5 (`net5.0`), `Startup.cs` + generic host | .NET 10 LTS (`net10.0`), minimal hosting |
| ORM / DB | EF Core 5, Npgsql 5, PostgreSQL | EF Core 10, Npgsql 10, PostgreSQL 16 |
| Auth | ASP.NET Core Identity (int keys) + JWT bearer | same, updated packages |
| Realtime | SignalR (`/hubs/presence`, `/hubs/message`) | same |
| Frontend framework | Angular 13, `@angular-devkit/build-angular:browser` | Angular 21 (or 20), `@angular/build:application` |
| Frontend patterns | NgModules, class guards/resolver, `*ngIf`/`*ngFor` | standalone bootstrap, functional guards/resolver, `@if`/`@for` (optional) |
| CSS framework | Bootstrap 4.6 + bootswatch 5.1 (mismatched) + ngx‑bootstrap 8 | Bootstrap 5.3 + bootswatch 5.3 + ngx‑bootstrap (Angular‑matched) |
| Frontend build output | `client/` → `../API/wwwroot` (via `angular.json`) | same path, but new builder needs an `outputPath` tweak (see §10.4) |
| Tests | Karma + Jasmine (only scaffolding, no real specs) | keep Karma through the chain; optional switch to Vitest/Jest at the end |

**Sizes:** ~2,750 lines C# (9 controllers, 4 repos, 2 services, 3 hubs). Angular: 20
components, 8 services, 3 guards + 3 HTTP interceptors + 1 resolver, ~2,500 lines. Small —
the Angular chain is mostly mechanical.

**Angular has no long‑LTS.** Majors ship ~every 6 months and are supported ~18 months
(6 active + 12 LTS). "Latest" as of now is **v21** (Nov 2025); **v20** (May 2025) is the
conservative target. The upgrade process is identical either way — if a required library
(see §11) has not shipped a v21‑compatible release yet, stop at v20 and finish the last hop
later.

---

## 1. Decisions to lock before starting

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | .NET 8 vs 9 vs 10 | **.NET 10 (LTS)** | .NET 8 LTS ends Nov 2026; .NET 9 STS already near EOL. 5→10 directly is fine. |
| D2 | Keep `Startup.cs` or minimal hosting | **Minimal hosting** (single `Program.cs`) | ~60 lines total; removes "which method runs when"; matches every current template. |
| D3 | AutoMapper 14 pin vs 15 (licensed) vs remove | **Pin `AutoMapper` 14.0.0** now | v15+ (Jun 2025) needs a commercial license key. 14.0.0 is the last MIT release, runs on .NET 10. |
| D4 | Npgsql timestamp behavior | **Legacy switch now**, UTC‑native later | Npgsql 6+ changed `DateTime`→`timestamptz`; code writes `DateTime.Now` (Local) against 2022 `timestamp` columns. |
| D5 | Swagger UI | **Upgrade Swashbuckle to 9.x** (or `Microsoft.AspNetCore.OpenApi` + Scalar) | UI is currently commented out, low‑stakes. |
| D6 | Angular target | **v21 if all libs support it, else v20**; upgrade **one major at a time** | `ng update` refuses multi‑major jumps; each hop has schematics + peer‑dep bumps. |
| D7 | Standalone migration | **Yes**, once on v17+ (`bootstrapApplication` + `app.config.ts`) | v19 makes standalone the default; NgModules become the legacy path. Small here (one `AppModule`). |
| D8 | Control‑flow migration (`@if`/`@for`) | **Yes** (run the schematic on v17+) | Removes `CommonModule` directive imports; official direction. ~15 templates, automated. |
| D9 | Guards/resolver style | **Convert to functional** (`CanActivateFn`, `CanDeactivateFn`, `ResolveFn`) at v15–16 | Class `CanActivate`/`Resolve` interfaces deprecated since v15.2. 4 files. |
| D10 | Karma → Vitest/Jest | **Defer**; keep Karma through the chain, switch (or drop) at the end | No real specs exist, so it never blocks a hop. |
| D11 | `ng2-file-upload` / `@kolkov/ngx-gallery` | **Replace** (native `FormData` upload; `ng-gallery`) | Both lag modern Angular — see §11. |

---

## 2. Prerequisites (one‑time, local machine)

Already present: .NET 10 SDK (`10.0.300`), `dotnet-ef` `10.0.0`, Node `20.11.1`,
Docker `27.5.1`, npm `10.9.1`.

1. **Node → 22 LTS** (`nvm install 22 && nvm use 22`). Angular 18+ needs Node ≥ 20.19 / 22.12;
   Node 22 covers the entire 14→21 chain in one install. `20.11.1` is too old for the later hops.
2. **HTTPS dev cert**: `dotnet dev-certs https --trust` (Angular dev server calls `https://localhost:5001`).
3. **`dotnet-ef`**: already 10.0.0. If it drifts: `dotnet tool update -g dotnet-ef --version 10.*`.
4. **PostgreSQL 16** via Docker — add `docker-compose.yml` at repo root:

   ```yaml
   services:
     db:
       image: postgres:16-alpine
       environment:
         POSTGRES_USER: appuser
         POSTGRES_PASSWORD: "Pa$$$$w0rd"   # compose collapses $$ -> $, so 4 = "Pa$$w0rd"
         POSTGRES_DB: datingapp
       ports: ["5432:5432"]
       volumes: ["dbdata:/var/lib/postgresql/data"]
   volumes:
     dbdata:
   ```
   `docker compose up -d db`. The app's `appsettings.Development.json` password is literally
   `Pa$$w0rd` (two `$`); match it exactly.

5. **Strong `TokenKey`** (see G1) — 64+ chars in `API/appsettings.Development.json`.
   PowerShell: `[Convert]::ToBase64String((1..64 | % {Get-Random -Max 256}))`.
6. Clean git tree before each `ng update` (the CLI requires it). `npm i -g @angular/cli` is
   optional — the plan uses the project‑local CLI via `npx ng`.

---

## 3. Backend — package matrix (`API/API.csproj`)

| Package | Current | Target | Action |
|---|---|---|---|
| SDK TFM | `net5.0` | `net10.0` | change `<TargetFramework>` |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | 5.0.15 | `10.0.*` | bump |
| `Microsoft.AspNetCore.Identity.EntityFrameworkCore` | 5.0.0‑preview.8 | `10.0.*` | bump, drop preview |
| `Microsoft.EntityFrameworkCore.Design` | 5.0.15 | `10.0.*` | bump |
| `Microsoft.EntityFrameworkCore.Sqlite` | 5.0.15 | — | **remove** (unused; `Data/-- SQLite.sql` is dead) |
| `Npgsql.EntityFrameworkCore.PostgreSQL` | 5.0.0 | `10.0.*` | bump — **breaking**, see G2 |
| `AutoMapper.Extensions.Microsoft.DependencyInjection` | 11.0.0 | — | **remove** (folded into `AutoMapper` core since v13) |
| `AutoMapper` | (transitive) | `14.0.0` | **add explicit**, pinned (D3) |
| `CloudinaryDotNet` | 1.11.0 | `1.27.*` | bump — `new Cloudinary(new Account(cloud,key,secret))` still valid |
| `Swashbuckle.AspNetCore` | 5.6.3 | `9.0.*` | bump (or replace per D5) |
| `System.IdentityModel.Tokens.Jwt` | 6.16.0 | `8.*` | bump — pulls `Microsoft.IdentityModel.*` v8 |
| `bootstrap` | 5.1.3 | — | **remove** (client‑side lib wrongly referenced in the API project) |

Then `dotnet restore` + `dotnet build` from `API/` and work the errors.

---

## 4. Backend — breaking changes & gotchas (priority order)

### G1 — JWT signing key length (WILL crash on first login)
`Microsoft.IdentityModel` v7+ enforces a minimum HMAC key size. `TokenService` signs with
`HmacSha512Signature` → needs **≥ 64 bytes**. Current key is 28 → `IDX10653`.
Fix: 64+‑char random `TokenKey` in `appsettings.Development.json` and the prod env var. Also
`config["TokenKey"] ?? throw new InvalidOperationException("TokenKey missing")`.

### G2 — Npgsql timestamp mapping (WILL throw on insert/update)
Npgsql 6.0 changed `DateTime` handling: `Kind=Utc` → `timestamptz`; `Kind=Unspecified`/`Local`
→ `timestamp`; writing non‑UTC to `timestamptz` throws. This codebase writes
`DateTime.Now` (Local) for `AppUser.Created`/`LastActive`, seeds bare dates
(`Kind=Unspecified`), and its 2022 migration created `timestamp without time zone` columns
that Npgsql 10 now maps differently. The custom `ApplyUtcDateTimeConverter` only fixes reads.

**Fix (D4):** first line of `Program.cs`:
```csharp
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);
```
Existing migration, data, and `DateTime.Now` keep working; no new migration.
**Later:** switch `AppUser` defaults to `DateTime.UtcNow`, make all writes UTC, drop the
switch, `dotnet ef migrations add UtcTimestamps`.

### G3 — `Startup.cs` → `Program.cs` (minimal hosting, D2)
Replace both files with one top‑level `Program.cs`:

```csharp
using API.Data;
using API.Entities;
using API.Extensions;
using API.Middleware;
using API.SignalR;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true); // G2

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddApplicationServices(builder.Configuration);
builder.Services.AddControllers(o => o.SuppressAsyncSuffixInActionNames = false);
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddCors();
builder.Services.AddIdentityServices(builder.Configuration);
builder.Services.AddSignalR();

var app = builder.Build();

app.UseMiddleware<ExceptionMiddleware>();
app.UseHttpsRedirection();

app.UseCors(x => x
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()
    .WithOrigins("http://localhost:4200"));   // Angular dev server

app.UseAuthentication();
app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();
app.MapHub<PresenceHub>("hubs/presence");
app.MapHub<MessageHub>("hubs/message");
app.MapFallbackToController("Index", "Fallback");

using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    try
    {
        var context = services.GetRequiredService<DataContext>();
        var userManager = services.GetRequiredService<UserManager<AppUser>>();
        var roleManager = services.GetRequiredService<RoleManager<AppRole>>();
        await context.Database.MigrateAsync();
        await Seed.SeedUsers(userManager, roleManager);
    }
    catch (Exception ex)
    {
        services.GetRequiredService<ILogger<Program>>()
            .LogError(ex, "An error occurred during migration");
    }
}

await app.RunAsync();
```
`AddMvc()` + `AddControllers()` was redundant — keep one. Keep
`SuppressAsyncSuffixInActionNames = false` (Users controller relies on it for
`CreatedAtRoute("GetUser")`).

### G4 — Delete template leftovers
`API/Controllers/WeatherForecastController.cs`, `API/WeatherForecast.cs`.

### G5 — `IHeaderDictionary.Add` → `.Append` (analyzer ASP0019)
In `HttpExtensions.AddPaginationHeader` and `ExceptionMiddleware`:
```csharp
response.Headers.Append("Pagination", json);
response.Headers.Append("Access-Control-Expose-Headers", "Pagination");
```

### G6 — AutoMapper namespace/registration
`services.AddAutoMapper(typeof(AutoMapperProfiles).Assembly)` still works with consolidated
`AutoMapper` 14. `AutoMapper.QueryableExtensions` (used by `UserRepository.ProjectTo`) is
now in the core package — keep the `using`.

### G7 — EF Core 10 model warnings (non‑fatal)
`Photo` `[Table("Photos")]` + global `HasQueryFilter(p => p.IsApproved)` behind
`AppUser.Photos` navigation logs `NavigationBaseIncludeIgnored`; the code already handles it
with `IgnoreQueryFilters()` in `UserRepository`. `Message → Sender/Recipient`
`DeleteBehavior.Restrict` still required. Startup `MigrateAsync()` fine.

### G8 — Pre‑existing route‑name bug in `UsersController` (optional fix)
`[HttpPost("add-photo", Name = "GetUser")]` puts the route name on the POST while the GET has
`[ActionName(nameof(GetUser))]`. Move `Name = "GetUser"` to `[HttpGet("{username}")]`.

### G9 — Migrations: regenerate from scratch (decided — `CLAUDE.local.md` D-B5)
Local data is disposable and every environment re-seeds at startup, so drop the 2022 EF-5
migration and author one fresh under EF 10 / Npgsql 10:
```
docker compose down -v            # drop the Postgres volume
rm -rf API/Data/Migrations        # delete PostgresInitial + snapshot
cd API && dotnet ef migrations add InitialCreate
dotnet run                        # startup MigrateAsync applies it, then Seed.SeedUsers
```
Then confirm column types are as expected with the Npgsql legacy switch on (G2): `Created` /
`LastActive` / `DateOfBirth` / `MessageSent` land as `timestamp without time zone`.
Do **not** do this against any real deployed DB with real user data — there is none today.

### G10 — `System.Text.Json` options frozen after first use (.NET 8+)
`HttpExtensions` / `ExceptionMiddleware` `new` an options object per call — safe, just
wasteful; optionally hoist to `static readonly`.

### G11 — Heroku
Free dynos gone (Nov 2022); .NET buildpack is community. Not a local blocker. The
`DATABASE_URL` parser in `ApplicationServiceExtensions` still works; consider `new Uri(...)`
+ `NpgsqlConnectionStringBuilder`. Reconsider Fly.io / Render / Azure Container Apps.

### G12 — C# language version
`net10.0` defaults to C# 14 (was 9). No breaking changes here.

### Backend step sequence
1. `git switch main && git pull && git switch -c migrate/backend-net10`.
2. `docker compose down -v && docker compose up -d db`; set strong 64+ char `TokenKey` in
   `API/appsettings.Development.json`.
3. Edit `API.csproj` (§3): TFM `net10.0`, bump/remove packages, add explicit `AutoMapper` 14.
4. New top-level `Program.cs` (G3) incl. the Npgsql legacy switch (G2); delete `Startup.cs`,
   `WeatherForecastController.cs`, `WeatherForecast.cs` (G4).
5. `Headers.Append` (G5); AutoMapper `using` check (G6); optional G8.
6. `dotnet restore && dotnet build`; clear errors/analyzer warnings.
7. Regenerate migrations (G9): delete `API/Data/Migrations/*`, `dotnet ef migrations add
   InitialCreate`.
8. `dotnet run` (startup auto-migrates + seeds); smoke‑test via Swagger/curl: register, login, `GET /api/users`,
   `POST /api/likes/{username}`, `GET /api/messages?Container=Inbox`, hub connect
   `/hubs/presence?access_token=…`.
9. Update `.vscode/launch.json` `program` path `…/net5.0/…` → `…/net10.0/…`.
10. Commit, tag `backend-net10`.

---

## 5. Frontend — the incremental upgrade loop

`ng update` **will not** jump multiple majors. You perform this loop for **each** of
14 → 15 → 16 → 17 → 18 → 19 → 20 → 21:

```
# from client/, clean git tree, Node 22 active
npx ng update @angular/core@<N> @angular/cli@<N>
npx ng update @angular/cdk@<N>
# bump the third-party libs to their <N>-compatible versions (see §8)
npm install
npx ng build                      # fix compile errors
npx ng serve                      # smoke test (see §13 checklist)
git add -A && git commit -m "chore: Angular <N>"
```

Rules:
- Before the first hop, update to the **latest patch of 13** (`npx ng update @angular/core@13 @angular/cli@13`), get a green `ng build` + `ng serve` on Node 22 — that is your baseline.
- Read the printed schematic notes each hop; run the ones it offers.
- Never skip the build/serve/commit between hops — a broken hop is easy to bisect, a broken chain is not.
- If a required library (§11) has no release for the next major yet, **stop there** and ship; resume when it does.

---

## 6. Frontend — Angular framework refactors (do at the version noted)

### 6.1 Functional guards & resolver — at v15→v16 (D9)
Class `CanActivate` / `CanDeactivate` / `Resolve` are deprecated. Convert the 4 files:

`_guards/auth.guard.ts`:
```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { map } from 'rxjs';
import { AccountService } from '../_services/account.service';

export const authGuard: CanActivateFn = () => {
  const account = inject(AccountService);
  const toastr = inject(ToastrService);
  const router = inject(Router);
  return account.currentUser$.pipe(
    map(user => {
      if (user) return true;
      toastr.error('You shall not pass!');
      return router.parseUrl('/');     // current class version returns undefined — fix it
    })
  );
};
```
- `admin.guard.ts` → `adminGuard: CanActivateFn` (check `roles` includes `Admin`/`Moderator`).
- `prevent-unsaved-changes.guard.ts` → `preventUnsavedChangesGuard: CanDeactivateFn<MemberEditComponent>`.
- `member-detailed.resolver.ts` → `memberDetailedResolver: ResolveFn<Member>` using `inject(MembersService)`.
- Update `app-routing.module.ts` refs: `canActivate: [authGuard]`, `resolve: { member: memberDetailedResolver }`, etc.

### 6.2 Standalone bootstrap — at v17+ (D7)
Run the 3‑step migration:
```
npx ng generate @angular/core:standalone   # step 1: convert declarations to standalone
npx ng generate @angular/core:standalone   # step 2: remove unnecessary NgModules
npx ng generate @angular/core:standalone   # step 3: bootstrapApplication in main.ts
```
Result: delete `app.module.ts`, `app-routing.module.ts`, `_modules/shared.module.ts`; add
`app.config.ts`:
```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),   // keeps the 3 class interceptors
    provideAnimations(),
    { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: JwtInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: LoadingInterceptor, multi: true },
    importProvidersFrom(BsDropdownModule.forRoot(), ToastrModule.forRoot(), /* ngx-* .forRoot() */),
  ],
};
```
`main.ts`: `bootstrapApplication(AppComponent, appConfig)`.
(Optional later: convert the 3 interceptors to functional `HttpInterceptorFn` +
`withInterceptors([...])` and drop the `HTTP_INTERCEPTORS` block.)

### 6.3 Control‑flow migration — at v17+ (D8)
```
npx ng generate @angular/core:control-flow
```
Rewrites `*ngIf` / `*ngFor` / `*ngSwitch` → `@if` / `@for` / `@switch` across all ~15
templates. Review `member-list`, `messages`, `member-detail` diffs (they have the most).

### 6.4 `inject()` migration — optional, v19+
```
npx ng generate @angular/core:inject
```
Converts constructor DI to `inject()`. Cosmetic; safe to skip.

---

## 7. Frontend — Bootstrap 4 → 5 (do at v15, when ngx‑bootstrap v10 forces it)

`ngx-bootstrap` v10+ requires **Bootstrap 5**. `package.json` today has `bootstrap@4.6.1`
**and** `bootswatch@5.1.3` (already inconsistent) and `angular.json` loads both v4 and v5
CSS. Bump `bootstrap` → `5.3.x`, `bootswatch` → `5.3.x`, remove jQuery assumptions, then
sweep templates.

Find the affected classes/attributes:
```
grep -rEn "form-group|form-inline|form-row|custom-select|custom-control|custom-file|input-group-(append|prepend)|\bml-|\bmr-|\bpl-|\bpr-|float-(left|right)|text-(left|right)|badge-(primary|secondary|success|danger|warning|info|light|dark)|\bclose\b|sr-only|no-gutters|data-toggle|data-target|dropdown-menu-right|jumbotron|card-deck|\bmedia\b|btn-block" client/src
```
Rename map (most likely to appear in `nav`, `register`, `member-edit`, `member-list`,
`messages`, `photo-editor`, `roles-modal`):

| Bootstrap 4 | Bootstrap 5 |
|---|---|
| `ml-*` / `mr-*` | `ms-*` / `me-*` |
| `pl-*` / `pr-*` | `ps-*` / `pe-*` |
| `float-left` / `float-right` | `float-start` / `float-end` |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `form-group` | (removed — use spacing utils, e.g. `mb-3`) |
| `form-inline` | (removed — use `d-flex` / grid) |
| `custom-select` | `form-select` |
| `custom-control custom-checkbox` / `custom-switch` | `form-check` / `form-check form-switch` |
| `custom-file` | `form-control` (native file input) |
| `.input-group-append` / `.input-group-prepend` | put the child directly in `.input-group` |
| `badge-primary` … | `text-bg-primary` … (and `.badge` no longer needs `.badge-pill`; use `rounded-pill`) |
| `.close` | `.btn-close` (no `&times;` content needed) |
| `.sr-only` | `.visually-hidden` |
| `.no-gutters` | `.g-0` |
| `data-toggle` / `data-target` | `data-bs-toggle` / `data-bs-target` |
| `.dropdown-menu-right` | `.dropdown-menu-end` |
| `.jumbotron` | (removed — compose with utilities / `p-5 bg-body-tertiary rounded`) |
| `.card-deck` | (removed — use grid `row-cols-*`) |
| `.media` | (removed — use flex utilities) |
| `.btn-block` | `.d-grid` on the parent (or `w-100`) |

`home.component.html` uses `.jumbotron`; `nav.component.html` uses the ngx‑bootstrap
dropdown + an inline login form; `roles-modal` / `confirm-dialog` use `.close`. Re‑test
those screens specifically.

---

## 8. Frontend — third‑party dependency matrix

Bump each library **during the hop that first requires it** (its `peerDependencies` must
allow your Angular major — check with `npm info <pkg> peerDependencies` or the library's
compatibility table; exact numbers below are the shape, verify at upgrade time).

| Package | Current | Direction | Notes |
|---|---|---|---|
| `@angular/*`, `@angular/cli`, `@angular/cdk`, `@angular/animations` | 13.3 | → 21.x | one major per hop, `ng update` |
| `typescript` | 4.6.2 | → ~5.9 | `ng update` picks the right minor per hop |
| `zone.js` | 0.11.4 | → ~0.15 | `ng update` handles (unless you go zoneless — don't, for this migration) |
| `rxjs` | 7.5.0 | → 7.8.x | bump around v16; **no rxjs 8 needed** |
| `@types/node` | ^12 | → ^22 | match Node 22 |
| `bootstrap` | 4.6.1 | → 5.3.x | **CSS breaking**, §7; jQuery no longer needed |
| `bootswatch` | 5.1.3 | → 5.3.x | already v5, align to bootstrap |
| `ngx-bootstrap` | 8.0.0 | → Angular‑matched (v10 = ng15, v11 = ng16, v12 = ng17, then majors track Angular) | requires Bootstrap 5 from v10 |
| `ngx-toastr` | 14.2.3 | → Angular‑matched (tracks major) | `ToastrModule.forRoot()` API stable |
| `ngx-spinner` | 13.1.1 | → Angular‑matched | `NgxSpinnerModule.forRoot()`; check the `type` animation import path in `angular.json` |
| `@microsoft/signalr` | 6.0.5 | → 8.x | Angular‑independent; do it any time |
| `@fortawesome/fontawesome-free` | 6.1.1 | → 6.7.x / 7.x | CSS only |
| `font-awesome` | 4.7.0 | **remove** | duplicate legacy v4; `angular.json` loads its CSS — delete that line too |
| `ngx-timeago` | 2.0.0 | → check, likely **replace** | see §11 |
| `@kolkov/ngx-gallery` | 2.0.1 | **replace → `ng-gallery` (+ `ng-gallery/lightbox`)** | see §11 |
| `ng2-file-upload` | 1.4.0 | **replace → native `HttpClient` + `FormData`** | see §11 |
| `@angular-devkit/build-angular` | 13.3 | → `@angular/build` 21.x | builder migration at v17, §10.4 |
| dev: `karma*`, `jasmine-core`, `@types/jasmine` | 6.3 / 4.0 / 3.10 | → keep matched, or replace at end (D10) | jasmine 4→5, karma 6.3→6.4 |

---

## 9. Frontend — milestone notes (what actually changes each hop)

- **13 → 14**: TypeScript 4.7. **Typed Reactive Forms** land — `ng update` runs the
  `migration-v14-typed-forms` schematic (adds `UntypedFormGroup`/`UntypedFormControl` where
  it can't infer). Check `register.component.ts`, `member-edit.component.ts`, and the custom
  `_forms/text-input` / `date-input` `ControlValueAccessor` components compile. Standalone
  APIs are preview (ignore).
- **14 → 15**: Standalone stable; `provideHttpClient` available (defer use to v17). **Do the
  Bootstrap 4→5 sweep (§7)** because `ngx-bootstrap` must go to v10 here. **Convert guards +
  resolver to functional (§6.1)** — class interfaces are now deprecated. `ngx-spinner` /
  `ngx-toastr` bump.
- **15 → 16**: `rxjs@7.8`. `takeUntilDestroyed`, required inputs (not needed). esbuild dev
  server available (preview). Nothing forced beyond peer bumps.
- **16 → 17**: **Biggest hop.** New build system: migrate
  `@angular-devkit/build-angular:browser` → `@angular/build:application` (§10.4) — the CLI
  offers this; **you must fix `outputPath`** or `FallbackController` breaks. Run
  **standalone migration (§6.2)** and **control‑flow migration (§6.3)** now. Node ≥ 18.13.
  `angular.json` `polyfills` becomes an array.
- **17 → 18**: `polyfills.ts` / `test.ts` files removed (moved into `angular.json` /
  `main.ts`) — the schematic handles it. Angular Material not used, skip Material 3. Verify
  the replaced file‑upload + gallery code (§11) still builds.
- **18 → 19**: **standalone is the default**; the migration flags any remaining
  `standalone: false`. `inject()` migration available (§6.4, optional). HMR on by default.
- **19 → 20**: TypeScript ~5.8; signals (`effect`, `linkedSignal`, `toSignal`) stable — no
  change required. `TestBed` tweaks (only matters if you add specs). Node ≥ 20.19.
- **20 → 21**: latest. TypeScript ~5.9; mostly deprecation removals — the build errors will
  point to exact replacements. Only take this hop once §11 libraries have v21 releases.

---

## 10. Frontend — cross‑cutting mechanics

### 10.1 HTTP interceptors
The 3 class interceptors (`ErrorInterceptor`, `JwtInterceptor`, `LoadingInterceptor`) keep
working via `provideHttpClient(withInterceptorsFromDi())` + the `HTTP_INTERCEPTORS`
multi‑providers in `app.config.ts` (§6.2). No logic change needed. Optional later: rewrite as
`HttpInterceptorFn`.

### 10.2 `environment.ts`
`fileReplacements` (`environment.ts` → `environment.prod.ts`) is still supported by the new
builder — no change. Keep `apiUrl: 'https://localhost:5001/api/'` / `hubUrl:
'.../hubs/'` for dev. (Optional: add `client/proxy.conf.json` mapping `/api` + `/hubs` to
`https://localhost:5001` and serve with `ng serve --proxy-config` so the browser is
same‑origin and CORS is moot — not required, the server already whitelists `:4200`.)

### 10.3 SignalR
`@microsoft/signalr` 6 → 8: `HubConnectionBuilder`, `withUrl(..., { accessTokenFactory })`,
`withAutomaticReconnect()`, `.on(...)` — all unchanged. `message.service.ts` /
`presence.service.ts` need no edits beyond the version bump.

### 10.4 Build output path (v17 builder migration) — **critical**
The new `@angular/build:application` builder writes to `dist/<project>/browser/` by default.
This app builds into `../API/wwwroot` and `FallbackController` serves
`wwwroot/index.html`. If output lands in `wwwroot/browser/`, SPA serving breaks. In
`angular.json`, set:
```jsonc
"outputPath": { "base": "../API/wwwroot", "browser": "" }
```
so files land directly in `wwwroot/`. Also confirm `assets` (favicon, `src/assets`), the
`styles` array (bootstrap, bootswatch `united`, font‑awesome, ngx‑spinner animation css,
`styles.css`, ngx‑toastr css, ngx‑bootstrap datepicker css), `index`, and `main` still
resolve. Remove the `font-awesome@4` css line (§8). Budgets carry over.

### 10.5 `polyfills`
After v18 there is no `src/polyfills.ts`; `angular.json` has `"polyfills": ["zone.js"]`.
The migration schematic does this — just verify.

---

## 11. Frontend — known‑risk libraries & replacements

### `@kolkov/ngx-gallery` (used in `member-detail`) → **`ng-gallery`**
`@kolkov/ngx-gallery` stalled around Angular 14–15. Replace with **`ng-gallery`** +
**`ng-gallery/lightbox`** (actively tracks Angular majors).
- `npm remove @kolkov/ngx-gallery && npm i ng-gallery`
- `member-detail.component.ts`: build `GalleryItem[]` from `member.photos` (map `url` →
  `new ImageItem({ src: p.url, thumb: p.url })`) instead of `NgxGalleryImage[]`.
- Template: `<gallery [items]="images" />` (or the lightbox variant). Drop
  `NgxGalleryOptions`/`NgxGalleryImage` imports and the options array.
- Add `provideLightbox()` / `GalleryModule` to `app.config.ts`.
- Do this at **v15** (when the old lib stops building).

### `ng2-file-upload` (used in `photo-editor`) → **native `HttpClient` upload**
Removes a churny dependency. The API is `POST /api/users/add-photo`, multipart, field name
**`file`**, returns `201` + `PhotoDto`.
```ts
uploadPhoto(file: File) {
  const form = new FormData();
  form.append('file', file);
  return this.http.post<Photo>(this.baseUrl + 'users/add-photo', form, {
    reportProgress: true, observe: 'events',
  });
}
```
Template: an `<input type="file">` (+ optional drag/drop directive), a progress bar bound to
`HttpEventType.UploadProgress`, and your existing "set main" / "delete" buttons
(`PUT users/set-main-photo/{id}`, `DELETE users/delete-photo/{id}`). Keep the "photo is
unapproved until an admin approves it" note in the UI. Do this at **v15–16**.

### `ngx-timeago` (used for message/last‑active times)
Check `npm info ngx-timeago` for a release matching your Angular major. If it lags, replace
with a tiny pipe over `date-fns`:
```ts
@Pipe({ name: 'timeago', standalone: true })
export class TimeagoPipe implements PipeTransform {
  transform(value: string | Date) { return formatDistanceToNow(new Date(value), { addSuffix: true }); }
}
```
(`npm i date-fns`). Decide at whichever hop `ngx-timeago` first fails to install.

### `ngx-bootstrap`
Not abandoned, but its major must match Angular and it **requires Bootstrap 5** from v10.
Used for: dropdown (`nav`), tabs (`member-detail` — `?tab=` deep link), modal
(`roles-modal`, `confirm-dialog`), datepicker (`member-edit` / `register` DOB),
buttons/pagination. All APIs are stable across the versions; the risk is purely the
Bootstrap 5 CSS (§7).

---

## 12. Cleanup & docs (after reaching the target major)

- Remove `font-awesome@4`, dedupe icon CSS.
- (Optional) Karma → Vitest (`@angular/build:unit-test`, experimental in v20) or Jest; or
  delete test scaffolding if you won't write specs.
- (Optional) Convert the 3 interceptors to functional `HttpInterceptorFn`.
- Delete `_modules/shared.module.ts`, `app.module.ts`, `app-routing.module.ts` if the
  standalone migration left stubs.
- `angular.json`: drop dead `styles` entries, confirm `outputPath` (§10.4).
- Update `CLAUDE.md` frontend section (standalone, functional guards, new builder,
  Bootstrap 5, `ng-gallery`, native upload).
- Update `.vscode/tasks.json` — add `npx ng serve` / `npx ng build` tasks.
- Update CI / Heroku build: `npm --prefix client ci && npm --prefix client run build &&
  dotnet publish API -c Release`.

---

## 13. Local run & smoke test (end state)

### Start
```
docker compose up -d db
# terminal 1
cd API && dotnet watch run          # https://localhost:5001  (auto-migrate + seed)
# terminal 2
cd client && npx ng serve           # http://localhost:4200
```
Seed users: `lisa` … / `Pa$$w0rd`; admin: `admin` / `Pa$$w0rd`.

### Checklist (every current feature — run after each Angular hop, and again at the end)
1. Register a new user → logged in; presence hub connects (online count updates).
2. Log in as `lisa` and (separately) `admin`.
3. Members list: pagination, age/gender/orderBy filters, Like a member.
4. Member detail: **photo gallery** (`ng-gallery`), About/Interests **tabs**, `?tab=`
   deep‑link from the new‑message toast, **Messages tab** loads the thread over SignalR,
   send a message.
5. Lists page: "Members I like" / "Members who like me", paginated.
6. Messages page: Unread / Inbox / Outbox; delete a message.
7. Two browsers, two users: real‑time message delivery + "X has sent you a new message"
   toast (deep‑links to `/members/x?tab=3`); online/offline presence.
8. Member edit: change bio → Save; navigate away while dirty → `preventUnsavedChangesGuard`
   confirm fires.
9. Photo editor: upload via the **native `FormData`** path → shows on your profile as
   unapproved, **not** in the members list.
10. As `admin`: Admin panel → approve the photo (now visible) / reject flow; edit a user's
    roles via the **modal**.
11. Errors page: 400 / 401 / 404 / 500 buttons → toast, `/not-found`, `/server-error`
    (stack trace shown in Development).
12. **Prod‑mode**: `cd client && npx ng build` → open `https://localhost:5001` directly;
    `FallbackController` serves `wwwroot/index.html`; repeat 3–11. (Confirms §10.4
    `outputPath` is right.)

### Publish
```
cd client && npx ng build              # emits into API/wwwroot
cd API && dotnet publish -c Release      # -> API/bin/Release/net10.0/publish
```
Prod env: `ASPNETCORE_ENVIRONMENT=Production`, `TokenKey` (64+ chars), `DATABASE_URL`,
`CloudinarySettings__CloudName/ApiKey/ApiSecret`.

---

## 14. Post‑migration cleanups (optional, later)

- Remove AutoMapper entirely (D3 alt): replace `ProjectTo<MemberDto>` in `UserRepository`
  with explicit `.Select(u => new MemberDto { … })`; delete `AutoMapperProfiles`. ~60 lines,
  one fewer dependency + license risk gone.
- Go UTC‑native on Postgres (G2 part 2); drop the legacy switch.
- Enable nullable reference types on the API; fix per file.
- Swashbuckle → `Microsoft.AspNetCore.OpenApi` + `Scalar.AspNetCore`.
- Replace the manual `DATABASE_URL` split with `Uri` + `NpgsqlConnectionStringBuilder`.
- Move `CloudinarySettings` / `TokenKey` to user‑secrets (dev) / env vars (prod).
- Angular: consider zoneless (`provideExperimentalZonelessChangeDetection`) and signal‑based
  inputs once on v20+ — separate effort, not part of this migration.
- Add Playwright e2e covering the §13 checklist.
- Reconsider hosting now that Heroku's free tier is gone.
```
