# Migrating a full‑stack app from .NET 5 + Angular 13 to .NET 10 + Angular 21 — in one night

> **What this file is:** raw source material for a Medium post. It has the narrative, the
> numbers, the code snippets, and the war stories, organised so sections can be lifted
> straight into a draft. Trim, re‑voice, and add screenshots as needed.

---

## TL;DR

| | Before | After |
|---|---|---|
| Backend runtime | .NET 5 (`net5.0`), `Startup.cs` + generic host | **.NET 10** (`net10.0`), minimal hosting |
| ORM / DB | EF Core 5, Npgsql 5, PostgreSQL | EF Core 10, **Npgsql 10.0.3**, PostgreSQL 16 |
| Frontend framework | Angular **13.4.0**, `@angular-devkit/build-angular:browser` | Angular **21.2.23**, `@angular/build:application` |
| Frontend patterns | NgModules, class guards, `*ngIf`/`*ngFor` | **standalone bootstrap**, functional guards, `@if`/`@for` |
| CSS framework | Bootstrap 4.6 (+ mismatched bootswatch 5) | **Bootstrap 5.3** |
| TypeScript | 4.6 | **5.9.3** |
| Node | 20.11 | **22.23.2** |
| Build shape | 12 pull requests, 2 review gates each | all merged, single session |

The app is a mid‑size reference SPA ("DatingApp" — a Neil Cummings‑style course app):
~2,750 lines of C# (9 controllers, 4 repositories, 2 services, SignalR hubs), ~2,500 lines
of Angular (24 components, 8 services, 3 guards, 3 HTTP interceptors, 1 resolver). Postgres,
Cloudinary image uploads, ASP.NET Core Identity with int keys, JWT bearer auth, two SignalR
hubs (presence + messaging). Deployed as one origin: the Angular build is copied into
`API/wwwroot/` and a fallback controller serves `index.html` for client routes.

Nothing about the app is exotic. That's the point — this is what a "normal" app that skipped
four years of framework releases looks like to migrate.

---

## 1. The method: why it didn't turn into a swamp

Skipping this section is how these migrations fail. The framework upgrades themselves were
mostly mechanical. The process is what kept 12 back‑to‑back major‑version jumps from
compounding into an unreviewable, unbisectable mess.

### Five rules, agreed before touching code

1. **Functionality first, standards later.** During the migration: no coding‑standards
   refactors, no renames, no reformatting, no dead‑code removal, no "while I'm here"
   cleanups. The only changes allowed are those required to move a version forward or to keep
   the app building and behaving identically. A separate standards pass happens *after*.
2. **Behaviour must not change.** Every stage is validated against a fixed smoke‑test
   checklist and a written "do not break" list of invariants (REST routes, DTO JSON shapes,
   pagination header protocol, JWT claim names, SignalR event names/payloads, the global
   `Photo.IsApproved` query filter, …). If a stage changes observable behaviour, that's a bug
   in the stage, not a new baseline.
3. **One major version = one branch = one PR = one review.** Nothing merges to `main`
   until two gates pass.
4. **Small, reviewable diffs.** Build artifacts are git‑ignored so diffs show only real
   changes. A huge hop gets split.
5. **`main` always builds and runs.** Never merge a red branch.

### Two review gates per stage

- **Gate A — automated review.** A reviewer agent reads the diff against the invariants
  checklist and the stage's plan section: is every change migration‑necessary? Any API
  contract drift? Are the framework‑specific gotchas for *this* version actually handled? Is
  the build green? It independently re‑runs the production build. Findings get posted to the
  PR and any blockers fixed on the same branch.
- **Gate B — human review.** Browser click‑through of the smoke‑test checklist, sign‑off on
  judgement calls Gate A flagged, approve the merge.

Neither gate alone is sufficient. Gate A is relentless about contract drift and catches
"this compiles but the schematic quietly changed a default"; Gate B catches "it compiles and
the contracts hold but the datepicker popup renders behind the modal."

### Order of operations

**Backend first, then the Angular ladder, then a joint regression.** The .NET upgrade is
self‑contained and low‑risk; doing it first gives the frontend a stable, unchanging API to
upgrade against. The two tracks don't share code.

### One more thing that paid off

A **decision log** — every non‑obvious call written down *with its reasoning* in the same
commit that acts on it. "Pin AutoMapper to 14.0.0 because 15+ needs a commercial license
key." "Regenerate the EF migration from scratch because local data is disposable and every
environment re‑seeds at startup." Six weeks later nobody remembers why, and the log is the
difference between "trust it" and "re‑litigate it."

---

## 2. Backend: .NET 5 → .NET 10 in a single jump

One PR. The runtime/BCL changes across five majors are cumulative, but this codebase uses
mainstream APIs only, so a direct 5→10 jump was fine. Target: **.NET 10** because it's LTS
(.NET 8 LTS ends in 2026, .NET 9 STS was already near EOL).

### Package matrix

| Package | 5.x | 10.x |
|---|---|---|
| TFM | `net5.0` | `net10.0` |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | 5.0.15 | 10.0.12 |
| `Microsoft.AspNetCore.Identity.EntityFrameworkCore` | 5.0.0‑preview.8 | 10.0.12 |
| `Npgsql.EntityFrameworkCore.PostgreSQL` | 5.0.0 | 10.0.3 |
| `CloudinaryDotNet` | 1.11.0 | 1.29.3 |
| `Swashbuckle.AspNetCore` | 5.6.3 | 10.2.3 |
| `System.IdentityModel.Tokens.Jwt` | 6.16.0 | 8.22.0 |
| `AutoMapper` | (transitive) | **14.0.0, pinned** |
| `AutoMapper.Extensions.Microsoft.DependencyInjection` | 11.0.0 | **removed** (folded into core since v13) |
| `Microsoft.EntityFrameworkCore.Sqlite` | 5.0.15 | **removed** (dead reference) |

### The gotchas that actually bite

**JWT signing key length — crashes on first login.** `Microsoft.IdentityModel` v7+ enforces
a minimum HMAC key size. The token service signs with `HmacSha512Signature`, which needs a
**≥ 64‑byte** key. The old app's key was 28 bytes → `IDX10653` on the first login attempt.
Fix: a 64+‑char signing key, and while you're there, `config["TokenKey"] ?? throw`.

**Npgsql timestamp mapping — throws on insert/update.** Npgsql 6.0 changed `DateTime`
handling: `Kind=Utc` maps to `timestamptz`, `Kind=Unspecified`/`Local` to `timestamp`, and
writing a non‑UTC value to a `timestamptz` column throws. This codebase writes
`DateTime.Now` (Local) for `Created`/`LastActive`, seeds bare dates (`Kind=Unspecified`), and
its 2022 migration created `timestamp without time zone` columns. The pragmatic fix — one
line, zero code churn, defer the "go UTC‑native" cleanup:

```csharp
// first line of Program.cs
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);
```

**`Startup.cs` → minimal `Program.cs`.** ~60 lines total. Removes the "which method runs
when" split‑lifecycle confusion and matches every current template. One catch worth a code
comment: keep `SuppressAsyncSuffixInActionNames = false` — a controller relied on
`CreatedAtRoute("GetUser")` resolving to an async action by its bare name.

**`IHeaderDictionary.Add` → `.Append` (analyzer ASP0019).** The pagination‑header helper and
the exception middleware both used `.Add`, which the .NET 10 analyzer now flags.

**Template leftovers.** Delete `WeatherForecastController.cs` and `WeatherForecast.cs`.

**A latent `launchSettings.json` bug surfaced.** `"launchBrowser": "true"` (string) instead
of `true` (bool) had been silently tolerated for years; the newer tooling rejected it and
broke `dotnet run` until it was fixed.

**AutoMapper 15+ needs a commercial license key** (since June 2025). Pin to `14.0.0`, the
last MIT release, which runs fine on .NET 10. It carries a known‑vulnerability advisory
(`NU1903` / `GHSA-rvv3-g6hj-g44x`) as a build warning; here the mappings are static and
compile‑time with no attacker‑controlled config, so the practical exposure is negligible —
reviewed and **accepted** as a build warning, with full AutoMapper removal deferred to the
standards pass (it's only ~6 maps and 2 `ProjectTo` calls).

**EF migration: regenerated from scratch.** Local Postgres data is disposable and every
environment re‑seeds at startup (`Seed.SeedUsers` is a no‑op if any user exists), so the
2022 EF‑5 migration was deleted and a single fresh `InitialCreate` was authored under EF 10
/ Npgsql 10 — a clean snapshot with no historical baggage. (This only applies when there's
no real deployed data. If there were, you'd keep the history and add migrations on change.)

### The part nobody enjoys: a secret hit a public repo

The first backend commit put a **real JWT signing key** into
`appsettings.Development.json` and pushed it to a public GitHub repo. ~40 minutes of
exposure before it was caught.

Recovery: rotate the key immediately, move it into .NET user‑secrets (`<UserSecretsId>` in
the csproj), remove it from the tracked file, `git commit --amend` locally to a clean
commit, and full‑branch scan to confirm nothing else leaked. The wrinkle: the amended
history was clean locally, but the *remote* branch still carried the leaked commit, and the
automation couldn't force‑push — a human had to run
`git push --force-with-lease` before the PR merged, or the key would have landed in `main`'s
history.

**Takeaways for the post:** dev secrets go in user‑secrets or env vars, never a tracked
file, from commit #1. A pre‑commit secret scanner would have caught it. And rotating is
non‑negotiable even for a "dev‑only, never deployed" key — you assume it's compromised the
moment it's pushed.

---

## 3. The frontend problem: Angular has no long LTS

Angular ships a major roughly every six months and supports each for ~18 months. There is no
"jump straight to latest" — `ng update` refuses multi‑major jumps by design. So the frontend
was a **ladder**: 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21, one rung per PR.

The framework `ng update` step for each rung is usually a few minutes. The work is in three
other places:

1. **Third‑party library compatibility.** Every rung has its own peer‑dependency matrix.
2. **Libraries that fell off the map** and had to be replaced.
3. **A handful of framework refactors** (functional guards, standalone bootstrap, the new
   build system, control‑flow syntax) done at the version that first requires them.

### The per‑hop loop

```
git switch main && git pull && git switch -c migrate/frontend-ng<N>
npm ci
npx ng update @angular/core@<N> @angular/cli@<N>
npx ng update @angular/cdk@<N>
# bump third-party libs to their <N>-compatible versions
npx ng build   --configuration production   # fix compile errors
npx ng build   --configuration development
npx ng serve                                 # smoke test
# commit in logical chunks -> push -> PR -> Gate A -> Gate B -> merge
```

Rules that mattered:

- Before the first rung, update to the **latest patch of the current major** on the new Node
  version and get a green build. That's your baseline.
- **Never skip the build/serve/commit between hops.** A broken hop is trivial to bisect; a
  broken chain is not.
- If a required library has no release for the next major, **stop there and ship**; resume
  when it does.

### The library scoreboard

| Library | 13‑era | 21‑era | Story |
|---|---|---|---|
| `ngx-bootstrap` | 8.0 | **21.2.2** | Tracks Angular. Requires Bootstrap 5 from v10. Re‑numbered its major to match Angular's around v18 (there is no v13–17). v21 dropped `.forRoot()` from every module. |
| `ngx-toastr` | 14.2 | **20.0.5** | Tracks Angular loosely. Its v20 line is what supports Angular 21 — and it has **no v22 release**, which is what ultimately capped the migration at 21. |
| `ngx-spinner` | 13.1 | **21.1.0** | Tracks Angular. Skipped a v20 line (went 19 → 21). |
| `@kolkov/ngx-gallery` | 2.0 | **removed** | Effectively abandoned for modern Angular. No v14+ build. |
| `ngx-timeago` | 2.0 | **removed** | View Engine only. Dies when `ngcc` is removed in Angular 16. |
| `ng2-file-upload` | 1.4 | **removed** | View Engine only; also churny. The upload is one multipart POST. |
| `@microsoft/signalr` | 6.0 | **6.0 (unchanged)** | Angular‑independent. `HubConnectionBuilder`, `withUrl({ accessTokenFactory })`, `withAutomaticReconnect()`, `.on(...)` — all stable across the range. Bumping it was never on the critical path. |
| `bootstrap` | 4.6 | **5.3.8** | See §5. |

---

## 4. The Angular ladder, rung by rung

### Stage 0 — setup (PR #1)

Docs, the invariants checklist, `docker-compose.yml` for local Postgres 16, a real
`.gitignore`, and — importantly — **untracking `API/bin` and `API/obj`** (86 committed
build‑artifact files that every `dotnet build` dirtied). Reviewable diffs are a hard
requirement of the whole workflow; you can't have them while binaries are in the tree.

### Stage 2 — Angular 13 baseline on Node 22 (PR #3)

`ng update @angular/core@13 @angular/cli@13` to the latest 13.x on Node 22. Needed a
`client/.npmrc` with `legacy-peer-deps=true` to get past `ERESOLVE` (a debt that gets
repaid in the standards pass). Also had to untrack a stale `API/wwwroot` that was committed
despite the stage‑0 `.gitignore`.

### Stage 3 — Angular 14 (PR #4)

**Typed reactive forms land.** `ng update` runs the `migration-v14-typed-forms` schematic,
which drops in `UntypedFormGroup` / `UntypedFormControl` where it can't infer types. One
component (the registration form, with a dynamic `FormGroup`) took the `Untyped*` opt‑out.
Peer bumps: `ngx-bootstrap` 8 → 9, `ngx-spinner` 13 → 14.

### Stage 4 — Angular 15 (PR #5)

Three things at once, because v15 forces them:

- **`@kolkov/ngx-gallery` blocks `ng update @15`** (peer `<14`, no newer release). Removed it
  in its own commit first. Its intended replacement, `ng-gallery`, also has **no
  Angular‑15‑compatible build** — every version ≥ 9 ships an Angular‑16.1+ typed‑input
  `.d.ts` format that fails to compile under Angular 15 (`TS2344`). So the member‑detail
  gallery was **hand‑rolled**: a main `<img>` plus a clickable thumbnail strip, matching the
  old `preview: false` behaviour, with zero gallery dependency.
- **Functional guards & resolver.** Class `CanActivate` / `CanDeactivate` / `Resolve` are
  deprecated since v15.2. All three guards + the resolver converted to
  `CanActivateFn` / `CanDeactivateFn` / `ResolveFn` with `inject()`. (The auth guard's class
  version returned `undefined` on failure — a latent bug — so the functional version returns
  `router.parseUrl('/')` instead.)
- Schematic housekeeping: delete `.browserslistrc`, tsconfig `target` → ES2022 +
  `useDefineForClassFields: false`, `src/test.ts` `require.context` removed, TS → 4.9.5.

`ngx-bootstrap` was **left at v9 / Bootstrap 4** for this stage — v9 still compiles on
Angular 15 via `legacy-peer-deps`, which let the Bootstrap 4→5 change be split into its own
PR (next). Splitting the CSS‑breaking change out kept Stage 4 reviewable.

### Stage 4b — Bootstrap 4 → 5 (PR #6)

The `package.json` was already inconsistent — `bootstrap@4.6.1` *and* `bootswatch@5.1.3`,
with `angular.json` loading both v4 and v5 CSS. Bump `bootstrap` and `bootswatch` to 5.3,
`ngx-bootstrap` to 10.3 (v10 requires Bootstrap 5), then sweep 14 templates for the class
renames:

| Bootstrap 4 | Bootstrap 5 |
|---|---|
| `ml-*` / `mr-*` | `ms-*` / `me-*` |
| `pl-*` / `pr-*` | `ps-*` / `pe-*` |
| `float-left` / `float-right` | `float-start` / `float-end` |
| `form-group` | (removed — spacing utils, e.g. `mb-3`) |
| `form-inline` | (removed — `d-flex` / grid) |
| `.input-group-append` / `-prepend` | put the child directly in `.input-group` |
| `.close` | `.btn-close` (drop the `&times;`) |
| `badge-primary` … | `text-bg-primary` … |
| `.custom-select` | `.form-select` |
| `.sr-only` | `.visually-hidden` |
| `data-toggle` / `data-target` | `data-bs-toggle` / `data-bs-target` |
| `.btn-block` | `.d-grid` on the parent (or `w-100`) |
| `.jumbotron`, `.media`, `.card-deck` | (removed — compose with utilities) |

Bulk `sed` for the mechanical prefix renames; hand‑edits for the structural ones
(`.input-group-append` unwrap, `.close` → `.btn-close`). This is the one stage where Gate B
(actual eyeballs on every screen) matters most — a class rename that compiles fine can still
shift a layout.

### Stage 5 — Angular 16 (PR #7): the first "library apocalypse"

**Angular 16 removes `ngcc`** (the View Engine → Ivy compatibility compiler). Two
dependencies were View‑Engine‑only and hard‑break:

**`ngx-timeago` → a hand‑rolled standalone pipe.** The plan was a thin `date-fns`
`formatDistanceToNow` pipe. But `date-fns@4`'s `.d.cts` type declarations use `.ts` import
extensions and `export type *`, which **TypeScript 4.9.5 can't parse** — the build blew up
inside `node_modules`. Rather than pin an old `date-fns`, the replacement is a ~25‑line
self‑contained relative‑time formatter with **zero new dependency**. Trade‑off: the label no
longer live‑ticks; it recomputes on change detection. Acceptable.

**`ng2-file-upload` → native `HttpClient` + `FormData`.** The upload is a single multipart
`POST /api/users/add-photo` with field name `file`. That's:

```ts
uploadPhoto(file: File) {
  const form = new FormData();
  form.append('file', file);
  return this.http.post<Photo>(this.baseUrl + 'users/add-photo', form, {
    reportProgress: true, observe: 'events',
  });
}
```

…plus a `<input type="file">`, a progress bar bound to `HttpEventType.UploadProgress`, and a
tiny inline drag‑drop handler. **The manual upload‑queue UI (queue table, "Upload all" /
"Cancel all" / "Remove all") is gone** — files upload immediately on select or drop. That's a
deliberate, sanctioned UX simplification; the API contract (POST target, `file` field name,
the "first photo becomes main" side effect) is untouched. A nice side effect: the upload now
goes through the app's HTTP interceptor chain, so the global loading spinner and error
toasts apply to it for free.

Peer bumps: `ngx-bootstrap` → 11, `ngx-toastr` → 17, `ngx-spinner` → 16, RxJS → 7.8.

### Stage 6 — Angular 17 (PR #8): the big one

Three large migrations in one PR (kept as separate commits so Gate A could review them
incrementally):

**a) The new build system.** `@angular-devkit/build-angular:browser` →
`@angular-devkit/build-angular:application` (esbuild/Vite). The **critical** gotcha for this
app: the `application` builder writes the browser bundle to `<outputPath>/browser/` by
default. This app builds into `../API/wwwroot` and a fallback controller serves
`wwwroot/index.html` for deep links. If `index.html` lands in `wwwroot/browser/index.html`,
SPA serving and every client‑side deep link break in production. The fix:

```jsonc
"outputPath": { "base": "../API/wwwroot", "browser": "" }
```

Plus `options.main` → `options.browser`, `polyfills` → array form, and drop
`buildOptimizer` / `vendorChunk` from the dev config (unsupported by the new builder).

**A trap worth its own paragraph:** the CLI's `use-application-builder` schematic
**self‑upgraded to a temporary Angular 22 CLI** ("The installed Angular CLI version is
outdated. Installing a temporary Angular CLI versioned 22.x…") and applied v22‑flavoured
changes to a v17 project — it added `@angular/build@^22` as a dependency, removed
`@angular-devkit/build-angular`, and rewrote `tsconfig.json` and `karma.conf.js`. All of it
reverted; the builder switch was done **by hand** for v17. Lesson: `ng update` /
`ng generate` schematics that fetch a "temporary" CLI will fetch the *latest*, not your
target major. Watch the output, and revert anything that smells like a version you're not on
yet.

**b) Standalone bootstrap.** `ng generate @angular/core:standalone` in three modes:
convert‑to‑standalone (every component/directive/pipe gets `standalone: true` + an explicit
`imports: [...]`), prune‑ng‑modules (nothing to prune here), standalone‑bootstrap (deletes
`app.module.ts`, rewrites `main.ts`). Then finished by hand to the target shape:

- new `app.config.ts` — `provideRouter(routes)`, `provideHttpClient(withInterceptorsFromDi())`
  keeping the three class HTTP interceptors via `HTTP_INTERCEPTORS` multi‑providers
  (**order matters** and was preserved: Error → Jwt → Loading), `provideAnimations()`, and
  `importProvidersFrom(...)` of the seven `.forRoot()` calls the old shared module made
  (Toastr keeps `positionClass: 'toast-bottom-right'`).
- `app-routing.module.ts` → `app.routes.ts` (a plain `routes` const).
- deleted `_modules/shared.module.ts` — every component now imports what it needs directly.

**c) Control‑flow migration.** `ng generate @angular/core:control-flow` rewrites `*ngIf` /
`*ngFor` / `*ngSwitch` → `@if` / `@for` (with `track`) / `@switch` across all 17 templates,
and prunes `NgIf` / `NgFor` from the components' `imports` arrays. The schematic reflows
template indentation, so the diff looks enormous; the actual logic is untouched. The one
thing to eyeball is anything that gates behaviour off a template — here, the member‑detail
tab headings, because the string `'Messages'` on a tab drives the SignalR hub
connect/disconnect.

This PR was a ~5,000‑line diff. It's the strongest argument for the "one major per PR" rule:
imagine bisecting a regression across this *plus* three other framework jumps.

### Stage 7 — Angular 18 (PR #9)

`polyfills.ts` and `test.ts` are gone from the modern project layout — moved into
`angular.json` / the karma builder. Angular 18's `ng update` shipped no automatic schematic
for it, so it was done by hand: `polyfills: ["zone.js"]`, `test` target
`polyfills: ["zone.js", "zone.js/testing"]`, delete both files, trim the tsconfig `files`
arrays.

**Side effect:** deleting `test.ts` made the karma builder actually *reach* the default
`ng new` scaffold spec in `app.component.spec.ts` — which had never been updated for this app
(it asserts `title === 'client'` and renders text that doesn't exist, and doesn't provide
`HttpClient` for the standalone component). So `ng test` went red. **Not a regression** —
pre‑existing scaffold rot, exposed. The project has no real specs; the test runner was never
a migration gate. Replacing the scaffold is a post‑migration task.

One `ng update` migration touched code — "Replace deprecated HTTP related modules with
provider functions" — but for this app it only collapsed a multi‑line import onto one line
in the three interceptors. No logic change.

Peer bumps: `ngx-bootstrap` 12 → **18.1.3** (this is where the library re‑numbered to match
Angular), `ngx-toastr` → 19.1.0, `ngx-spinner` → 18.

### Stage 8 — Angular 19 (PR #10)

**Standalone is the default.** The v19 schematic strips the now‑redundant `standalone: true`
line from every `@Component` decorator — 21 files, one line each, no `imports` changes.
(Three declarables — a directive, a pipe, and a dynamically‑shown modal component — kept
their explicit `standalone: true`; the schematic only rewrites `@Component` and skipped the
nested one. Harmless; it equals the v19 default.)

`@types/node` finally got bumped `^12` → `^22` — it had been flagged `invalid` against `vite`
and `@inquirer/*` (which want `>=18`) since Stage 7, and Node 22 is the runtime anyway.

The `inject()` migration was offered and **skipped** — it's cosmetic, and the working
agreement says no cosmetic refactors during the migration.

### Stage 9 — Angular 20 (PR #11): the smallest hop

**No component or template changes.** Three config files:

- `tsconfig.json`: `moduleResolution` `"node"` → `"bundler"` (Angular 20's recommended
  default; works with the application builder).
- `angular.json`: a `schematics` block with `ng generate` naming defaults — codegen
  preference only, doesn't touch build/serve/test.
- peer bumps: `ngx-bootstrap` → 20.0.2, `ngx-spinner` → 21.1.0 (no v20 line existed),
  `ngx-toastr` **held at 19.1.0** — its v20 line requires Angular 21.

Nice detail: the production build went from **12 CSS‑inliner "rules skipped" warnings to
zero** — Angular 20's critical‑CSS inliner learned to parse the Bootstrap 5 combinator
selectors (`.btn-group>+.btn`, `.form-floating>~label`) and keyframe stops that every
previous version had choked on.

**This is also where the "how far do we go?" decision came due.** Angular 22 was already GA,
but `ngx-toastr` had no v22 release (its latest line peers `@angular/core ^21`).
`ngx-bootstrap` and `ngx-spinner` both had v22 builds; `ngx-toastr` alone blocked it.
Decision: **stop at Angular 21.** v22 becomes a post‑migration item, revisited if/when
`ngx-toastr` ships for it.

### Stage 10 — Angular 21 (PR #12): the last framework hop

`ng update` bumped everything to 21.2.23 and TypeScript to **5.9.3**. Two schematic file
edits:

- `tsconfig.json` drops the explicit `"lib": ["es2020", "dom"]` — TS now infers it from
  `target: "ES2022"` (a strict superset of what was there).
- `main.ts` now passes `provideZoneChangeDetection()` explicitly — **Angular 21 no longer
  implies zone‑based change detection in `bootstrapApplication`.** For an app that still
  ships `zone.js` and hasn't gone zoneless, you must add it back or the app won't update the
  view.

Then **`ngx-bootstrap@21` broke the build twice:**

1. **Every module dropped `.forRoot()`.** In v21 the modules are standalone and their config
   services are `providedIn: 'root'`, so `ModalModule.forRoot()` and friends no longer
   exist. Fix: list them bare in `importProvidersFrom(...)` and keep only
   `ToastrModule.forRoot({...})` (that's from `ngx-toastr`, which still has it). Those six
   `importProvidersFrom` entries are now effectively no‑ops — a post‑migration cleanup.
2. **`TabDirective.heading` became a signal input** (`InputSignal<string | undefined>`). One
   line of component code read it directly to gate the SignalR hub:

   ```ts
   // before
   if (this.activeTab.heading === 'Messages' && this.messages.length === 0) { … }
   // after
   if (this.activeTab.heading() === 'Messages' && this.messages.length === 0) { … }
   ```

   This is exactly the kind of thing the invariants checklist exists for — the tab heading
   string drives whether the message hub connects. Behaviour identical, calling convention
   changed. `TabDirective.active` is still a plain getter/setter, so the sibling
   `selectTab()` code was untouched.

`ngx-toastr` finally moved 19.1.0 → 20.0.5 here (its v20 line is what supports Angular 21),
which also pulled `rxjs` to `~7.8.2`.

### Stage 11 — full regression

End‑to‑end pass on both apps in production mode: build the Angular client into
`API/wwwroot/`, `dotnet publish`, run the whole smoke‑test checklist against the one‑origin
build — register, login, member list with filters and pagination, likes, the photo gallery
and tabs, real‑time messaging over SignalR between two browsers, the "new message" toast
deep‑linking to `/members/x?tab=3`, presence online/offline, the dirty‑form guard, photo
upload (the native path) → admin approval, and the errors page. Plus a confirm that the
`application` builder's output still lands at `wwwroot/index.html`, not `wwwroot/browser/`.

---

## 5. A bug we found that had nothing to do with the migration

While poking at messaging, a specific failure turned up: **a freshly registered user
couldn't send a message to a seeded user.** Reading the code (no fix yet), the cause:

```csharp
// AccountController.Register
var user = _mapper.Map<AppUser>(registerDto);   // UserName = "Lisa" (as typed)
var result = await _userManager.CreateAsync(user, registerDto.Password);  // row persisted as "Lisa"
...
user.UserName = registerDto.Username.ToLower();  // in-memory only, AFTER save, never persisted
...
Token = await _tokenService.CreateToken(user),  // token built from the lowercased in-memory value
```

The `.ToLower()` runs *after* `CreateAsync` has already written the row, and nothing saves
again. So a user who registers as `Lisa` is stored in the DB as `Lisa`, but their JWT
`unique_name` claim (and the returned DTO) say `lisa`. Every custom query in the app filters
on `UserName` directly with a case‑sensitive Postgres comparison, so
`MessageHub.SendMessage` looks up the sender by `"lisa"`, gets `null`, and throws a
`NullReferenceException`. Seeded users are fine because the seeder lowercases *before*
`CreateAsync`.

Pre‑existing, since well before the migration. It was bundled into Stage 5 as a one‑line fix
(move the `.ToLower()` ahead of `CreateAsync`, mirroring the seeder) — flagged in the PR as
a deliberate, human‑approved exception to "no non‑migration changes in a stage."

**Blog angle:** migrations make you read code you'd otherwise never open. Budget for finding
things. Decide up front whether you fix them inline (with a flag) or file them.

---

## 6. Cross‑cutting lessons

**`ng update` fetches a "temporary latest CLI" for some schematics.** On the Angular 17 hop
this meant a v22 CLI ran v22 migrations against a v17 project. Read the schematic output;
revert anything targeting a version you're not on.

**On Windows, a stray `ng serve` will block your next `npm ci`.** The esbuild/Vite dev
server spawns child `esbuild.exe` / `rollup*.node` processes that outlive the parent, and
they hold file handles inside `node_modules`. `npm ci` (which wipes `node_modules` first)
then dies with `EPERM: operation not permitted, unlink …`. This bit three hops in a row.
Kill stray `esbuild.exe` before `npm ci` — and be careful not to kill your IDE's own
`node.exe` processes.

**Library majors that "track Angular" don't track it cleanly.** `ngx-bootstrap` went 8 → 9 →
10.3 → 11 → 12 → 18.1 → 19 → 20 → 21.2 (it re‑based its major onto Angular's around v18, so
there's no v13–17). `ngx-spinner` skipped a v20 line. Don't assume "library vN pairs with
Angular vN" until you're past v17 — and verify each hop with `npm view <pkg> peerDependencies`.

**One lagging library caps the whole migration.** All the risk of stopping at v20‑vs‑v21‑vs‑v22
came down to a single package (`ngx-toastr`) not having a v22 build. Identify your "long
pole" libraries early.

**Deleting a scaffold file can turn a green test suite red** — not because you broke
anything, but because you removed the thing that was hiding a spec that never worked. Know
which of your test failures are real.

**The critical‑CSS inliner's warnings are noisy and version‑dependent.** They went 6 → 12 →
0 across three Angular versions with no change to the actual CSS. Don't chase them; the full
stylesheet still ships.

**"The schematic wrote it" beats "I can write it cleaner."** The Angular 21 `main.ts` ended
up with an awkward `{...appConfig, providers: [provideZoneChangeDetection(), ...appConfig.providers]}`
spread. Leaving it exactly as the migration produced it is the right call mid‑migration —
tidy it in the standards pass, where the diff is attributable to "cleanup" and not "did the
upgrade also change my bootstrap?"

---

## 7. What was deliberately deferred

A migration is not a cleanup. Everything below was noted and left for a **post‑migration
standards pass**, so each framework diff stayed attributable:

- Remove AutoMapper entirely (replace `ProjectTo` with explicit `.Select(...)`) — kills the
  `NU1903` advisory and the license risk.
- Go UTC‑native on Postgres; drop `Npgsql.EnableLegacyTimestampBehavior`.
- Enable nullable reference types on the API.
- Swashbuckle → `Microsoft.AspNetCore.OpenApi` + Scalar.
- Karma/Jasmine → Vitest (or delete the scaffold specs).
- Convert the three class HTTP interceptors to functional `HttpInterceptorFn`.
- Drop the now‑no‑op `importProvidersFrom(...)` entries for the bare ngx‑bootstrap modules.
- `tsconfig` `module: "es2020"` → `"preserve"` to pair idiomatically with
  `moduleResolution: "bundler"`.
- Remove `client/.npmrc` `legacy-peer-deps`; run `npm audit`.
- De‑duplicate Font Awesome (a v4 and a v6 both loaded).
- Bump `@microsoft/signalr` 6 → 8.
- Move the `main.ts` `provideZoneChangeDetection()` into `app.config.ts`.
- Reconsider hosting (Heroku's free tier is gone).

---

## 8. By the numbers

- **1 backend PR**, `.NET 5 → .NET 10`, single jump.
- **11 frontend PRs** (Angular 13 baseline → 14 → 15 → Bootstrap 5 → 16 → 17 → 18 → 19 → 20
  → 21, plus a setup PR).
- **12 PRs total**, every one merged, in a single session.
- **3 libraries replaced** (`@kolkov/ngx-gallery`, `ngx-timeago`, `ng2-file-upload`),
  **2 removed** (`AutoMapper.Extensions.Microsoft.DependencyInjection`,
  `Microsoft.EntityFrameworkCore.Sqlite`), **1 pinned** (`AutoMapper` 14.0.0).
- **1 pre‑existing bug found and fixed** (username casing).
- **1 secret incident**, caught and remediated.
- **TypeScript** 4.6 → 5.9.3. **Node** 20.11 → 22.23.2. **zone.js** 0.11 → 0.15.
- **The biggest single diff** (~5,000 lines) was Angular 17 — builder + standalone +
  control‑flow — and it was almost entirely schematic‑generated.

---

## 9. Would this scale to a bigger app?

The method would; the effort wouldn't stay linear.

- **Backend:** roughly the same. The .NET gotchas (JWT key size, Npgsql timestamps, minimal
  hosting, analyzer changes) are fixed‑cost, not proportional to app size.
- **Frontend:** the ladder is the same shape, but the schematic‑touched surface (standalone,
  control‑flow) scales with component count, and every hand‑rolled library replacement is
  bespoke. A 200‑component app with 15 third‑party Angular libraries is a different project.
- **The two things that don't scale and must be budgeted:** the library replacements (each is
  a mini‑project), and Gate B (someone clicks through every screen after every hop that
  touches templates or CSS).

The single highest‑leverage decision was **one major version per PR with a hard "behaviour
must not change" rule.** Everything else — the smoke tests, the invariants list, the
gitignored artifacts, the decision log — exists to make that rule enforceable.
