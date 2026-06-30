# Fraud Monitoring

A stateless, read-only reporting layer for branch POS transactions. The monorepo contains a NestJS API and Next.js dashboard; it does not own or provision a database.

## Architecture

```text
Browser (Next.js)
  ├─ branch list ────────────────┐
  ├─ selected branch report ─────┼─> NestJS API
  └─ filtered XLSX export ───────┘     ├─> Datacenter branch directory
                                       ├─> Existing monitoring_auth MySQL table (read-only)
                                       └─> One selected MSSQL branch (short-lived)
```

The public branch list is cached for two minutes by default after credentials have been removed. Branches are labeled with `branchlocation`, sorted alphabetically, and locations ending in `_FC` are excluded. Report requests resolve only the explicitly selected online branches, then process them sequentially: initialize one dynamic TypeORM `DataSource`, execute fixed parameterized SQL, destroy it in `finally`, and continue to the next selection. There is no concurrent connection fan-out and no boot-time database connection.

## Repository

```text
backend/                     NestJS API
frontend/                    Next.js App Router dashboard
docker-compose.dev.yml       Development services
.github/workflows/ci.yml
```

There must be one `.git` directory at this root and none below it.

## Local setup

Requirements: Node.js 20.11+ (22 recommended), npm 10+, and network access to the existing datacenter, auth, and selected MSSQL branch services.

```powershell
Copy-Item .env.example .env
npm install
npm run start:dev --workspace backend
npm run dev --workspace frontend
```

Open:

- Dashboard: `http://localhost:7071`
- Swagger: `http://localhost:6060/docs`
- Health: `http://localhost:6060/api/health`

The local `.env` contains service endpoints, application secrets, and behavior settings and is ignored by Git and Docker build contexts. Never add branch DB credentials to it.

For isolated connectivity diagnosis only, `DIRECT_BRANCH_MODE=true` bypasses the directory API and exposes one branch configured through `DIRECT_BRANCH_*` values in the ignored `.env`. Disable this mode after testing; production must use the datacenter directory.

Development containers:

```powershell
docker compose -f docker-compose.dev.yml up --build
```

The compose file intentionally contains only `backend` and `frontend`. It is for development, not production.

## API

- `POST /api/auth/login` — validates against the existing `monitoring_auth` MySQL table and issues an application JWT.
- `GET /api/auth/me` — validates the current application JWT.
- `GET /api/branches` — sanitized branches including offline records.
- `GET /api/reports/transactions` — explicitly selected branches, date range, filters, and pagination.
- `GET /api/reports/transactions/export` — the same filters as XLSX, capped at 50,000 rows.

Report query parameters:

```text
branchIds, from, to, page, pageSize, returned?, voided?, points?
```

Dates are inclusive calendar dates. The query applies `LogDate >= from AND LogDate < DATEADD(day, 1, to)` before exception filters to make existing date indexes useful. Date ranges are capped at 366 days and page size at 100.

## Security and operational behavior

- Every branch query is read-only and uses fixed SQL with driver-bound parameters.
- The backend sends `API_KEY` as `api-key` only to the branch directory. It is never exposed through `NEXT_PUBLIC_*` or browser requests.
- Guarded endpoints verify JWT signatures with `JWT_SECRET`, allow only HS256, and require a valid `exp` claim. Optional `JWT_ISSUER` and `JWT_AUDIENCE` values tighten claim validation when supplied.
- `/api/auth/me` returns the verified expiration timestamp; the frontend signs out at that exact time, removes its stored token, and restores the blocking login screen. It also revalidates the session every 60 seconds and when the window regains focus.
- Use a least-privilege MSSQL login whose only permissions are `SELECT` on required objects. Application code cannot compensate for an over-privileged DB account.
- Connection and query timeouts fail fast. Errors returned to the browser never include hostnames, usernames, passwords, or driver details.
- Pino logs redact authorization, cookies, passwords, and branch credential field names.
- Branch-triggering routes are rate limited.
- XLSX strings beginning with spreadsheet formula characters are neutralized.
- CORS is restricted to `FRONTEND_ORIGIN`; Helmet is enabled.
- Query audit events include branch ID, date range, external username, duration, and row count, but no credentials.

## Known schema assumptions

Two details cannot be finalized without the live contracts:

1. `CustomerName` currently falls back to `FinishedTransaction.CustomerCode`. Once the customer master table and join key are confirmed, update the fixed query in `backend/src/reports/report.sql.ts`.
2. Positive `FinishedSales.Points` with `PointsPosted = 1` is treated as earned; negative points are treated as redeemed. Confirm the loyalty ledger or transaction-type field before relying on this classification.

`DATACENTER_ACTIVE_VALUE` defaults to `0`, matching the supplied directory record where `isactive: 0` and `branchconnected: 1` represents an online branch.

The auth implementation remains behind `AuthProvider`. `LocalAuthProvider` performs a parameterized, read-only lookup against `monitoring_auth`, issues an HS256 JWT, and cryptographically verifies bearer tokens on every guarded request. The application does not create, migrate, or write authentication tables.

`branchIds` is a comma-separated list and is capped at 100 explicit selections. “Select all online” simply fills that explicit selection; the backend still queries branches sequentially. The branch port defaults to `1433`, and `branchserverport` is honored if the directory returns it.

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Unit tests cover dynamic connection lifecycle, fixed report SQL/points rules, local-date formatting, and XLSX generation/formula safety. Integration tests should point to a separately managed sandbox MSSQL instance; this repository must never migrate or seed it.

CI runs lint, type-check, test, and build as separate matrix stages. Deployment remains an explicit disabled placeholder until the target environment is known.

## DBA performance note

The query narrows both header and sales scans by `LogDate` before evaluating `Return`/`Voided`. If real volume is still slow, collect actual execution plans and ask the DBA for covering indexes based on observed predicates and included columns. Do not make schema changes from this application.
