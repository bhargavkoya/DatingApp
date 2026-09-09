# 03 — Frontend (`client/`)

Angular 13.3, Angular CLI, RxJS 7.5. One `AppModule` (no lazy modules). ~2,500 lines across
20 components + 8 services + 3 guards + 3 interceptors + 1 resolver.

## Bootstrap

`src/main.ts` → `platformBrowserDynamic().bootstrapModule(AppModule)`.
`src/index.html` → `<app-root>`, `<base href="/">`, CSP `upgrade-insecure-requests`.
`AppComponent.ngOnInit` → `setCurrentUser()`: reads `localStorage['user']`, and if present
calls `accountService.setCurrentUser(user)` **and** `presence.createHubConnection(user)` — so
a returning user is "logged in" and their presence hub reconnects on page load.

### `AppModule` providers (order matters — interceptors run top-to-bottom)
```
{ provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor,   multi: true }
{ provide: HTTP_INTERCEPTORS, useClass: JwtInterceptor,     multi: true }
{ provide: HTTP_INTERCEPTORS, useClass: LoadingInterceptor, multi: true }
```
Imports: `BrowserModule`, `AppRoutingModule`, `HttpClientModule`, `BrowserAnimationsModule`,
`FormsModule`, `ReactiveFormsModule`, `SharedModule` (`_modules/shared.module.ts` — re-exports
the ngx-bootstrap modules, ngx-toastr, ngx-timeago, ng-gallery, file-upload, etc.),
`NgxSpinnerModule`.

## Routing — `app-routing.module.ts`

```
''                       → HomeComponent                       (public)
'' (AuthGuard)           → children, runGuardsAndResolvers: 'always'
   'members'             → MemberListComponent                 (+AuthGuard again)
   'members/:username'   → MemberDetailComponent               resolve: { member: MemberDetailedResolver }
   'member/edit'         → MemberEditComponent                 canDeactivate: [PreventUnsavedChangesGuard]
   'lists'               → ListsComponent
   'messages'            → MessagesComponent
   'admin'               → AdminPanelComponent                 canActivate: [AdminGuard]
'errors'                 → TestErrorsComponent                 (public)
'not-found'              → NotFoundComponent
'server-error'           → ServerErrorComponent
'**'                     → NotFoundComponent
```
`RouterModule.forRoot(routes)` — no `enableTracing`, default (hash-less) location strategy.

## Services (`_services/`)

| Service | State it owns | Key methods |
|---|---|---|
| **`AccountService`** | `currentUser$` — `ReplaySubject<User>(1)`, mirrored to `localStorage['user']` | `login()` / `register()` → POST, then `setCurrentUser` + `presence.createHubConnection`; `setCurrentUser(user)` decodes the JWT (`JSON.parse(atob(token.split('.')[1]))`), normalises `role` claim (string→`[string]`), stores `roles`; `logout()` clears storage, `next(null)`, stops presence hub |
| **`MembersService`** | `memberCache: Map` keyed by `Object.values(userParams).join('-')`; `userParams: UserParams` seeded from the current user's gender | `getMembers(userParams)` — cache-first, else paginated GET `users`; `getMember(username)` — scans `memberCache` values first, else GET `users/{username}`; `updateMember`, `setMainPhoto`, `deletePhoto`, `addLike`, `getLikes(predicate,page,size)` |
| **`MessageService`** | `messageThread$` — `BehaviorSubject<Message[]>`; one `HubConnection` for the message hub | `createHubConnection(user, otherUsername)` — starts `/hubs/message?user=…`, wires `ReceiveMessageThread` / `NewMessage` / `UpdatedGroup`; `stopHubConnection()`; `sendMessage(username, content)` → `hubConnection.invoke('SendMessage', …)`; `getMessages(page,size,container)` REST; `deleteMessage(id)` REST; `getMessageThread(username)` REST (**unused** — the API endpoint is commented out server-side; the thread comes over SignalR) |
| **`PresenceService`** | `onlineUsers$` — `BehaviorSubject<string[]>`; one `HubConnection` for the presence hub | `createHubConnection(user)` — starts `/hubs/presence`, wires `UserIsOnline` / `UserIsOffline` / `GetOnlineUsers` / `NewMessageReceived` (toast → deep-links `/members/{username}?tab=3`); `stopHubConnection()` |
| **`AdminService`** | none | `getUsersWithRoles`, `updateUserRoles(username, roles[])` (roles passed as `?roles=a,b` query), `getPhotosForApproval`, `approvePhoto(id)`, `rejectPhoto(id)` |
| **`BusyService`** | `busyRequestCount` | `busy()` / `idle()` — ref-counted `ngx-spinner` show/hide |
| **`ConfirmService`** | none | `confirm(title?,message?,ok?,cancel?)` → shows `ConfirmDialogComponent` (ngx-bootstrap modal), returns `Observable<boolean>` from `onHidden` + `content.result` |
| `paginationHelper.ts` (functions, not a service) | — | `getPaginatedResult<T>(url, params, http)` — GET with `observe:'response'`, reads `Pagination` header → `PaginatedResult<T>{ result, pagination }`; `getPaginationHeaders(page, size)` → `HttpParams` |

## HTTP interceptors (`_interceptors/`)

| Interceptor | Behaviour |
|---|---|
| **`ErrorInterceptor`** | `catchError` on every response. `400` with `error.error.errors` → flatten to `string[]` and **`throw`** it (forms catch this into `validationErrors`); `400` object → toast `statusText`; `400` string → toast `error.error`. `401` → toast. `404` → `router.navigateByUrl('/not-found')`. `500` → `navigateByUrl('/server-error', { state: { error: error.error } })`. else → generic toast. Always re-`throwError(error)`. |
| **`JwtInterceptor`** | `take(1)` on `currentUser$`; if a user exists, clone the request with `Authorization: Bearer <token>`. |
| **`LoadingInterceptor`** | `busyService.busy()` before, `finalize(() => busyService.idle())` after — every HTTP call shows the global spinner. |

## Guards & resolver

| File | Type | Behaviour |
|---|---|---|
| `_guards/auth.guard.ts` `AuthGuard` | `CanActivate` | maps `currentUser$` → `true` if user, else toast `'You shall not pass!'` and returns **`undefined`** (falsy → blocks; sloppy but works) |
| `_guards/admin.guard.ts` `AdminGuard` | `CanActivate` | `true` if `roles` includes `Admin` or `Moderator`, else toast |
| `_guards/prevent-unsaved-changes.guard.ts` `PreventUnsavedChangesGuard` | `CanDeactivate<MemberEditComponent>` | if `component.editForm.dirty` → `confirmService.confirm()`, else `true` |
| `_resolvers/member-detailed.resolver.ts` `MemberDetailedResolver` | `Resolve<Member>` | `membersService.getMember(route.paramMap.get('username'))` — feeds `MemberDetailComponent` via `route.data.member` |

_All four are class-based; converting to functional (`CanActivateFn` etc.) is part of the
Angular 15–16 hop — see `MIGRATION_PLAN.md` §6.1._

## Models (`_models/`)

| Model | Shape (camelCase, matches API JSON) |
|---|---|
| `User` | `username, token, photoUrl, knownAs, gender, roles: string[]` |
| `Member` | `id, username, photoUrl, age, knownAs, created, lastActive, gender, introduction, lookingFor, interests, city, country, photos: Photo[]` |
| `Photo` | `id, url, isMain, isApproved, username?` |
| `Message` | `id, senderId, senderUsername, senderPhotoUrl, recipientId, recipientUsername, recipientPhotoUrl, content, dateRead?, messageSent` |
| `Group` | `name, connections: { connectionId, username }[]` |
| `Pagination` | `currentPage, itemsPerPage, totalItems, totalPages`; `PaginatedResult<T> { result, pagination }` |
| `UserParams` (class) | `gender` (defaults to opposite of the user's), `minAge=18, maxAge=99, pageNumber=1, pageSize=5, orderBy='lastActive'` — note server default `pageSize` is 10 and `maxAge` 150 |

## Components (by feature area)

| Area | Components | Notes |
|---|---|---|
| Shell | `AppComponent`, `NavComponent` | nav has an inline login form bound to `model`; on success → `/members` + success toast |
| Home / auth | `HomeComponent` (toggles register mode), `RegisterComponent` | register is a reactive form: username/knownAs/gender/dateOfBirth/city/country + password (4–8) + confirmPassword (custom `matchValues` validator); `maxDate` = today − 18y; on 400 sets `validationErrors` from the thrown array |
| Members | `MemberListComponent` (filters + `pagination`), `MemberCardComponent` (like button, online dot), `MemberDetailComponent`, `MemberEditComponent`, `PhotoEditorComponent`, `MemberMessagesComponent` | see `07-feature-workflows.md` |
| Lists | `ListsComponent` | `predicate` `'liked'` / `'likedBy'`, paginated (`pageSize=2`) |
| Messages | `MessagesComponent` | `container` `Unread`/`Inbox`/`Outbox`, `pageSize=5`, delete via `ConfirmService` |
| Modals | `RolesModalComponent`, `ConfirmDialogComponent` | ngx-bootstrap `BsModalService`; roles modal emits `updateSelectedRoles` |
| Admin | `AdminPanelComponent` (tabs), `UserManagementComponent`, `PhotoManagementComponent` | |
| Errors | `TestErrorsComponent` (hits `BuggyController`), `NotFoundComponent`, `ServerErrorComponent` (reads `history.state.error`) | |
| Forms | `_forms/text-input`, `_forms/date-input` | `ControlValueAccessor` wrappers used by the reactive forms |
| Directives | `_directives/has-role.directive.ts` `*appHasRole` | structural directive gating on `currentUser$.roles` |

### `MemberDetailComponent` specifics
- `@ViewChild('memberTabs') memberTabs: TabsetComponent` (ngx-bootstrap tabs).
- `route.data` → `member`; `route.queryParams.tab` → `selectTab(tab)` (deep-link, e.g.
  `?tab=3` from the new-message toast).
- Photo gallery via `@kolkov/ngx-gallery` (`galleryOptions` + `galleryImages` from
  `member.photos`).
- `onTabActivated`: when the **Messages** tab becomes active and no messages loaded yet →
  `messageService.createHubConnection(user, member.username)`; otherwise
  `stopHubConnection()`. `ngOnDestroy` also stops it.

### `PhotoEditorComponent` specifics
- `ng2-file-upload` `FileUploader` → `POST users/add-photo`, `authToken: 'Bearer ' + token`,
  `allowedFileType: ['image']`, `maxFileSize: 10MB`, `autoUpload: false`.
- `onSuccessItem` → push the returned `Photo` into `member.photos`; if it's `isMain`, update
  `user.photoUrl` + `member.photoUrl` + `accountService.setCurrentUser`.
- `setMainPhoto` / `deletePhoto` call `MembersService` then patch local arrays.

## Third-party libraries (current)

| Package | Version | Used for |
|---|---|---|
| `@microsoft/signalr` | 6.0.5 | presence + message hubs |
| `bootstrap` | **4.6.1** | base CSS (⚠️ `bootswatch` is v5.1.3 — mismatch) |
| `bootswatch` | 5.1.3 | `united` theme |
| `ngx-bootstrap` | 8.0.0 | dropdown, tabs, modal, datepicker, pagination, buttons |
| `ngx-toastr` | 14.2.3 | toasts |
| `ngx-spinner` | 13.1.1 | global busy spinner (`line-scale-party`) |
| `ngx-timeago` | 2.0.0 | relative timestamps |
| `@kolkov/ngx-gallery` | 2.0.1 | member photo gallery |
| `ng2-file-upload` | 1.4.0 | photo upload |
| `@fortawesome/fontawesome-free` | 6.1.1 | icons |
| `font-awesome` | 4.7.0 | icons (⚠️ duplicate of the above) |
| `@angular/cdk` | 13.3.3 | (transitive UI needs) |

_Compatibility, replacements (`ng-gallery`, native upload), and the Bootstrap 4→5 sweep are in
`MIGRATION_PLAN.md` §7, §8, §11._

## Build config — `angular.json`

- `build.options.outputPath` = **`../API/wwwroot`**.
- `styles`: ngx-bootstrap datepicker css, `bootstrap.min.css` (v4), `bootswatch/.../united`,
  ngx-spinner `line-scale-party.css`, `src/styles.css`, `font-awesome.css`, `ngx-toastr`
  `toastr.css`.
- `production` config: budgets (initial 2mb warn / 5mb error), `fileReplacements`
  `environment.ts` → `environment.prod.ts`, `outputHashing: all`.
- `defaultConfiguration: production` for build; `development` for serve.
- `test` builder = Karma; **no real specs exist**, only the generated scaffolding.

## Tests
`npm test` = `ng test` (Karma + Jasmine). Only default scaffolding — no meaningful coverage.
