# Seltra Engine test report

Run date: 2026-11-01.

## Automated checks

| Command | Result |
|---|---|
| `npm run engine:test` (backend) | **Pass** — 2 Jest suites, 11 tests. Covers API-key lookup/revocation, image request and response shape, Cloudflare model URL path, Flux multipart fields, binary image responses, provider image validation, response-size rejection with credit release, insufficient credits, vision JSON retry, and HTTP health/auth/streaming/501 contracts. |
| `npm run engine:check` (core) | **Pass** — no hardcoded legacy engine host in runtime code. |
| `npm run engine:test:contracts` (core) | **Pass** — 4 Vitest files, 27 tests for Seltra URL selection, engine authorization/request IDs, image and repair tool exposure in Build/free-model mode, and persisted settings migration. |
| `npm run engine:test:all` | **Pass** — combined command ran the backend suite, host check, and core contract suite; 37 tests before the additional Build/free-model regression test. Current separate suites total 38 tests. |
| `npm run build` (backend) | **Pass** — Prisma client generation and NestJS build before the latest URL-path edit. After that edit, Jest compiled and passed the engine source, and `npx nest build` passed without Prisma regeneration (the running backend held the generated client file open). |
| `npm run ts:main` (core) | **Pass** — main-process type-check passed after the Build-mode exposure changes. |
| `npm run engine:test:live` | **Pass** — real configured engine generated a valid JPEG and returned structured vision analysis. The first live attempt exposed encoded Cloudflare model slashes; after preserving separators, the live smoke passed. |
| `prisma validate` (backend) | **Pass** — schema validated during implementation. |

The Vite contract tests require filesystem access to load `vitest.config.ts` in this Windows workspace. The approved elevated run passed. A sandbox-only attempt failed before tests started with an access-denied config-resolution error.

## Test scope and operational checks

- Provider HTTP calls are mocked in automated tests. The opt-in live smoke test was run and passed; it used one image and one vision request and therefore consumed provider usage and Seltra Engine credits.
- A full process-level run against an isolated Postgres test database and mock Cloudflare server was not run. The configured backend `DATABASE_URL` points to a non-loopback Neon host, so applying migrations or starting bootstrap against it would modify a shared remote database. The additive migration is present at `prisma/migrations/20261101000000_seltra_engine/migration.sql`; it must be applied to the intended database before starting the service.
- Generated-app browser E2E (image asset rendered; `repair_app` fixes a deliberately injected app error) and stop/restart negative-path E2E remain unverified. Unit/HTTP contracts plus the live engine smoke cover the individual tool and endpoint contracts.
- The local core `.env.web` contains the Seltra engine URL and generated API key, and the backend `.env` bootstrap key matches it. Both files are gitignored. Never copy the key into logs, source, or commits.

## Known scope limits

The engine implements image generation, vision chat for repair diagnostics, chat completions/model listing, auth, request IDs, health, rate limiting, storage, and usage/credit settlement. Audited search, crawl/fetch, semantic code search, transcription, cloud sandbox lifecycle, `/responses`, `/messages`, `/free/chat/completions`, and legacy usage/quota APIs return authenticated `501 not_implemented` responses as documented in `engine-audit.md`.

The generated-app `useShop must be used inside ShopProvider` error is independent of the engine. The audit documents the required provider-boundary fix. Service-worker fetch failure should be revisited after the generated app renders and the engine is running.
