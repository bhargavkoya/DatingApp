# CLAUDE.local.md — Migration Working Log

Loaded into every Claude Code session automatically. This is the **single source of truth for
process and decisions** during the .NET 5 → 10 / Angular 13 → 21 migration. Update it as part
of the same commit whenever a decision is made or a stage changes state.

> Kept **committed** (not git-ignored) so it travels on every branch and the reviewing agent
> sees it. If you'd rather it be private, tell me and I'll add it to `.gitignore` and move the
> decision log to `docs/decisions/`.

Related docs:
- `MIGRATION_PLAN.md` — the full step-by-step plan (backend + Angular ladder).
- `docs/` — codebase reference (architecture, data model, feature workflows, invariants).
- `CLAUDE.md` — always-on repo guidance for Claude Code.

---

## 1. Working agreement

1. **Functionality first, standards later.** During the migration we do **not** do
   coding-standards refactors, renames, reformatting, dead-code removal, or "while I'm here"
   cleanups. The only changes allowed are those required to move a version forward or to keep
   the app building and behaving identically. A separate standards pass happens **after** the
   app is fully migrated and verified.
2. **Behaviour must not change.** Every stage is validated against the smoke-test checklist in
   `MIGRATION_PLAN.md` §13 and the invariants in `docs/08-invariants-and-contracts.md`. If a
   stage changes observable behaviour, that is a bug in the stage, not a new baseline.
3. **One stage = one branch = one PR = one review.** No stage is merged to `main` until both
   review gates pass (§3).
4. **Small, reviewable diffs.** Build artifacts are git-ignored (see D-P3) so diffs show only
   real changes. If a hop produces a huge diff, split it.
5. **`main` always builds and runs.** Never merge a red branch.
6. **Write down decisions here immediately**, with the reasoning, in the same commit that
   acts on them.

---

## 2. Branch & PR workflow

Remote: `origin` → `https://github.com/bhargavkoya/DatingApp`. `gh` CLI is **not installed**
on this machine, so PRs are opened on github.com by the user (or install `gh` with
`winget install --id GitHub.cli` and Claude can open/manage them).

### Branch naming
| Kind | Pattern | Example |
|---|---|---|
| Setup / chore | `chore/<topic>` | `chore/migration-setup` |
| Backend framework | `migrate/backend-net10` | |
| Angular hop | `migrate/frontend-ng<major>` | `migrate/frontend-ng14` |
| Library swap inside a hop | folded into that hop's branch | |
| Fix found in review | commit onto the same branch | |

### Flow per stage
1. `git switch main && git pull`
2. `git switch -c <branch>` (Angular hops branch off the **previous merged hop**, i.e. off
   `main` after the prior hop merged).
3. Do the work per `MIGRATION_PLAN.md`. Commit in logical chunks.
4. Build + run + smoke-test locally (checklist in the plan). Record the result in §4.
5. Push: `git push -u origin <branch>`. User opens the PR on github.com (title = stage name,
   body = what changed + smoke-test result + risks).
6. **Gate A — agent review:** Claude spawns a `general-purpose` subagent to review the diff
   against `docs/08-invariants-and-contracts.md` and the stage's plan section. Findings are
   posted back here (§4 row) and on the PR. Claude fixes blockers on the same branch.
7. **Gate B — user review:** user reviews the PR (GitHub UI or local checkout) and approves.
8. **Merge:** `--no-ff` merge to `main` (preserves the stage boundary), then tag:
   `git tag stage-<n>-<name>` and push tags.
9. Update §4 status board → `MERGED`. Delete the branch.

### Rules
- Neither gate alone is sufficient — **both** A and B must pass.
- A "fix found in review" never gets its own PR; it's a commit on the branch under review.
- If a stage is abandoned, mark it `DROPPED` in §4 with the reason; don't delete the row.

---

## 3. Review gates — what each reviewer checks

**Gate A (agent):**
- Diff contains only migration-necessary changes (no stray refactors — WA rule 1).
- No API contract drift: routes, DTO shapes, JSON casing, pagination header, JWT claims,
  SignalR event names/payloads — all unchanged (`docs/08`).
- No behaviour change in the feature workflows the diff touches (`docs/07`).
- Framework-specific gotchas for this stage (from `MIGRATION_PLAN.md`) are actually handled.
- Build is green; no new analyzer errors treated as warnings-suppressed.

**Gate B (user):**
- Smoke-test checklist passed locally (or the user re-runs it).
- Happy with the approach and any judgement calls flagged by Gate A.
- Approves the merge.

---

## 4. Stage status board

Legend: ☐ not started · ▶ in progress · 🅰 in agent review · 🅱 in user review · ✅ merged · ✖ dropped

| # | Stage | Branch | Plan ref | Status | Gate A | Gate B | Tag | Notes |
|---|---|---|---|---|---|---|---|---|
| 0 | Migration setup (this): docs, process, `.gitignore`, compose | `chore/migration-setup` | — | ▶ | ☐ | ☐ | — | Also untracks `API/bin`+`API/obj` (D-P3). |
| 1 | Backend .NET 5 → .NET 10 | `migrate/backend-net10` | Plan §3–§4 | ☐ | ☐ | ☐ | — | Gotchas G1–G12. Regenerate EF migration (D-B5). Blocks nothing on FE. |
| 2 | Angular baseline on Node 22 + latest 13.x | `migrate/frontend-ng13-baseline` | Plan §5 | ☐ | ☐ | ☐ | — | Green `ng build`/`ng serve` before any hop. |
| 3 | Angular 14 | `migrate/frontend-ng14` | Plan §9 | ☐ | ☐ | ☐ | — | Typed-forms schematic. |
| 4 | Angular 15 (+ Bootstrap 4→5, functional guards, `ng-gallery`) | `migrate/frontend-ng15` | Plan §6.1, §7, §9, §11 | ☐ | ☐ | ☐ | — | Biggest FE content change. |
| 5 | Angular 16 | `migrate/frontend-ng16` | Plan §9 | ☐ | ☐ | ☐ | — | rxjs 7.8; native file upload swap. |
| 6 | Angular 17 (+ standalone, control-flow, new builder) | `migrate/frontend-ng17` | Plan §6.2, §6.3, §9, §10.4 | ☐ | ☐ | ☐ | — | Fix `outputPath` or Fallback breaks. |
| 7 | Angular 18 | `migrate/frontend-ng18` | Plan §9 | ☐ | ☐ | ☐ | — | polyfills/test files removed. |
| 8 | Angular 19 | `migrate/frontend-ng19` | Plan §9 | ☐ | ☐ | ☐ | — | standalone-by-default. |
| 9 | Angular 20 | `migrate/frontend-ng20` | Plan §9 | ☐ | ☐ | ☐ | — | Node ≥ 20.19. |
| 10 | Angular 21 (if libs ready, else stop at 20) | `migrate/frontend-ng21` | Plan §0, §9 | ☐ | ☐ | ☐ | — | Only if §11 libs have v21 releases. |
| 11 | Full regression + prod-mode build test | `chore/migration-verify` | Plan §13 | ☐ | ☐ | ☐ | — | End-to-end pass on both apps. |

_Post-migration (separate effort, not gated here): coding standards, nullable, AutoMapper
removal, Karma→Vitest, hosting — see `MIGRATION_PLAN.md` §14._

---

## 5. Decision log

Format: `D-<area><n> — <date> — <decision>` then **Why** / **Status** / **Revisit if**.
Area codes: `P` process, `B` backend, `F` frontend.

### D-P1 — 2026-09-10 — Frontend stays Angular (upgrade 13 → 21), not a React rewrite
- **Why:** the app is already Angular; `ng update` gives a supported incremental path; a
  rewrite is strictly more risk for no functional gain. (Supersedes the earlier React draft
  of `MIGRATION_PLAN.md`.)
- **Status:** ACCEPTED.
- **Revisit if:** a hop is blocked for weeks by an unmaintained dependency with no Angular
  equivalent (none identified — see `MIGRATION_PLAN.md` §11).

### D-P2 — 2026-09-10 — PR-per-stage with two review gates (agent + user)
- **Why:** user requirement; keeps `main` releasable; makes each framework jump independently
  revertible.
- **Status:** ACCEPTED. Mechanics in §2–§3.

### D-P3 — 2026-09-10 — Stop tracking `API/bin` and `API/obj`; add a real `.gitignore`
- **Why:** 86 build-artifact files are committed today; every `dotnet build` dirties them and
  the TFM change (`net5.0` → `net10.0`) would add a second full copy. Reviewable diffs are a
  hard requirement of the PR workflow. Regenerated on build → cannot affect the running app.
- **Action:** `git rm -r --cached API/bin API/obj` on `chore/migration-setup` (files stay on
  disk). New `.gitignore` also covers `node_modules/`, `client/dist/`, `API/wwwroot/`, `.vs/`.
- **Status:** PROPOSED — on the setup branch, awaiting Gate B. User can veto at review.
- **Revisit if:** the deploy pipeline actually depends on committed `wwwroot`/`bin` (not seen
  in repo; Heroku build runs `ng build` + `dotnet publish`).

### D-P4 — 2026-09-10 — `docs/` is descriptive, not prescriptive; update it when behaviour is intentionally changed
- **Why:** `docs/` exists to protect current behaviour during the migration. It should be
  corrected only when a stage deliberately and reviewably changes a workflow (rare), never to
  paper over an accidental change.
- **Status:** ACCEPTED.

### D-P5 — 2026-09-10 — Order: backend first, then the Angular ladder, then a joint regression
- **Why:** backend .NET 10 is self-contained and low-risk; doing it first gives the frontend a
  stable, unchanging API to upgrade against. The two tracks don't share code.
- **Status:** ACCEPTED. See §4.

### D-B1 — 2026-09-10 — Target .NET 10 (LTS), single jump from 5
- **Why:** .NET 8 LTS ends Nov 2026; .NET 9 STS is already near EOL. Runtime/BCL changes 5→10
  are cumulative but this codebase uses mainstream APIs only.
- **Status:** ACCEPTED. SDK `10.0.300` already installed.

### D-B2 — 2026-09-10 — Merge `Startup.cs` into a single minimal-hosting `Program.cs`
- **Why:** ~60 lines total; removes the split-lifecycle confusion; matches every current
  template and doc. Converted file is in `MIGRATION_PLAN.md` §G3.
- **Status:** ACCEPTED.
- **Note:** keep `SuppressAsyncSuffixInActionNames = false` (UsersController relies on it).

### D-B3 — 2026-09-10 — Pin `AutoMapper` to 14.0.0 (last MIT release)
- **Why:** AutoMapper 15+ (Jun 2025) requires a commercial license key. 14.0.0 runs on
  .NET 10. Removing AutoMapper entirely is deferred to the post-migration standards pass.
- **Status:** ACCEPTED. Also drop `AutoMapper.Extensions.Microsoft.DependencyInjection`
  (folded into core since v13).
- **Revisit if:** the standards pass removes AutoMapper (only ~6 maps + 2 `ProjectTo` calls).

### D-B4 — 2026-09-10 — Use `Npgsql.EnableLegacyTimestampBehavior = true` for now
- **Why:** Npgsql 6+ changed `DateTime` → `timestamptz` mapping; the code writes
  `DateTime.Now` (Local) and the 2022 migration created `timestamp without time zone`
  columns. The legacy switch keeps existing data, migration, and code working with zero churn.
- **Status:** ACCEPTED for stage 1. Going UTC-native is a post-migration item
  (`MIGRATION_PLAN.md` §14).

### D-B5 — 2026-09-10 — Regenerate the EF migration from scratch during stage 1
- **Why:** user confirmed local Postgres data is disposable and every environment is
  re-seeded at startup (`Seed.SeedUsers`), so there is no data to preserve. A single fresh
  migration authored under EF 10 / Npgsql 10 gives a clean snapshot with no historical
  baggage from the 2022 EF-5 migration.
- **Action (stage 1):** `docker compose down -v` (drop the volume) → delete
  `API/Data/Migrations/*` → `dotnet ef migrations add InitialCreate` → run the app (auto
  `MigrateAsync` + seed). Verify column types with the Npgsql legacy switch on (D-B4).
- **Status:** ACCEPTED (regenerate). Supersedes the earlier "keep" lean.
- **Note:** this only applies to local/dev. If a real deployed DB with real user data ever
  exists, revert to add-migration-on-change.

### D-B6 — 2026-09-10 — Swagger: upgrade Swashbuckle to 9.x (don't switch to Scalar during migration)
- **Why:** the UI is currently commented out; a swap is scope creep. Upgrading the package
  keeps parity. Scalar/`Microsoft.AspNetCore.OpenApi` is a post-migration option.
- **Status:** ACCEPTED.

### D-F1 — 2026-09-10 — One Angular major per branch/PR; target v21, fall back to v20
- **Why:** `ng update` refuses multi-major jumps; each hop has its own schematics + peer-dep
  matrix. v21 is latest; stop at v20 if a §11 library lacks a v21 release.
- **Status:** ACCEPTED. Ladder in §4.

### D-F2 — 2026-09-10 — Do framework refactors at the version that first requires them
- **Why:** minimise churn per hop and keep each diff attributable.
- **Decisions:** functional guards/resolver at v15–16 (class interfaces deprecated);
  standalone bootstrap + control-flow schematic at v17; new `@angular/build` builder at v17
  with `outputPath: { base: "../API/wwwroot", browser: "" }`.
- **Status:** ACCEPTED. Details in `MIGRATION_PLAN.md` §6, §10.4.

### D-F3 — 2026-09-10 — Bootstrap 4 → 5 during the Angular 15 hop
- **Why:** `ngx-bootstrap` v10 (the v15-compatible line) requires Bootstrap 5. `package.json`
  already mixes `bootstrap@4.6.1` with `bootswatch@5.1.3`, so this also fixes an existing
  inconsistency. Class-rename table + grep in `MIGRATION_PLAN.md` §7.
- **Status:** ACCEPTED.

### D-F4 — 2026-09-10 — Replace `@kolkov/ngx-gallery` → `ng-gallery`, and `ng2-file-upload` → native `HttpClient` + `FormData`
- **Why:** `@kolkov/ngx-gallery` is effectively abandoned for modern Angular; `ng2-file-upload`
  is churny and the upload is a single multipart POST we can do with `HttpClient`.
- **Status:** ACCEPTED. `ng-gallery` swap at v15; upload swap at v15–16. `ngx-timeago` →
  `date-fns` pipe **only if** it blocks a hop (decide then).

### D-F5 — 2026-09-10 — Keep Karma/Jasmine through the ladder; decide on Vitest/Jest after
- **Why:** there are no real specs (only scaffolding), so the test runner never blocks a hop.
  Switching runners mid-migration is pure scope creep.
- **Status:** ACCEPTED.

### D-F6 — 2026-09-10 — Angular dev server keeps calling `https://localhost:5001` directly (no proxy)
- **Why:** the API already whitelists `http://localhost:4200` for CORS; a proxy is optional
  convenience, not needed. `environment.ts` stays as-is.
- **Status:** ACCEPTED.

---

## 6. Open questions / parking lot

- ~~**Q1:** Install `gh` CLI…~~ **RESOLVED 2026-09-10:** user wants PRs opened automatically →
  `gh` CLI to be installed + authenticated; Claude opens each stage PR with `gh pr create`.
- ~~**Q2:** Is the local Postgres data disposable?~~ **RESOLVED 2026-09-10:** yes, disposable,
  re-seeded at startup → D-B5 = regenerate migrations.
- **Q3:** Final Angular target — commit to v21, or lock to v20 if v21 lib support is thin when
  we get there? (User: "ask me when it is needed" — decide at stage 9.)
- **Q4:** Node upgrade method — user said "ok" to proceeding; **recommend `nvm-windows`**
  (per-project Node switching, keeps the machine's other projects safe). Confirm + run before
  stage 2.
- **Q5:** Does anything in the Heroku/CI pipeline read committed `API/wwwroot` or `API/bin`?
  (Affects D-P3; nothing found in-repo. Ask if a deploy breaks.)

---

## 7. Session log (running)

- **2026-09-10** — Created `chore/migration-setup`. Added `docs/` (9 files), this file,
  `docker-compose.yml`, rewrote `.gitignore`, untracked `API/bin`+`API/obj`. Seeded decision
  log D-P1…D-F6. Rewrote `MIGRATION_PLAN.md` for the Angular-stays approach. Pushed branch.
- **2026-09-10** — User answers: (1) open PRs automatically → install+auth `gh`; (2) migrations
  = regenerate (D-B5 updated); (3) Angular final target deferred to stage 9; (4) Node method
  ok'd, recommend nvm-windows. Q1/Q2 resolved. Next: install `gh`, open the setup PR, then
  start stage 1 (backend) with the full two-gate review.
