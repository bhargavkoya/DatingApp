# 02 — Backend (`API/`)

ASP.NET Core 5 Web API. ~2,750 lines of C#. No test project.

## Bootstrap & HTTP pipeline

`Program.Main` (`API/Program.cs`):
1. Build the generic host (`Host.CreateDefaultBuilder` → `UseStartup<Startup>`).
2. In a DI scope: resolve `DataContext`, `UserManager<AppUser>`, `RoleManager<AppRole>`;
   `await context.Database.MigrateAsync()`; `await Seed.SeedUsers(userManager, roleManager)`.
   Any exception here is logged, not fatal.
3. `await host.RunAsync()`.

`Startup.ConfigureServices` (`API/Startup.cs`):
- `services.AddApplicationServices(_config)` — see below.
- `AddMvc(o => o.SuppressAsyncSuffixInActionNames = false)` **and** `AddControllers()`
  (the `AddMvc` call is redundant with `AddControllers`, but the `SuppressAsyncSuffixInActionNames
  = false` option matters — `UsersController` uses action-name routing).
- `AddSwaggerGen` (registered; **UI is commented out** in `Configure`).
- `AddCors` with a named policy `"AllowAnyOrigin"` (defined but **not** the one actually
  used — see pipeline below).
- `services.AddIdentityServices(_config)` — see `05-auth-and-security.md`.
- `services.AddSignalR()`.

`Startup.Configure` — pipeline order (do not reorder blindly):
```
UseMiddleware<ExceptionMiddleware>()      // outermost: converts unhandled exceptions to JSON
UseHttpsRedirection()
UseRouting()
UseCors( AllowAnyHeader + AllowAnyMethod + AllowCredentials + WithOrigins("http://localhost:4200") )
UseAuthentication()
UseAuthorization()
UseDefaultFiles()                         // serve wwwroot/index.html at "/"
UseStaticFiles()                          // serve the built SPA assets
UseEndpoints:
    MapControllers()
    MapHub<PresenceHub>("hubs/presence")
    MapHub<MessageHub>("hubs/message")
    MapFallbackToController("Index", "Fallback")   // SPA deep links
```
Note the CORS call in the pipeline uses an **inline** policy (with `AllowCredentials` +
`WithOrigins`), not the `"AllowAnyOrigin"` named policy from `ConfigureServices`.

## Service registration — `Extensions/ApplicationServiceExtensions.cs`

| Registration | Lifetime | Notes |
|---|---|---|
| `PresenceTracker` | **Singleton** | in-memory online-users dictionary |
| `IOptions<CloudinarySettings>` | — | `config.GetSection("CloudinarySettings")` |
| `IPhotoService` → `PhotoService` | Scoped | Cloudinary upload/delete |
| `LogUserActivity` | Scoped | action filter (below) |
| `ITokenService` → `TokenService` | Scoped | JWT creation |
| `IUnitOfWork` → `UnitOfWork` | Scoped | the only data entry point for controllers/hubs |
| AutoMapper | — | `AddAutoMapper(typeof(AutoMapperProfiles).Assembly)` |
| `DataContext` | Scoped (`AddDbContext`) | `UseNpgsql(connStr)`; conn string resolved dev-vs-Heroku by reading `ASPNETCORE_ENVIRONMENT` directly |

The individual repo registrations (`IUserRepository`, `ILikesRepository`,
`IMessageRepository`) are **commented out** — repos are only reachable via `IUnitOfWork`.

## Layering

```
Controller / Hub
   │  depends on IUnitOfWork (+ IMapper, IPhotoService, UserManager where needed)
   ▼
IUnitOfWork  (UnitOfWork)
   │  lazily news up a repository per access, sharing one DataContext
   ▼
IUserRepository / IMessageRepository / ILikesRepository / IPhotoRepository
   │  EF Core queries; some project straight to DTOs via AutoMapper ProjectTo
   ▼
DataContext (EF Core)  →  PostgreSQL
```

### Unit of Work — `Data/UnitOfWork.cs`
```csharp
public IUserRepository    UserRepository    => new UserRepository(_context, _mapper);
public IMessageRepository MessageRepository => new MessageRepository(_context, _mapper);
public ILikesRepository   LikesRepository   => new LikesRepository(_context);
public IPhotoRepository   PhotoRepository   => new PhotoRepository(_context);
public async Task<bool> Complete()  => await _context.SaveChangesAsync() > 0;
public bool HasChanges()            => _context.ChangeTracker.HasChanges();
```
- A **new repository instance per property access**, all sharing the one scoped
  `DataContext` (so change tracking is shared).
- `Complete()` returns **`true` only if ≥ 1 row changed**. The universal controller idiom:
  ```csharp
  _unitOfWork.SomeRepository.DoStagingCall(...);
  if (await _unitOfWork.Complete()) return Ok();      // or NoContent / CreatedAtRoute
  return BadRequest("Failed to ...");
  ```
  ⚠️ A no-op update (same values) makes `Complete()` return `false` → the caller returns
  `BadRequest`. Existing behaviour; don't "fix" it during migration.
- Repos with a `void` staging method (`AddMessage`, `DeleteMessage`, `AddGroup`,
  `RemoveConnection`, `RemovePhoto`, `Update`) only mark the context; nothing persists until
  `Complete()`.

### Repositories (method-level summary)

**`UserRepository`** (`Data/UserRepository.cs`)
| Method | Returns | Notes |
|---|---|---|
| `GetMembersAsync(UserParams)` | `PagedList<MemberDto>` | filters: not-self, opposite gender, DOB range from min/max age, `OrderBy` `created`\|`lastActive`; `ProjectTo<MemberDto>` + `AsNoTracking` |
| `GetMemberAsync(username)` | `MemberDto` | `ProjectTo` |
| `GetMemberAsync(username, bool isCurrentUser)` | `MemberDto` | if `isCurrentUser` → `IgnoreQueryFilters()` so the caller sees their own unapproved photos |
| `GetUserByUsernameAsync` | `AppUser` | `Include(Photos)` |
| `GetUserByIdAsync` | `AppUser` | `FindAsync` |
| `GetUserByPhotoId(photoId)` | `AppUser` | `Include(Photos).IgnoreQueryFilters()` |
| `GetUserGender(username)` | `string` | scalar |
| `Update(AppUser)` | void | sets `EntityState.Modified` |

**`MessageRepository`** (`Data/MessageRepository.cs`)
| Method | Notes |
|---|---|
| `AddMessage` / `DeleteMessage` | stage add/remove |
| `GetMessage(id)` | `Include(Sender)`, `Include(Recipient)` |
| `GetMessagesForUser(MessageParams)` | `ProjectTo<MessageDto>` then filter by `Container`: `Inbox` (recipient == me && !RecipientDeleted), `Outbox` (sender == me && !SenderDeleted), default/`Unread` (recipient == me && !RecipientDeleted && DateRead == null); ordered by `MessageSent` desc; paged |
| `GetMessageThread(currentUsername, recipientUsername)` | both directions, respects per-side delete flags; ordered `MessageSent` asc; **marks unread messages addressed to `currentUsername` as read** (`DateRead = UtcNow`) — persistence happens because `MessageHub` calls `Complete()` when `HasChanges()` |
| `AddGroup` / `GetMessageGroup(name)` / `GetGroupForConnection(connId)` / `RemoveConnection` / `GetConnection` | SignalR message-group bookkeeping (see `06-realtime-signalr.md`) |

**`LikesRepository`** (`Data/LikesRepository.cs`)
| Method | Notes |
|---|---|
| `GetUserLike(sourceId, likedId)` | composite-key `FindAsync` |
| `GetUserWithLikes(userId)` | `Include(LikedUsers)` — needed to append a new `UserLike` |
| `GetUserLikes(LikesParams)` | `Predicate == "liked"` → users this user liked; `"likedBy"` → users who liked this user; projects to `LikeDto`; paged |

**`PhotoRepository`** (`Data/PhotoRepository.cs`)
| Method | Notes |
|---|---|
| `GetPhotoById(id)` | `IgnoreQueryFilters()` (so moderation can load unapproved) |
| `GetUnapprovedPhotos()` | `IgnoreQueryFilters().Where(!IsApproved)` → `PhotoForApprovalDto` |
| `RemovePhoto(photo)` | stage remove |

## Controllers

All under `api/[controller]` (kebab of the endpoint via routes). Every real controller derives
from **`BaseApiController`**, which carries `[ApiController]`, `[Route("api/[controller]")]`,
and `[ServiceFilter(typeof(LogUserActivity))]`.

| Controller | Auth | Endpoints (method → route) |
|---|---|---|
| `AccountController` | anonymous | `POST register`, `POST login` |
| `UsersController` | `[Authorize]` | `GET /` (`UserParams` query), `GET /{username}`, `PUT /`, `POST add-photo`, `PUT set-main-photo/{photoId}`, `DELETE delete-photo/{photoId}` |
| `LikesController` | `[Authorize]` | `POST /{username}` (add like), `GET /` (`LikesParams` query) |
| `MessagesController` | `[Authorize]` | `POST /` (create), `GET /` (`MessageParams` query), `DELETE /{id}` |
| `AdminController` | policy-based | `GET users-with-roles` + `POST edit-roles/{username}?roles=` (`RequireAdminRole`); `GET photos-to-moderate` + `POST approve-photo/{id}` + `POST reject-photo/{id}` (`ModeratePhotoRole`) |
| `BuggyController` | mixed | deliberate 400/401/404/500 for the SPA's error-handling test page |
| `FallbackController` | anonymous | `Index` → `PhysicalFile(wwwroot/index.html)` |
| `WeatherForecastController` | — | **template leftover, unused** |

### `UsersController` routing quirk (pre-existing)
`[HttpGet("{username}")]` has `[ActionName(nameof(GetUser))]`; `[HttpPost("add-photo", Name =
"GetUser")]` puts the route **name** on the POST; `AddPhoto` returns
`CreatedAtRoute("GetUser", new { username })`. It resolves today but the name is on the wrong
action. Leave it during migration unless a framework version breaks it (noted in
`MIGRATION_PLAN.md` §G8).

## Cross-cutting

### `LogUserActivity` (`Helpers/LogUserActivity.cs`)
`IAsyncActionFilter` applied to every `BaseApiController` action. After the action runs: if the
user is authenticated, load `AppUser` by id and set `LastActive = DateTime.UtcNow`, then
`uow.Complete()`. So **every authenticated API call writes to the DB.**

### Error handling (`Middleware/ExceptionMiddleware.cs`)
Catches unhandled exceptions → `500` + JSON body
`ApiException { statusCode, message, details? }` (camelCase). `details` = stack trace only when
`IHostEnvironment.IsDevelopment()`. The SPA's `ErrorInterceptor` depends on this shape for the
`/server-error` page.

### Pagination (`Helpers/`)
- Request: `PaginationParams` base (`PageNumber` default 1, `PageSize` default 10, **capped at
  50**). `UserParams` / `LikesParams` / `MessageParams` extend it.
- Query: `PagedList<T> : List<T>` with `CurrentPage/TotalPages/PageSize/TotalCount`;
  `PagedList<T>.CreateAsync(IQueryable, page, size)` does `CountAsync` + `Skip/Take`.
- Response: `HttpExtensions.AddPaginationHeader` writes a **`Pagination`** response header
  (JSON `PaginationHeader { currentPage, itemsPerPage, totalItems, totalPages }`, camelCase)
  **plus** `Access-Control-Expose-Headers: Pagination` so the browser can read it cross-origin.
  The response **body is the array**, not a wrapper.

### AutoMapper (`Helpers/AutoMapperProfiles.cs`)
| Map | Custom members |
|---|---|
| `AppUser → MemberDto` | `PhotoUrl` = main photo URL; `Age` = `DateOfBirth.CalculateAge()` |
| `Photo → PhotoDto` | — |
| `MemberUpdateDto → AppUser` | — (profile edit) |
| `RegisterDto → AppUser` | — (register) |
| `Message → MessageDto` | `SenderPhotoUrl` / `RecipientPhotoUrl` = each party's main photo |

`UserRepository` and `MessageRepository` use `.ProjectTo<TDto>(_mapper.ConfigurationProvider)`
to push the projection into SQL.

### `ClaimsPrincipleExtensions`
`User.GetUsername()` → `ClaimTypes.Name` (the JWT `unique_name`); `User.GetUserId()` →
`int.Parse(ClaimTypes.NameIdentifier)` (the JWT `nameid`). Used everywhere in controllers/hubs.

### `DateTimeExtensions.CalculateAge(dob)`
Year diff minus 1 if the birthday hasn't happened yet this year. Used for `MemberDto.Age` and
`LikeDto.Age`.

## Known rough edges (do not fix during migration)
- Build artifacts (`API/bin`, `API/obj`) were committed to git — being untracked in the setup
  stage (decision D-P3).
- `AddMvc` + `AddControllers` redundancy.
- `WeatherForecastController` / `API/WeatherForecast.cs` unused.
- `Npgsql`/`Sqlite` both referenced; only Npgsql is wired.
- `appsettings.Development.json` contains a real-looking Cloudinary secret.
