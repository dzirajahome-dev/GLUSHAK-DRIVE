# GLUSHAK DRIVE deployment status

Updated: 2026-10-28

## Summary

Local authentication work and focused tests are complete. No production Supabase migration, account mutation, Vercel deployment, or `git push` has been performed. This report records the current blockers and a safe sequence for future approval.

## Changes made locally

- Public registration assigns the `user` role only. The previous first-registration-admin behavior and public setup mode were removed from the Supabase auth function, local server, and account UI.
- `supabase/auth-schema.sql` enables RLS on the auth tables, revokes table/function access from `public`, `anon`, and `authenticated`, and grants required access to `service_role`. Security-definer functions use a restricted `search_path`. Admin promotion is a separate RPC callable only by `service_role`.
- Passwords use salted scrypt hashes; session tokens are stored as SHA-256 hashes and delivered in HttpOnly, SameSite=Strict, Secure cookies. Reset codes use HMAC with a server-only key, have expiry and attempt limits, and successful password resets revoke sessions.
- The account migrator requires explicit confirmation of the account source and the expected existing administrator ID. It refuses ambiguous admin identity, duplicate source IDs/emails, and existing account identity, role, salt, or password-hash conflicts. A fully matching rerun is a no-op.
- The schema deployment script requires an approved project ref, explicit deployment approval, backup confirmation, backup metadata/hash validation, and an absolute backup path outside the repository.
- Authentication rejects cross-site mutations even when the request omits the `Origin` header; the same-origin rule is consistent in the Vercel handler and local Node server.
- Backup metadata readers accept a UTF-8 BOM, and backup creation refuses to overwrite an existing metadata file.
- Added synthetic tests for registration/login/session/logout/password-reset/admin gating and account migration, including collision/conflict, BOM metadata, and rerun behavior.

## Existing administrator and account source

The local Node application historically stored accounts and sessions in the ignored root-level `users.json`; the old server authenticated against that file. The current Vercel auth implementation instead reads the private Supabase `public.site_users` and `public.site_sessions` tables. This is a separate application auth store, not Supabase Auth.

The local file was found and its structural fields were validated without displaying account data. It contains three accounts, including one local `admin`; the file is ignored by Git and has no Git history. The local Node server reads and writes this file, while the Vercel auth handler reads the private Supabase `public.site_users` and `public.site_sessions` tables. This does **not** establish that the local file matches the production database or that its administrator is the production account created while building the site. Production Vercel/Supabase account data and environment configuration were not queried or validated. No real admin identity is confirmed until the owner privately verifies the intended source and account ID.

Before any migration, privately confirm that the selected source is authoritative and set `SUPABASE_AUTH_SOURCE_CONFIRMED=YES` plus `SUPABASE_AUTH_ADMIN_ID` to the verified existing admin ID. The migrator preserves the existing role, salt, and scrypt hash; it does not need the plaintext password and does not migrate sessions, so users must sign in again.

## Backup verification and restore test

The supplied backup is outside the repository. Its byte size and SHA-256 match its metadata, and `pg_restore --list` successfully reads the archive. The metadata JSON contains a UTF-8 BOM; the schema deployer, account migrator, and admin-promotion tool now handle it and validate the metadata hash format.

A full restore was attempted in a newly initialized, temporary PostgreSQL 17 cluster bound to `127.0.0.1`, using a dedicated test database. It failed because the local installation does not include the Supabase `supabase_vault` extension required by the archive. The temporary server was stopped and its data directory removed; the existing PostgreSQL service remained running and was not used for the restore. No connection to production was made.

Therefore, archive readability and checksum integrity are verified, but a successful full restore is not. Repeat the restore test in an isolated Supabase-compatible environment that provides all required extensions, such as a disposable Supabase Local setup or a separately approved test project. Never restore this backup into production as a test.

## Vercel API assessment

The current `vercel.json` builds a static Vite site into `dist`. The `api` directory contains only `api/auth/[...path].js`; middleware checks the Supabase auth session and role for `/studio`.

The remaining application APIs are implemented in the long-running `server.cjs` and rely partly on local JSON files, process memory, and filesystem uploads. Routes for comments, messages, works, notifications, support, orders, payments, analytics, account data, and related features are not deployed as Vercel functions by the current configuration. This means auth alone is not a complete Vercel backend and some existing site/Studio features will fail or lack durable storage if deployed as-is.

Do not use `server.cjs` as a Vercel catch-all: its listener, process-local state, and filesystem persistence are not a safe serverless adapter. Before full Vercel cutover, either retain the complete Node server on a persistent host with durable storage, or port each required route to serverless handlers backed by durable storage and test the existing flows. No Vercel endpoint port or deployment was performed in this work.

## Environment variable names

Configure values only in an approved secret manager or the appropriate server environment. The values were not recorded here.

Schema deployment:

- `SUPABASE_URL`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_CONFIRM_PROJECT_REF`
- `SUPABASE_AUTH_BACKUP_FILE`
- `SUPABASE_BACKUP_CONFIRMED`
- `SUPABASE_SCHEMA_DEPLOY_APPROVED`

Account migration:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_CONFIRM_PROJECT_REF`
- `SUPABASE_AUTH_SOURCE_CONFIRMED`
- `SUPABASE_AUTH_ADMIN_ID`
- `SUPABASE_AUTH_BACKUP_FILE`
- `SUPABASE_BACKUP_CONFIRMED`

Vercel auth and password reset:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`

For a persistent local Node deployment, also configure a private `PASSWORD_RESET_PEPPER` of at least 32 characters. Never use `VITE_` variables for secrets. Do not place service-role credentials or access tokens in frontend code, Git, SQL source files, command history, or this report.

## Local validation

- `npm.cmd run test:auth`: 14 tests passed, 0 failed. Coverage includes public registration, existing administrator and ordinary-user login, hashed sessions, `/me`, logout, cross-site mutation rejection, password-reset request and confirmation, `/studio` role gating, explicit admin-source identity, BOM metadata, migration preservation, conflicts, and repeat-run no-op.
- `npm.cmd run build`: passed. Vite emitted existing warnings about classic scripts without `type="module"`.
- `node --check` on the auth API, local server, middleware, migration/deployment scripts, and tests: passed.
- `git diff --check`: passed.
- Local browser smoke test loaded the site and `/api/auth/me` returned the expected JSON shape. This does not verify production credentials or Supabase connectivity.
- No production migration, account change, Vercel deployment, or push was run.

## Remaining risks and blockers

1. Production account source and the intended admin identity remain unverified. Local `users.json` must not be assumed to mirror production.
2. A successful full backup restore remains blocked by the missing local `supabase_vault` extension; test in an isolated Supabase-compatible environment before production changes.
3. Vercel currently lacks serverless implementations for the non-auth application APIs; durable storage and route parity are unresolved.
4. Required Supabase/Vercel/Gmail environment configuration was not present in the local process and could not be confirmed in the Vercel project.
5. Migrated sessions are intentionally not retained; re-login is required after migration.

## Safe sequence after approval

1. Privately establish the authoritative production account source and verify the exact existing administrator identity. Do not create a replacement admin or reset its password.
2. Confirm the target Supabase project ref and verify the backup file, matching metadata, SHA-256, and location outside the repository.
3. Complete a full restore test in an isolated Supabase-compatible environment. Record only pass/fail and the required extension compatibility; do not restore to production.
4. Resolve API hosting: keep the complete Node backend on a persistent host, or port and test all required API routes and durable storage for Vercel. Do not deploy the current static-plus-auth-only setup as if it had route parity.
5. Review the SQL schema and configure the required deployment variables securely. After explicit approval, run `npm.cmd run deploy:auth-schema` against only the confirmed project.
6. Verify created tables, RLS status, and grants with read-only SQL. Do not enable public registration before confirming the schema and project.
7. Configure migration variables, including the verified source confirmation and administrator ID. After separate approval, run `npm.cmd run migrate:auth`; it should add only missing, conflict-free records and preserve the existing admin credentials and role.
8. Use read-only SQL to verify account counts and roles without selecting password salts or hashes. Test the existing admin password in the web UI without entering it into scripts or logs; confirm `/api/auth/me` and `/studio`.
9. Configure server-only Vercel/Gmail variables, deploy only after separate approval, and smoke-test auth plus every required application API and Studio feature.
10. Maintain a rollback plan using the verified backup. No rollback restore should be directed at production without its own explicit approval.

## Current status

Local code and tests are prepared, but full deployment readiness is blocked by the unverified production admin source, incomplete full-restore verification, and missing Vercel API parity. Production operations still require explicit approval.
