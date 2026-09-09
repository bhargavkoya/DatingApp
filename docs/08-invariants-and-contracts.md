# 08 — Invariants & Contracts ("do not break these")

The migration must keep every item below **byte-for-byte / behaviour-for-behaviour** unless a
stage explicitly, reviewably changes it and this file is updated in the same PR (decision
D-P4). This is the checklist for **Gate A** (agent review).

---

## A. REST API surface

Base path `/api`. Controller route = `api/[controller]` (lower-cased controller name).

| Method & path | Auth | Request | Success | Notes |
|---|---|---|---|---|
| `POST /api/account/register` | — | `RegisterDto` | `200` `UserDto` (no `photoUrl`) | `400 "Username is taken"` / Identity error array |
| `POST /api/account/login` | — | `LoginDto` | `200` `UserDto` (with `photoUrl`) | `401 "Invalid username"` / `401` |
| `GET /api/users` | JWT | query `UserParams` | `200` `MemberDto[]` + `Pagination` header | gender defaults to opposite |
| `GET /api/users/{username}` | JWT | — | `200` `MemberDto` | own profile ignores photo filter |
| `PUT /api/users` | JWT | `MemberUpdateDto` | `204` | `400 "Failed to update user"` on no-op |
| `POST /api/users/add-photo` | JWT | multipart, field **`file`** | `201` `PhotoDto` + `Location` | route name `GetUser` |
| `PUT /api/users/set-main-photo/{photoId}` | JWT | — | `204` | `400` if already main |
| `DELETE /api/users/delete-photo/{photoId}` | JWT | — | `200` | `400` if main, `404` if missing |
| `POST /api/likes/{username}` | JWT | — | `200` | `400` self / already-liked, `404` missing |
| `GET /api/likes` | JWT | query `LikesParams` (`predicate`=`liked`\|`likedBy`) | `200` `LikeDto[]` + `Pagination` header | |
| `POST /api/messages` | JWT | `CreateMessageDto` | `200` `MessageDto` | `400` self, `404` recipient |
| `GET /api/messages` | JWT | query `MessageParams` (`Container`=`Unread`\|`Inbox`\|`Outbox`) | `200` `MessageDto[]` + `Pagination` header | param name capital `C` |
| `DELETE /api/messages/{id}` | JWT | — | `200` | `401` if not a party; physical delete only when both sides deleted |
| `GET /api/admin/users-with-roles` | policy `RequireAdminRole` | — | `200` `[{id, username, roles[]}]` | |
| `POST /api/admin/edit-roles/{username}?roles=a,b` | policy `RequireAdminRole` | roles in **query string** | `200` `string[]` | |
| `GET /api/admin/photos-to-moderate` | policy `ModeratePhotoRole` | — | `200` `PhotoForApprovalDto[]` | |
| `POST /api/admin/approve-photo/{id}` | policy `ModeratePhotoRole` | — | `200` | side effect: sets `IsMain` if user has none |
| `POST /api/admin/reject-photo/{id}` | policy `ModeratePhotoRole` | — | `200` | Cloudinary destroy if `PublicId` |
| `GET /api/buggy/*` | mixed | — | `400/401/404/500` | drives `TestErrorsComponent` |
| `GET /` and any non-API route | — | — | `wwwroot/index.html` | `FallbackController` |

**Do not:** rename routes, change verbs, change the multipart field name, move `roles` from
query to body, change status codes, or wrap list bodies in an envelope.

---

## B. JSON wire format

- **Casing:** camelCase everywhere (ASP.NET Core default + explicit `JsonSerializerOptions`
  with `JsonNamingPolicy.CamelCase` in `HttpExtensions` and `ExceptionMiddleware`).
- **DTO shapes** — fields must stay exactly as in `API/DTOs/*` and `client/src/app/_models/*`:
  - `UserDto`: `username, token, photoUrl, knownAs, gender`
  - `MemberDto`: `id, username, photoUrl, age, knownAs, created, lastActive, gender,
    introduction, lookingFor, interests, city, country, photos: PhotoDto[]`
  - `PhotoDto`: `id, url, isMain, isApproved`
  - `MessageDto`: `id, senderId, senderUsername, senderPhotoUrl, recipientId,
    recipientUsername, recipientPhotoUrl, content, dateRead?, messageSent` —
    `senderDeleted` / `recipientDeleted` are **`[JsonIgnore]`**, must not appear.
  - `LikeDto`: `id, username, age, knownAs, photoUrl, city`
  - `PhotoForApprovalDto`: `id, url, username, isApproved`
- **Dates:** serialized as ISO-8601 UTC with a trailing `Z` (result of
  `ApplyUtcDateTimeConverter` making reads `Kind=Utc`). The SPA parses these into `Date`.
  Keeping the `Z` is an invariant — verify after any Npgsql/timestamp change.
- **Error body** (`ApiException`): `{ statusCode, message, details? }`, camelCase, `details`
  present only in Development.

---

## C. Pagination protocol

- Request: `pageNumber`, `pageSize` query params (plus feature-specific params). `pageSize`
  server-capped at **50**; server default **10** (FE often sends its own smaller size).
- Response: **body is the raw array**; a **`Pagination`** response header carries
  `{ currentPage, itemsPerPage, totalItems, totalPages }` (camelCase JSON).
- `Access-Control-Expose-Headers: Pagination` **must** be sent (the SPA reads the header
  cross-origin in dev). `paginationHelper.getPaginatedResult` + `getPaginationHeaders` on the
  client depend on this exact protocol.

---

## D. Auth contract

- **JWT claims:** `nameid` = user id (int as string), `unique_name` = username, `role` =
  string when one role else array. `ClaimsPrincipleExtensions.GetUserId()` /
  `GetUsername()` and `AccountService.setCurrentUser` both depend on these claim names.
- **Signing:** HMAC-SHA512 with `config["TokenKey"]`; 7-day expiry. (Key must become ≥ 64
  chars for the .NET 10 libs — `MIGRATION_PLAN.md` §G1 — but the *scheme* stays.)
- **Validation:** signature only (no issuer/audience). Keep `ValidateIssuer = false`,
  `ValidateAudience = false` unless deliberately hardening later.
- **SignalR auth:** token via **`access_token` query-string** for any path starting `/hubs`
  (`JwtBearerEvents.OnMessageReceived`). Any dev-proxy / hosting change must keep query-string
  auth working for `/hubs/*` (and WebSocket upgrade).
- **CORS (dev):** exact origin `http://localhost:4200`, `AllowCredentials`, any header/method.
- Client trusts its stored token until a `401`; no refresh, no client-side expiry check.

---

## E. SignalR event contract

Event **names**, **payload shapes**, and **connection query params** are a hard contract
(full table in `06-realtime-signalr.md`):

| Hub | Event | Payload |
|---|---|---|
| presence | `UserIsOnline` / `UserIsOffline` | `string` |
| presence | `GetOnlineUsers` | `string[]` |
| presence | `NewMessageReceived` | `{ username, knownAs }` |
| message | `ReceiveMessageThread` | `MessageDto[]` |
| message | `NewMessage` | `MessageDto` |
| message | `UpdatedGroup` | `{ name, connections: [{connectionId, username}] }` |
| message (C→S) | `SendMessage` | `{ recipientUsername, content }` |

- Message hub connect URL requires `?user=<otherUsername>`.
- Hub method name `SendMessage` (invoked from `MemberMessagesComponent`).
- Group name algorithm: two usernames, `string.CompareOrdinal`, smaller first, `-` separator.

---

## F. Data / DB invariants

- **`Photo` global query filter `IsApproved == true`** — and the four
  `IgnoreQueryFilters()` escape hatches (own profile, `GetUserByPhotoId`, `GetPhotoById`,
  `GetUnapprovedPhotos`). Removing or widening the filter changes what every user sees.
- **`UserLike` composite PK `(SourceUserId, LikedUserId)`**, cascade delete both FKs.
- **`Message`** FKs to Sender/Recipient are `OnDelete(Restrict)` (deliberate — avoids
  multiple cascade paths). Per-side soft delete; physical delete only when both flags set.
- **`Group.Name`** is the PK; **`Connection.ConnectionId`** is the effective key.
- Startup runs `MigrateAsync()` then idempotent `Seed.SeedUsers` (no-ops if any user exists).
- Seeded users: `UserSeedData.json` names lower-cased, password `Pa$$w0rd`, `Member` role,
  first photo approved. `admin` / `Pa$$w0rd` → `Admin` + `Moderator`.

---

## G. Behavioural invariants (subtle, easy to regress)

1. **Every authenticated API call updates `AppUser.LastActive`** (`LogUserActivity` filter on
   `BaseApiController`).
2. **`IUnitOfWork.Complete()` returns `false` for a no-op save** → callers return
   `BadRequest`/`400`. A no-change `PUT /api/users` returns `400 "Failed to update user"`.
3. **Opening a chat marks messages to you as read** (`GetMessageThread` sets `DateRead`, hub
   persists via `HasChanges()` → `Complete()`).
4. **Sending to someone currently in the chat group sets `DateRead` immediately**; otherwise
   they get a `NewMessageReceived` toast (if online) that deep-links to
   `/members/<username>?tab=3`.
5. **Approving a photo auto-promotes it to main** if the user has no main photo.
6. **Member list gender defaults to the opposite of the caller's** when not specified.
7. **`member-detail` tab order** — the `?tab=N` deep link and `selectTab(index)` rely on it;
   the Messages tab's `heading === 'Messages'` string gates hub connect/disconnect.
8. **The SPA caches members** (`memberCache` Map) with no invalidation on edit/like/photo.
9. **Presence hub connects on login and on page refresh** (`AppComponent`), disconnects on
   logout.
10. **Prod = one origin:** SPA served from `API/wwwroot`, deep links via
    `MapFallbackToController`. The Angular 17 build-system change must keep output landing
    directly in `wwwroot/` (not `wwwroot/browser/`) — `MIGRATION_PLAN.md` §10.4.

---

## H. Build / run invariants

- `client` build `outputPath` → `../API/wwwroot` (adjust builder config, not the target, at
  Angular 17).
- API dev URL `https://localhost:5001`; SPA dev URL `http://localhost:4200`; these are baked
  into `environment.ts` and the CORS rule.
- `ASPNETCORE_ENVIRONMENT=Development` selects the local connection string (branch in
  `ApplicationServiceExtensions`) and enables stack traces in `ExceptionMiddleware`.
- Startup must still auto-migrate + seed.

---

## How to use this file in a review

For each changed file in a stage PR, Gate A asks:
1. Does this touch anything in A–H? If yes, is the change **required** by the migration step,
   and is the contract preserved?
2. If a contract genuinely must change, is it called out in the PR description and updated
   here in the same commit?
3. Run the relevant `07-feature-workflows.md` flow mentally end-to-end — does it still hold?
