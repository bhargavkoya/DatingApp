# 05 — Auth & Security

## Identity setup — `Extensions/IdentityServiceExtensions.cs`

```csharp
services.AddIdentityCore<AppUser>(opt => opt.Password.RequireNonAlphanumeric = false)
    .AddRoles<AppRole>()
    .AddRoleManager<RoleManager<AppRole>>()
    .AddSignInManager<SignInManager<AppUser>>()
    .AddRoleValidator<RoleValidator<AppRole>>()
    .AddEntityFrameworkStores<DataContext>();
```
- **`AddIdentityCore`** (not `AddIdentity`) → no cookie auth, no Identity UI. JWT only.
- Password policy: default ASP.NET Core (≥ 6 chars, needs digit + lower + upper) **minus** the
  non-alphanumeric requirement. Note the SPA register form asks for 4–8 chars and the server
  `RegisterDto` has `[StringLength(8, MinimumLength = 4)]` — so a 4–5 char password passes DTO
  validation but is then **rejected by Identity** (`CreateAsync` returns errors → `400` with
  the Identity error list). Pre-existing.

## JWT issuance — `Services/TokenService.cs`

```csharp
claims = [ nameid = user.Id, unique_name = user.UserName,
           ClaimTypes.Role for each role ]
key   = SymmetricSecurityKey(UTF8(config["TokenKey"]))
creds = HmacSha512Signature
token: Expires = DateTime.Now.AddDays(7);  handler = JwtSecurityTokenHandler
```
- Roles are embedded as multiple `ClaimTypes.Role` claims → in the JWT they appear under
  `"role"` as a **string if one role, array if many**.
- `nameid` → `User.GetUserId()`; `unique_name` → `User.GetUsername()`
  (`ClaimsPrincipleExtensions`).
- **`TokenKey`** must be ≥ 64 bytes (`HmacSha512` under `Microsoft.IdentityModel` v8; a
  shorter key throws `IDX10653`). Since stage 1 it is supplied via **.NET user-secrets** in
  Development (`<UserSecretsId>` in `API.csproj`) and via env var / real config elsewhere —
  it is **not** stored in any committed file. (Pre-stage-1 it was a 28-char placeholder in
  `appsettings.Development.json`.)

## JWT validation — `Extensions/IdentityServiceExtensions.cs`

```csharp
services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new()
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(UTF8(config["TokenKey"])),
            ValidateIssuer = false,
            ValidateAudience = false,
        };
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var accessToken = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(accessToken) &&
                    ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    ctx.Token = accessToken;
                return Task.CompletedTask;
            }
        };
    });
```
- Signature only — **no issuer/audience checks**, no clock-skew config (default 5 min).
- **SignalR auth exception:** WebSocket connections can't send an `Authorization` header, so
  for any path under `/hubs` the token is read from the **`access_token` query-string
  parameter**. The SPA passes it via `accessTokenFactory`. Any migration or proxy setup must
  preserve query-string auth for `/hubs/*`.

## Authorization

- Controllers: `UsersController`, `LikesController`, `MessagesController` are `[Authorize]`
  (any authenticated user). `AccountController` is anonymous. `BaseApiController` itself is not
  `[Authorize]` — auth is per controller/action.
- Hubs: both `PresenceHub` and `MessageHub` are `[Authorize]`.
- Policies (`AddAuthorization`):
  | Policy | Rule | Used by |
  |---|---|---|
  | `RequireAdminRole` | role `Admin` | `AdminController.GetUsersWithRoles`, `EditRoles` |
  | `ModeratePhotoRole` | role `Admin` **or** `Moderator` | `AdminController` photo moderation endpoints |
- `_directives/has-role.directive.ts` (`*appHasRole`) gates UI on `currentUser$.roles` — a
  **convenience only**, the server policies are the real gate.

## Client-side token handling — `AccountService`

- On `login`/`register` success and on app start (`AppComponent`), `setCurrentUser(user)`:
  - `getDecodedToken(token)` = `JSON.parse(atob(token.split('.')[1]))` — **no signature
    check, no expiry check** (the client trusts its own stored token until the API 401s).
  - `user.roles = []`; `roles = decoded.role`; `Array.isArray(roles) ? user.roles = roles :
    user.roles.push(roles)` — normalises the string-or-array claim.
  - `localStorage.setItem('user', JSON.stringify(user))`; `currentUserSource.next(user)`.
- `JwtInterceptor` attaches `Authorization: Bearer <token>` to every request when a user
  exists.
- `logout()` removes `localStorage['user']`, `next(null)`, stops the presence hub.
- **Token expiry (7 days) is not handled client-side** — an expired token just starts getting
  `401`s, which `ErrorInterceptor` turns into a toast (no auto-logout / refresh). Pre-existing.

## CORS

`Startup.Configure`:
`UseCors(x => x.AllowAnyHeader().AllowAnyMethod().AllowCredentials().WithOrigins("http://localhost:4200"))`.
- Hard-coded to the Angular dev origin. In production the SPA is same-origin (served from
  `wwwroot`) so CORS never fires.
- `AllowCredentials` + a single explicit origin is required for the SignalR handshake.
- `HttpExtensions.AddPaginationHeader` adds `Access-Control-Expose-Headers: Pagination` so the
  browser can read the pagination header cross-origin.

## Known security weak spots (documented, NOT to be "fixed" during migration)

| Area | Issue |
|---|---|
| `TokenKey` | now in user-secrets / env (stage 1); ensure prod sets its own value, distinct from dev |
| Cloudinary secret | lives in `API/appsettings.json`, which is **git-ignored** (not in the repo); still a plaintext-on-disk secret locally |
| JWT | no issuer/audience validation; no refresh; 7-day lifetime; client never checks expiry |
| `AuthGuard` | returns `undefined` instead of `false`/`UrlTree` on failure |
| `MessagesController.DeleteMessage` | `GetMessage(id)` can return null → `message.Sender.UserName` would NPE if `id` doesn't exist (no null check) |
| Password rules | SPA/DTO (4–8) inconsistent with Identity (≥6 + complexity) |
| `EditRoles` | an Admin can remove their own `Admin` role (no self-lockout guard) |

These are tracked here so a reviewer can confirm the migration **neither fixes nor worsens**
them. The security pass is post-migration.
