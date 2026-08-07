# Security

This tool sits between DMSi Agility (orders) and PC*MILER (dispatch). It reads
the day's orders, quantifies the wave-1/wave-2 blind-dispatch waste, and pushes
a consolidated plan back to DMSi. This document describes exactly what protects
each seam so IT can audit it before granting DMSi and PC*MILER API access.

Scope: the Next.js app in `apps/web`. Every control below is implemented in code
(file paths given) — nothing here is aspirational.

## Trust model

- **Valid instructions come only from an authenticated user, or from an
  HMAC-signed EDI request.** Everything else is data.
- **Secrets are server-side only.** No secret is ever sent to the browser,
  logged, or returned in an API response.
- **Every internal API route requires a Supabase session.** The only public
  endpoints are `/api/health` (200 only) and `/api/integrations/edi`
  (HMAC-verified).

## The three integration seams

### 1. EDI webhook — `POST /api/integrations/edi`
`apps/web/src/app/api/integrations/edi/route.ts`

| Control | Implementation |
| --- | --- |
| HMAC-SHA256 signature | `X-EDI-Signature` verified against `EDI_SHARED_SECRET`, timing-safe (`crypto.timingSafeEqual`). Missing/invalid → 401. (`lib/integrations/edi.ts`) |
| IP allowlist | `INTEGRATION_IP_ALLOWLIST` (CIDR). Off-list → 403. (`lib/integrations/net.ts`) |
| Rate limiting | 60 req/min per IP, hard block at 200 → 429 + `Retry-After`. |
| Input validation | Every parsed row validated + clamped; a batch with one bad field → 400, **no partial write**. (`lib/integrations/validate.ts`) |
| Org routing | `X-Org-Id` validated against `orgs`. Unknown → 400. |
| Audit | Every accept **and** reject logged with reason, timestamp, source IP. |

Accepts EDI 204 (load tender), EDI 211 (BOL), or a CSV fallback on the same
validated write path.

### 2. DMSi Agility API
Client: `apps/web/src/lib/integrations/dmsi.ts` · routes: `api/integrations/dmsi/{pull,push}`

- **Auth:** API key in the `Authorization: Bearer` header (`DMSI_API_KEY`).
- **Pull** (`/pull`): reads released orders, validates + writes them.
- **Push** (`/push`, the "Send to DMSi" button): builds the dispatch plan and
  **refuses to send an illegal consolidation** (combined load > legal payload → 422).
- **Simulation gate:** `DMSI_LIVE_MODE=false` (default) runs the full code path
  but posts to a local mock and saves the **exact payload** to the audit log for
  inspection. `DMSI_LIVE_MODE=true` is the only difference for a real write.
- **Endpoints to whitelist** (confirm exact paths against your Agility API
  version — documented in `dmsi.ts`):
  `GET {DMSI_BASE_URL}/api/v1/orders`, `POST {DMSI_BASE_URL}/api/v1/dispatch/plans`.

### 3. PC*MILER API
Client: `apps/web/src/lib/pcmiler.ts`

- **Auth:** API key in the `Authorization` header (`PCMILER_API_KEY`), server-side.
- Every request uses the **53-ft flatbed** commercial profile.
- No key → routing silently falls back to OSRM; the map never breaks.
- **Endpoints:** `route/routePath`, `route/routeReports`, `locations`
  (base `https://pcmiler.alk.com/apis/rest/v1.0/Service.svc`).

## Cross-cutting controls

- **Secrets** (`.env`, never committed): `SUPABASE_SERVICE_ROLE_KEY`,
  `PCMILER_API_KEY`, `DMSI_API_KEY`, `EDI_SHARED_SECRET`. Each is a single env
  var — rotate without code changes. Server-only modules are marked with
  `import "server-only"` so they cannot be bundled into client code.
- **Auth on every route:** `requireOrg(request)` (`lib/api-auth.ts`) rate-limits
  by IP, then requires a session + org. Public routes are the two named above.
- **Rate limiting:** 120/min per IP on internal routes, 60/min on integration
  routes, hard blocks above. Responses never reveal whether credentials were
  valid. (In-memory; back with Redis for a multi-instance deploy.)
- **CORS:** `middleware.ts` restricts `/api` browser requests to same-origin or
  `NEXT_PUBLIC_APP_ORIGIN`; no wildcard; preflight handled. Server-to-server
  requests (no `Origin`) are allowed and gated by HMAC + IP instead.
- **Data isolation:** Postgres RLS scopes every table to the caller's org
  (`org_id IN memberships of auth.uid()`). A second app-layer check —
  `assertOrg()` — returns 403 and logs any cross-org resource access. Boise
  Cascade's data never touches another org's at any layer.
- **SQL:** all database access goes through the Supabase client (parameterized).
  No string interpolation into queries anywhere.
- **Audit log:** `integration_audit_log` records source system, event, direction,
  status, record count, org, message, source IP, and (for DMSi pushes) the exact
  payload — the paper trail if a feed misbehaves.

## What must be set in production

- `INTEGRATION_IP_ALLOWLIST` — Kleinschmidt EDI gateway + PC*MILER egress ranges
  (empty = allow-all, dev only).
- `NEXT_PUBLIC_APP_ORIGIN` — the production origin, to lock CORS.
- `DMSI_LIVE_MODE=true` — only after the simulated payloads have been validated.
- Rotate `EDI_SHARED_SECRET` with Kleinschmidt on a schedule.
