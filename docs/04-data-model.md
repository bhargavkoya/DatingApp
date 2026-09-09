# 04 — Data Model (EF Core / PostgreSQL)

`DataContext` (`API/Data/DataContext.cs`) extends
`IdentityDbContext<AppUser, AppRole, int, IdentityUserClaim<int>, AppUserRole,
IdentityUserLogin<int>, IdentityRoleClaim<int>, IdentityUserToken<int>>` — i.e. ASP.NET Core
Identity with **`int` primary keys** and a **custom user-role join entity** (`AppUserRole`).

## Entities

### `AppUser : IdentityUser<int>` (`Entities/AppUser.cs`)
Identity columns (Id, UserName, NormalizedUserName, Email, PasswordHash, SecurityStamp, …) plus:

| Property | Type | Notes |
|---|---|---|
| `DateOfBirth` | `DateTime` | only the date part is meaningful; drives `Age` via `CalculateAge()` |
| `KnownAs` | `string` | display name |
| `Created` | `DateTime` | **default `DateTime.Now` (Local kind)** — see the Npgsql note below |
| `LastActive` | `DateTime` | **default `DateTime.Now`**; then overwritten with `DateTime.UtcNow` by `LogUserActivity` on every authed request |
| `Gender` | `string` | `"male"` / `"female"` (string, not enum) |
| `Introduction`, `LookingFor`, `Interests`, `City`, `Country` | `string` | profile text |
| `Photos` | `ICollection<Photo>` | |
| `LikedByUsers` | `ICollection<UserLike>` | rows where this user is the `LikedUser` |
| `LikedUsers` | `ICollection<UserLike>` | rows where this user is the `SourceUser` |
| `MessagesSent` / `MessagesReceived` | `ICollection<Message>` | |
| `UserRoles` | `ICollection<AppUserRole>` | |

### `AppRole : IdentityRole<int>` (`Entities/AppRole.cs`)
Adds `UserRoles : ICollection<AppUserRole>`. Seeded roles: **`Member`**, **`Admin`**,
**`Moderator`**.

### `AppUserRole : IdentityUserRole<int>` (`Entities/AppUserRole.cs`)
Join row. Adds navs `User : AppUser` and `Role : AppRole`. Keys inherited
(`UserId` + `RoleId`).

### `Photo` (`Entities/Photo.cs`) — `[Table("Photos")]`
| Property | Type | Notes |
|---|---|---|
| `Id` | `int` | PK |
| `Url` | `string` | Cloudinary secure URL |
| `IsMain` | `bool` | exactly one per user should be `true` |
| `PublicId` | `string` | Cloudinary handle (null for seeded photos) — used for delete |
| `IsApproved` | `bool` | **global query filter target** (below) |
| `AppUser` / `AppUserId` | | owner (FK) |

### `UserLike` (`Entities/UserLike.cs`)
No `Id`. **Composite PK `(SourceUserId, LikedUserId)`**. Navs `SourceUser`, `LikedUser`.
Both FKs `OnDelete(Cascade)`.

### `Message` (`Entities/Message.cs`)
| Property | Type | Notes |
|---|---|---|
| `Id` | `int` | PK |
| `SenderId` / `SenderUsername` / `Sender` | | denormalised username kept alongside the FK |
| `RecipientId` / `RecipientUsername` / `Recipient` | | |
| `Content` | `string` | |
| `DateRead` | `DateTime?` | null = unread |
| `MessageSent` | `DateTime` | **default `DateTime.UtcNow`** |
| `SenderDeleted` / `RecipientDeleted` | `bool` | per-side soft delete; row is physically removed only when **both** are true |

### `Group` (`Entities/Group.cs`) — SignalR message groups
`[Key] public string Name` (PK is the group name). `Connections : ICollection<Connection>`
(init `new List<>()`). Group name = the two usernames ordered by `CompareOrdinal`, joined
with `-` (see `06-realtime-signalr.md`).

### `Connection` (`Entities/Connection.cs`)
`ConnectionId : string` (SignalR connection id, the effective key), `Username : string`.

## `OnModelCreating` configuration

```csharp
AppUser  .HasMany(u => u.UserRoles).WithOne(x => x.User).HasForeignKey(x => x.UserId).IsRequired();
AppRole  .HasMany(r => r.UserRoles).WithOne(x => x.Role).HasForeignKey(x => x.RoleId).IsRequired();

UserLike .HasKey(k => new { k.SourceUserId, k.LikedUserId });
UserLike .HasOne(s => s.SourceUser).WithMany(l => l.LikedUsers ).HasForeignKey(s => s.SourceUserId).OnDelete(Cascade);
UserLike .HasOne(s => s.LikedUser ).WithMany(l => l.LikedByUsers).HasForeignKey(s => s.LikedUserId ).OnDelete(Cascade);

Message  .HasOne(m => m.Recipient).WithMany(u => u.MessagesReceived).OnDelete(Restrict);
Message  .HasOne(m => m.Sender   ).WithMany(u => u.MessagesSent    ).OnDelete(Restrict);

Photo    .HasQueryFilter(p => p.IsApproved);          // GLOBAL FILTER

builder.ApplyUtcDateTimeConverter();                  // custom, see below
```

### The `IsApproved` global query filter — important
Every query over `Photos` (including `Include(u => u.Photos)` from `AppUser`) is silently
filtered to `IsApproved == true`. Consequences relied on across the app:
- New uploads (`IsApproved == false`) are invisible in member lists, member detail for
  *other* users, and the message-thread photo URLs, **until an Admin/Moderator approves**.
- Code paths that must see unapproved photos call **`.IgnoreQueryFilters()`**:
  `UserRepository.GetMemberAsync(username, isCurrentUser: true)` (your own profile),
  `UserRepository.GetUserByPhotoId`, `PhotoRepository.GetPhotoById`,
  `PhotoRepository.GetUnapprovedPhotos`.
- `AutoMapperProfiles` maps `PhotoUrl` from `Photos.FirstOrDefault(x => x.IsMain).Url`. If a
  user has **no approved main photo**, that projection is over an empty/filtered set →
  `PhotoUrl` is null (the SPA falls back to a placeholder image). Don't "harden" this during
  migration.

### `ApplyUtcDateTimeConverter` (`UtcDateAnnotation` in `DataContext.cs`)
Post-configuration loop over every entity's `DateTime` / `DateTime?` property: sets a
`ValueConverter` that, **on read**, does `DateTime.SpecifyKind(v, DateTimeKind.Utc)`. It does
**not** change values on write (`v => v`). So the DB is treated as storing UTC, and read-back
values come out `Kind=Utc` (so the JSON serializer appends `Z`).
- ⚠️ This is the crux of the Npgsql upgrade risk (see `MIGRATION_PLAN.md` §G2, decision
  D-B4): the write side still sends whatever `Kind` the value has (`DateTime.Now` → Local),
  which Npgsql 6+ rejects for `timestamptz` columns unless the legacy switch is on.

## Migrations

`API/Data/Migrations/` — a **single** migration `20220521104304_PostgresInitial` (+
`DataContextModelSnapshot`). Generated with EF Core 5 / Npgsql 5, so `DateTime` columns are
`timestamp without time zone`.

Applied automatically at startup (`Program.Main` → `context.Database.MigrateAsync()`). Add a
new migration only when the model changes:
`dotnet ef migrations add <Name>` (from `API/`, needs the `dotnet-ef` tool).

## Seeding — `API/Data/Seed.cs` + `API/Data/UserSeedData.json`

`Seed.SeedUsers`:
1. If any user exists → return (idempotent).
2. Create roles `Member`, `Admin`, `Moderator`.
3. Deserialize `Data/UserSeedData.json` → `List<AppUser>`. For each: mark the first photo
   `IsApproved = true`, lower-case `UserName`, `userManager.CreateAsync(user, "Pa$$w0rd")`,
   add to `Member` role.
4. Create `admin` / `Pa$$w0rd`, add to `Admin` + `Moderator`.

Seed JSON dates (`DateOfBirth`, `Created`, `LastActive`) are bare `yyyy-MM-dd` strings →
deserialize as `Kind=Unspecified` (another input to the Npgsql timestamp concern).

## ER summary

```
AppUser 1───* Photo
AppUser 1───* AppUserRole *───1 AppRole
AppUser 1───* Message (as Sender)      Message *───1 AppUser (Recipient)
AppUser *───* AppUser  via UserLike (SourceUser / LikedUser), composite PK

Group 1───* Connection            (SignalR messaging bookkeeping; not linked to AppUser by FK)
```
