# Fraud Monitoring

A stateless, read-only reporting layer for branch POS transactions. The monorepo contains a NestJS API and Next.js dashboard; it does not own or provision a database.

## Architecture

```text
Browser (Next.js)
  ├─ branch list ────────────────┐
  ├─ one branch report request ──┼─> NestJS API
  └─ filtered XLSX export ───────┘     ├─> Datacenter branch directory
                                       ├─> Existing auth service
                                       └─> One selected MSSQL branch (short-lived)
```

The public branch list is cached for two minutes by default after credentials have been removed. Report requests resolve the selected branch record fresh, initialize one dynamic TypeORM `DataSource`, execute fixed parameterized SQL, and destroy the connection in `finally`. There is no automatic branch fan-out and no boot-time database connection.

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

- Dashboard: `http://localhost:3000`
- Swagger: `http://localhost:3001/docs`
- Health: `http://localhost:3001/api/health`

The `.env` file contains only service endpoints and behavior settings. Never add branch DB credentials to it.

Development containers:

```powershell
docker compose -f docker-compose.dev.yml up --build
```

The compose file intentionally contains only `backend` and `frontend`. It is for development, not production.

## API

- `POST /api/auth/login` — delegates to the existing auth service.
- `GET /api/auth/me` — validates an external session through the auth adapter.
- `GET /api/branches` — sanitized branches including offline records.
- `GET /api/reports/transactions` — one selected branch, date range, filters, and pagination.
- `GET /api/reports/transactions/export` — the same filters as XLSX, capped at 50,000 rows.

Report query parameters:

```text
branchId, from, to, page, pageSize, returned?, voided?, points?
```

Dates are inclusive calendar dates. The query applies `LogDate >= from AND LogDate < DATEADD(day, 1, to)` before exception filters to make existing date indexes useful. Date ranges are capped at 366 days and page size at 100.

## Security and operational behavior

- Every branch query is read-only and uses fixed SQL with driver-bound parameters.
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

`DATACENTER_ACTIVE_VALUE` defaults to `1`. The supplied example contains `isactive: 0` alongside `branchconnected: 1`, so confirm whether `0` actually means active in this API and set the environment value accordingly.

The auth implementation is deliberately behind `AuthProvider`. Until the login/token response is confirmed, the frontend recognizes common token names (`access_token`, `accessToken`, `token`) and the backend accepts the presence of a bearer token/cookie. Set `AUTH_VALIDATE_PATH` (for example `/auth/validate`) when the upstream validation endpoint is known; the backend will then validate on every guarded request. This provisional presence-only mode is not suitable for production.

The branch port defaults to `1433`; `branchserverport` is honored if the directory returns it. V1 is intentionally single-branch only.

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
