# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Matrix homeserver proof-of-concept running on Cloudflare Workers with E2EE support. Built for Element Web and Element X clients. Not production-ready.

## Commands

```bash
npm run dev              # Start local dev server (wrangler dev)
npm test                 # Run Vitest tests
npm run typecheck        # TypeScript type checking
npm run lint             # ESLint on src/
npm run deploy           # Deploy to Cloudflare Workers
npm run db:migrate       # Run D1 migrations (production)
npm run db:migrate:local # Run D1 migrations (local)
```

## Architecture

**Stack:** Hono framework on Cloudflare Workers with D1 (SQLite), KV namespaces, R2 storage, Durable Objects, and Workflows.

**Request flow:**
```
Client → Hono Router (src/index.ts) → Middleware (auth, rate-limit) → API Handlers → D1/KV/R2/Durable Objects
```

**Key directories:**
- `src/api/` - Matrix Client-Server and Federation API endpoints (30+ files)
- `src/durable-objects/` - Real-time coordination (Room, Sync, Federation, UserKeys, Push, CallRoom, Admin)
- `src/services/` - Database abstraction, caching, external integrations
- `src/middleware/` - Auth token validation, rate limiting, idempotency
- `src/workflows/` - Long-running tasks (RoomJoinWorkflow, PushNotificationWorkflow)
- `src/utils/` - Crypto, error handling, ID generation

**Durable Objects pattern:** Each DO (RoomDurableObject, SyncDurableObject, etc.) routes requests via path in its `fetch` handler, uses `ctx.storage` for persistence, and supports alarms for periodic tasks.

**Cloudflare bindings (defined in wrangler.jsonc):**
- `DB` - D1 database (users, rooms, events, keys)
- `SESSIONS`, `DEVICE_KEYS`, `ONE_TIME_KEYS`, `CROSS_SIGNING_KEYS`, `CACHE`, `ACCOUNT_DATA` - KV namespaces
- `MEDIA` - R2 bucket for media files
- `ROOMS`, `SYNC`, `FEDERATION`, `USER_KEYS`, `PUSH`, `CALL_ROOMS`, `ADMIN` - Durable Object bindings
- `ROOM_JOIN_WORKFLOW`, `PUSH_NOTIFICATION_WORKFLOW` - Workflow bindings

## Path Aliases

TypeScript path alias `@/*` maps to `src/*` (configured in tsconfig.json).

## Deployment

Before deploying, update `wrangler.jsonc` with real IDs for D1 database, KV namespaces, and set `SERVER_NAME`. Set secrets with `npx wrangler secret put <NAME>` for TURN_API_TOKEN, CALLS_APP_SECRET, LIVEKIT_API_SECRET, and APNs credentials if needed.

## Platform Constraints

- Worker CPU: 30s max (paid plan)
- Worker memory: 128MB
- D1: 10GB, ~100ms query soft limit
- R2 object: 5GB max
- KV value: 25MB max
