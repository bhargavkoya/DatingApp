# 07 — Feature Workflows

Each feature: the user story, the screens, the endpoints/events, the end-to-end data flow, and
**what to be careful of** when changing anything near it. "FE" = `client/`, "BE" = `API/`.

Legend for endpoints: all REST paths are under `/api`. Auth = requires a valid JWT.

---

## F1 — Register

**Story:** a visitor creates an account and is immediately logged in.

**Screens:** `HomeComponent` (toggles `registerMode`) → `RegisterComponent` (reactive form).

**Flow:**
1. FE form fields: `gender` (default `male`), `username`, `knownAs`, `dateOfBirth`, `city`,
   `country`, `password` (4–8), `confirmPassword` (custom `matchValues('password')`).
   `maxDate` = today − 18y.
2. `AccountService.register(form.value)` → `POST account/register` with `RegisterDto`.
3. BE `AccountController.Register`: `UserExists?` → `400 "Username is taken"`; `_mapper.Map<AppUser>(dto)`;
   `_userManager.CreateAsync(user, dto.Password)` (Identity password rules apply — see below);
   `AddToRoleAsync(user, "Member")`; lower-cases `UserName`; returns
   `UserDto { username, token, knownAs, gender }` (**no `photoUrl`** on register).
4. FE `setCurrentUser` (decode token → roles, persist, `next`), `presence.createHubConnection`,
   `router.navigateByUrl('/members')`.

**Careful with:**
- Password mismatch: FE form min 4 / DTO min 4, but **Identity requires ≥ 6 + digit + upper +
  lower** → a 4–5 char or all-lower password passes FE validation then fails at
  `CreateAsync` → `400` with an Identity error array, which `ErrorInterceptor` throws and
  `RegisterComponent` shows in `validationErrors`. Keep this behaviour.
- `RegisterDto.DateOfBirth` is `DateTime`; only the date matters.
- `_mapper.Map<AppUser>(registerDto)` relies on the `RegisterDto → AppUser` map — property
  names must line up.

---

## F2 — Login / session restore / logout

**Story:** returning user signs in; a page refresh keeps them signed in.

**Screens:** login form lives in `NavComponent` (bound to `model`).

**Flow (login):**
1. `AccountService.login(model)` → `POST account/login` (`LoginDto { username, password }`).
2. BE: load user by lower-cased username `Include(Photos)`; `null` → `401 "Invalid username"`;
   `_signInManager.CheckPasswordSignInAsync(user, pwd, false)`; fail → `401`; returns
   `UserDto { username, token, photoUrl = main photo url, knownAs, gender }`.
3. FE `map` → `setCurrentUser` + `presence.createHubConnection`. `NavComponent` then
   `router.navigateByUrl('/members')` + success toast; on error toasts `error.error`.

**Flow (restore):** `AppComponent.ngOnInit` → `setCurrentUser` reads `localStorage['user']`;
if present, re-hydrates `currentUser$` and reconnects presence. No server round-trip, no
expiry check.

**Flow (logout):** `NavComponent.logout` → `navigateByUrl('/')` → `AccountService.logout`
(clear storage, `next(null)`, stop presence hub).

**Careful with:**
- The stored `User` object shape (`_models/user.ts`) — `roles` is added client-side from the
  token, it is not on the server `UserDto`.
- `login` returns `photoUrl` but `register` does not — the SPA tolerates `undefined`.
- Presence hub lifecycle is tied to login/restore/logout — don't break the pairing.

---

## F3 — Browse members (list + filters + pagination + cache)

**Story:** logged-in user browses other members, filters by age/gender, sorts, pages.

**Screens:** `MemberListComponent` + `MemberCardComponent`. Route `members` (AuthGuard).

**Flow:**
1. `MembersService.userParams` is seeded once from `currentUser$` — `gender` defaults to the
   **opposite** of the current user's gender; `minAge 18, maxAge 99, pageSize 5, orderBy
   'lastActive'` (FE class defaults; BE defaults differ: `pageSize 10, maxAge 150`).
2. `loadMembers()` → `MembersService.getMembers(userParams)`:
   - Cache key = `Object.values(userParams).join('-')`. If `memberCache` has it → return
     cached `PaginatedResult` via `of(...)`.
   - Else `getPaginatedResult<Member[]>('users', params)` with `pageNumber, pageSize, minAge,
     maxAge, gender, orderBy`; on response, store in `memberCache`.
3. BE `UsersController.GetUsers([FromQuery] UserParams)`:
   - `userParams.CurrentUsername = User.GetUsername()`; if `Gender` empty → set to opposite of
     the caller's gender (`UserRepository.GetUserGender`).
   - `UserRepository.GetMembersAsync(userParams)`: exclude self, filter gender, DOB between
     `Today.AddYears(-maxAge-1)` and `Today.AddYears(-minAge)`, order by `Created` or
     `LastActive` desc, `ProjectTo<MemberDto>().AsNoTracking()`, `PagedList.CreateAsync`.
   - `Response.AddPaginationHeader(...)`; body = `MemberDto[]`.
4. `MemberCardComponent`: shows main photo (or placeholder), online dot from
   `presence.onlineUsers$`, a Like button (F5).

**Careful with:**
- **The `Pagination` response header** (camelCase JSON) + `Access-Control-Expose-Headers` —
  `paginationHelper.getPaginatedResult` reads it; the body stays a bare array.
- The `memberCache` `Map` — `resetUserParams()` rebuilds params; there's **no cache
  invalidation** on profile edit / like / photo change (stale data is accepted). Don't add
  invalidation during migration.
- FE/BE default divergence (pageSize, maxAge) is real and harmless — leave it.
- `getMember(username)` reads from `memberCache` values first (so detail can render without a
  round-trip if you came from the list).

---

## F4 — Member detail (profile + gallery + tabs + messages)

**Story:** open one member; see photos, about, interests, likes, and a live chat tab.

**Screens:** `MemberDetailComponent` (route `members/:username`, resolver
`MemberDetailedResolver`).

**Flow:**
1. Resolver → `MembersService.getMember(username)` (cache-first, else `GET users/{username}`).
   BE `UsersController.GetUser`: `GetMemberAsync(username, isCurrentUser: currentUsername ==
   username)` — `isCurrentUser` → `IgnoreQueryFilters()` so you see your own unapproved
   photos.
2. `route.data.member` populates the component; `route.queryParams.tab` selects a tab
   (`?tab=3` → Messages, used by the new-message toast deep-link).
3. Gallery: `@kolkov/ngx-gallery`, `galleryImages` built from `member.photos[].url`.
4. `onTabActivated`: entering **Messages** with `messages.length === 0` →
   `messageService.createHubConnection(user, member.username)` (see F7). Any other tab / leave
   / destroy → `messageService.stopHubConnection()`.

**Careful with:**
- The tab `heading === 'Messages'` string check drives hub connect/disconnect — renaming the
  tab breaks chat.
- `@ViewChild('memberTabs', {static: true})` + `selectTab` indexes into `memberTabs.tabs` —
  tab **order** matters for the `?tab=N` deep link.
- `MemberDetailComponent` reads `currentUser$` via `take(1)` in the constructor.

---

## F5 — Likes (send a like + "liked" / "liked by" lists)

**Story:** like a member; later view who you liked and who liked you.

**Screens:** Like button on `MemberCardComponent` / `MemberDetailComponent`;
`ListsComponent` (route `lists`) with a `predicate` toggle.

**Flow (add like):**
1. `MembersService.addLike(username)` → `POST likes/{username}` (empty body).
2. BE `LikesController.AddLike`: `sourceUserId = User.GetUserId()`; load liked user; load
   `sourceUser` via `LikesRepository.GetUserWithLikes` (needs `Include(LikedUsers)`);
   `404` if liked user missing; `400 "You cannot like yourself"`; `400 "You already like this
   user"` if `GetUserLike(source, liked)` exists; else `sourceUser.LikedUsers.Add(new
   UserLike { SourceUserId, LikedUserId })`; `Complete()` → `Ok()` / `BadRequest`.

**Flow (lists):**
1. `ListsComponent.loadLikes()` → `MembersService.getLikes(predicate, pageNumber, pageSize)`
   (`predicate` `'liked'` | `'likedBy'`, `pageSize = 2`) → `GET likes?predicate=…&pageNumber=…&pageSize=…`.
2. BE `LikesController.GetUserLikes([FromQuery] LikesParams)`: `UserId = User.GetUserId()`;
   `LikesRepository.GetUserLikes` → `"liked"` = users where `SourceUserId == me`; `"likedBy"`
   = users where `LikedUserId == me`; project to `LikeDto { id, username, age, knownAs,
   photoUrl, city }`; paged; `AddPaginationHeader`.

**Careful with:**
- `UserLike` has a **composite PK** and **cascade delete** on both FKs.
- `GetUserWithLikes` must `Include(LikedUsers)` or the `.Add` won't be tracked into the
  collection.
- No "unlike" endpoint exists.

---

## F6 — Messages page (containers + delete)

**Story:** see unread / inbox / outbox message lists; delete a message.

**Screens:** `MessagesComponent` (route `messages`).

**Flow:**
1. `container` = `'Unread'` (default) | `'Inbox'` | `'Outbox'`; `pageSize = 5`.
   `MessageService.getMessages(page, size, container)` → `GET messages?Container=…` (note the
   capital `C`), plus pagination params.
2. BE `MessagesController.GetMessagesForUser([FromQuery] MessageParams)`: `Username =
   User.GetUsername()`; `MessageRepository.GetMessagesForUser`:
   - `ProjectTo<MessageDto>`, then filter by `Container`:
     - `Inbox` → `RecipientUsername == me && !RecipientDeleted`
     - `Outbox` → `SenderUsername == me && !SenderDeleted`
     - default (`Unread`) → `RecipientUsername == me && !RecipientDeleted && DateRead == null`
   - order `MessageSent` desc; paged; `AddPaginationHeader`.
3. Delete: `MessagesComponent.deleteMessage(id)` → `ConfirmService.confirm(...)` (modal) →
   `MessageService.deleteMessage(id)` → `DELETE messages/{id}`; FE splices the row out.
4. BE `MessagesController.DeleteMessage`: load `GetMessage(id)` (`Include` Sender+Recipient);
   `401` if the caller is neither party; set `SenderDeleted` / `RecipientDeleted` for the
   caller's side; if **both** true → `MessageRepository.DeleteMessage` (physical remove);
   `Complete()` → `Ok()` / `BadRequest`.

**Careful with:**
- `MessageDto` `SenderDeleted` / `RecipientDeleted` are `[JsonIgnore]` — not on the wire.
- `GetMessage(id)` has **no null check** in `DeleteMessage` — a bad id NPEs on
  `message.Sender`. Pre-existing; leave it (see `05-auth-and-security.md`).
- The query-param name is **`Container`** (capital C), unusual for a query string.

---

## F7 — 1-to-1 chat (SignalR thread)

**Story:** on a member's Messages tab, exchange messages live; read receipts update.

**Screens:** `MemberDetailComponent` → Messages tab → `MemberMessagesComponent`
(`OnPush`, `@Input() messages`, `@Input() username`).

**Flow:** fully in `06-realtime-signalr.md#messaging--messagehub`. Summary:
1. Tab activated → `MessageService.createHubConnection(user, member.username)` →
   connect `/hubs/message?user=<other>&access_token=<jwt>`.
2. Server adds a `Connection` to the deterministic `Group`, emits `UpdatedGroup`, sends
   `ReceiveMessageThread` (and marks messages to the caller as read).
3. `MemberMessagesComponent.sendMessage` → `hubConnection.invoke('SendMessage',
   {recipientUsername, content})`.
4. Server: if the recipient's `Connection` is in the group → `DateRead = UtcNow` immediately;
   else notify via presence `NewMessageReceived`. Persists, then `NewMessage` to the group.
5. `UpdatedGroup` with the other user present → FE marks thread messages read.
6. Leaving the tab / destroy → `stopHubConnection()` → server removes the `Connection`,
   re-emits `UpdatedGroup`.

**Careful with:**
- The message hub also **REST-persists** messages — `MessagesController.CreateMessage` exists
  (`POST messages`) but the SPA's live path uses the hub's `SendMessage`. Both build a
  `Message` the same way. Keep both working.
- `busyService.busy()/idle()` is called around hub `start()` in `MessageService` — the global
  spinner shows during connect.
- Self-messaging is blocked in **both** the hub (`HubException`) and the controller (`400`).

---

## F8 — Photos: upload, set main, delete (member side)

**Story:** on Edit Profile, a user uploads photos, picks a main one, deletes photos.

**Screens:** `MemberEditComponent` (route `member/edit`, `canDeactivate`
`PreventUnsavedChangesGuard`) hosts `PhotoEditorComponent` (`@Input() member`).

**Flow (upload):**
1. `ng2-file-upload` `FileUploader` → `POST users/add-photo`, header `Authorization: Bearer
   <token>` (set as `authToken`), field name **`file`**, `allowedFileType ['image']`,
   `maxFileSize 10MB`, `autoUpload false`.
2. BE `UsersController.AddPhoto(IFormFile file)`: load user `Include(Photos)`;
   `PhotoService.AddPhotoAsync(file)` → Cloudinary upload (500×500 fill, face gravity);
   on error → `400`; build `Photo { Url = SecureUrl, PublicId }` (**`IsApproved` defaults
   false**, `IsMain` not set here); `user.Photos.Add(photo)`; `Complete()` →
   `CreatedAtRoute("GetUser", { username }, PhotoDto)`.
3. FE `onSuccessItem`: push the `Photo` into `member.photos`; if `isMain` (won't be on first
   upload) update `user/member.photoUrl` + `setCurrentUser`.

**Flow (set main):** `MembersService.setMainPhoto(id)` → `PUT users/set-main-photo/{id}`.
BE: load user `Include(Photos)`; `400` if already main; unset current main, set new main;
`Complete()` → `NoContent`. FE updates `user.photoUrl`, `member.photoUrl`, re-`setCurrentUser`,
flips `isMain` flags locally.

**Flow (delete):** `MembersService.deletePhoto(id)` → `DELETE users/delete-photo/{id}`.
BE: `404` if not found; `400` if `IsMain`; if `PublicId != null` → `PhotoService.DeletePhotoAsync`
(Cloudinary); `user.Photos.Remove`; `Complete()` → `Ok`. FE filters the photo out of
`member.photos`.

**Careful with:**
- **New photos are `IsApproved == false`** → invisible to others (global query filter) until
  moderation (F9). Your own edit page sees them because `GetUser` uses `isCurrentUser` →
  `IgnoreQueryFilters()`.
- Seeded photos have `PublicId == null` → the delete path skips Cloudinary for them.
- Field name `file` and route `add-photo` are contract.
- `MemberEditComponent` uses a **template-driven** `NgForm` (`#editForm`), not reactive; the
  dirty check (`editForm.dirty`) powers both `@HostListener('window:beforeunload')` and
  `PreventUnsavedChangesGuard`.

---

## F9 — Admin: roles management & photo moderation

**Story:** an Admin manages user roles; Admin/Moderator approve or reject uploaded photos.

**Screens:** `AdminPanelComponent` (tabs) → `UserManagementComponent`,
`PhotoManagementComponent`. Route `admin` (`AdminGuard`: Admin or Moderator).

**Flow (roles):**
1. `AdminService.getUsersWithRoles()` → `GET admin/users-with-roles` (policy
   `RequireAdminRole`). BE returns `[{ id, username, roles: string[] }]`.
2. `UserManagementComponent.openRolesModal(user)` → `RolesModalComponent` (ngx-bootstrap
   modal) seeded with `user` + a checked/unchecked role list (`Admin/Moderator/Member`).
   On submit it emits `updateSelectedRoles`.
3. `AdminService.updateUserRoles(username, roles[])` → `POST admin/edit-roles/{username}?roles=a,b`
   (roles as a **comma-joined query string**). BE `EditRoles`: split `roles`; `AddToRolesAsync`
   the new ones, `RemoveFromRolesAsync` the dropped ones; returns the final role list.
4. FE sets `user.roles` locally.

**Flow (photo moderation):**
1. `AdminService.getPhotosForApproval()` → `GET admin/photos-to-moderate` (policy
   `ModeratePhotoRole`). BE `PhotoRepository.GetUnapprovedPhotos()` →
   `IgnoreQueryFilters().Where(!IsApproved)` → `PhotoForApprovalDto { id, url, username,
   isApproved }`.
2. Approve → `POST admin/approve-photo/{id}`. BE: `GetPhotoById` (ignores filter);
   `IsApproved = true`; `GetUserByPhotoId`; **if the user has no main photo → set this one
   `IsMain = true`**; `Complete()`.
3. Reject → `POST admin/reject-photo/{id}`. BE: `GetPhotoById`; if `PublicId != null` →
   Cloudinary `DestroyAsync`; on `"ok"` (or when `PublicId` is null) →
   `PhotoRepository.RemovePhoto`; `Complete()`.
4. FE splices the row out of `photos`.

**Careful with:**
- `edit-roles` passes roles in the **query string**, not the body.
- Approve has a side effect (auto-set main photo) — keep it.
- Reject deletes from Cloudinary only when `PublicId` is present.
- An Admin can strip their own Admin role (no self-lockout guard).
- These endpoints are **policy**-gated, not just `[Authorize]` — the client `AdminGuard`
  (Admin *or* Moderator) is broader than `RequireAdminRole`; a Moderator sees the Admin panel
  but `users-with-roles` / `edit-roles` will `403` for them. Pre-existing.

---

## F10 — Error handling & the test-errors page

**Story:** consistent handling of API errors; a dev page to exercise each case.

**Screens:** `TestErrorsComponent` (route `errors`, public), `NotFoundComponent`,
`ServerErrorComponent`.

**Flow:**
1. `TestErrorsComponent` buttons call `BuggyController` endpoints returning `400/401/404/500`.
2. `ErrorInterceptor` (`_interceptors/error.interceptor.ts`) maps by status:
   `400` validation array → `throw string[]`; `400` other → toast; `401` → toast; `404` →
   `/not-found`; `500` → `/server-error` with `{ state: { error } }`; default → generic toast.
3. `ServerErrorComponent` reads `history.state.error` (populated by the router navigation
   extras) and shows `message` + `details` (stack trace, dev only — from
   `ExceptionMiddleware`).

**Careful with:**
- The `ApiException` JSON shape (`statusCode`, `message`, `details`, camelCase) is the
  contract between `ExceptionMiddleware` and `ServerErrorComponent`.
- `ErrorInterceptor`'s `400`-with-`error.error.errors` branch is what makes reactive forms
  (`RegisterComponent`) show field errors — it depends on ASP.NET Core's
  `ValidationProblemDetails` shape.
