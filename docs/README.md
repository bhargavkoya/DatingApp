# DatingApp — Codebase Reference

Purpose: give any contributor (human or agent) enough context to change this code **without
breaking how the app currently behaves**. During the .NET 5→10 / Angular 13→21 migration these
docs are the definition of "correct behaviour" — see `../CLAUDE.local.md` for process and
`../MIGRATION_PLAN.md` for the step-by-step plan.

These docs describe the app **as it is today** (pre-migration). They are corrected only when a
migration stage *deliberately and reviewably* changes behaviour (rare). See decision D-P4.

## Map

| File | What's in it |
|---|---|
| `01-architecture-overview.md` | The two apps, how they talk, runtime topology, deployment, how to run locally |
| `02-backend.md` | ASP.NET Core project layout, layering, DI wiring, request pipeline, cross-cutting patterns (Unit of Work, repositories, filters, error handling, pagination) |
| `03-frontend.md` | Angular app layout, bootstrap, routing, services, HTTP interceptors, guards/resolver, state model, third-party libraries |
| `04-data-model.md` | EF Core entities, relationships, keys, `OnModelCreating` config, the `IsApproved` query filter, migrations, seeding |
| `05-auth-and-security.md` | Identity setup, JWT issuance/validation, roles & policies, the client-side token/roles handling, known weak spots |
| `06-realtime-signalr.md` | The two hubs, presence tracking, message groups/threads, every client↔server event, the `access_token` query-string auth path |
| `07-feature-workflows.md` | Feature-by-feature: user story, screens, endpoints, end-to-end data flow, and what to be careful of |
| `08-invariants-and-contracts.md` | The "do not break these" checklist — API surface, wire formats, behaviours that other layers depend on |

## The 30-second version

- **`API/`** — ASP.NET Core 5 Web API. Controllers → `IUnitOfWork` → repositories → EF Core →
  PostgreSQL. ASP.NET Core Identity (int keys) issues JWTs. Two SignalR hubs for presence and
  messaging. Cloudinary stores photos.
- **`client/`** — Angular 13 SPA. Feature components → `@Injectable` services → `HttpClient`
  (3 interceptors: jwt / error / loading) → the API. `AccountService` holds the logged-in user
  in a `ReplaySubject` mirrored to `localStorage`. SignalR via `@microsoft/signalr`.
- **Glue** — in production `ng build` emits into `API/wwwroot/` and `FallbackController`
  serves `index.html` for non-API routes, so the whole thing is one origin. In development the
  Angular dev server (`:4200`) calls the API (`:5001`) cross-origin with a CORS allowance.
