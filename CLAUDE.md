# Boise Cascade — Route Consolidation

Diagnostic middleware that sits between DMSi Agility (order management) and
PC*MILER (routing). It ingests a full day's delivery orders, finds same-day
deliveries that were split across separate trucks but could have legally shared
one (48,000 lb flatbed payload ceiling), quantifies the waste in dollars / miles
/ hours, and produces an optimized dispatch plan.

**This file is the handoff note.** If you're a fresh Claude Code session (on a
laptop or at claude.ai/code), read this first — it's the current state of the
project so you can pick up without the original chat history.

## Live deployment

- **Production app:** https://boise-cascade-ro.vercel.app (log in with email +
  password). This is cloud-hosted and always on — independent of any one machine.
- **Hosting:** Vercel. Project `boise-cascade-ro`
  (`prj_WrnaYhNQ85p2PodTDQDFoKbW33jJ`, team `team_7Zfnt14UjHqmgRCsS3B6YH4C`),
  root directory `apps/web`. **Every push to `main` auto-deploys.**
- **Database/auth:** Supabase project `qotlilqjkrewqoribepb`. Postgres with RLS
  scoped by `org_id`.
- **Repo:** https://github.com/nolanmarcouxllc/Boise-Cascade--RO

## Layout

- `apps/web/` — Next.js 14 (App Router, TypeScript, Tailwind). The dashboard,
  fleet map, analyze/upload flows, integrations page, automation pipeline.
- `apps/engine/` — Python diagnostic engine (Phase 0): ingest → geocode →
  detect → quantify → report. Client-agnostic.
- `supabase/` — schema / migrations.

## Running it on a new machine (e.g. laptop while traveling)

```bash
git clone https://github.com/nolanmarcouxllc/Boise-Cascade--RO.git
cd Boise-Cascade--RO/apps/web
npm install
npx vercel link        # link to the boise-cascade-ro project
npx vercel env pull .env.local   # pulls the secrets from Vercel — do NOT commit this file
npm run dev            # http://localhost:3000
```

Env files (`.env`, `.env.local`) are **gitignored on purpose** (they hold
secrets) — that's why they don't appear after a clone. Pull them from Vercel as
above, or copy from another machine.

### Environment variables the web app needs (names only — values live in Vercel)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_ORIGIN`,
`DMSI_API_KEY`, `DMSI_BASE_URL`, `DMSI_LIVE_MODE`,
`PCMILER_API_KEY`, `PCMILER_BASE_URL`,
`EDI_SHARED_SECRET`, `INTEGRATION_IP_ALLOWLIST`, `CRON_SECRET`.

PC*MILER routing activates only when `PCMILER_API_KEY` is set; otherwise the map
falls back to the public OSRM router.

## Two-machine workflow

Edit → `git push` on one machine → `git pull` on the other before starting.
Vercel redeploys the live URL on every push, so both machines and production
stay in sync. Never rely on remote-controlling one machine from another — run an
independent session instead (installed locally, or at claude.ai/code).

## Conventions

- **Plain-English everywhere.** Every label, metric, button, and tooltip must be
  understandable by someone seeing the app for the first time — no jargon, no
  bare abbreviations, no unexplained numbers. Expand terms (BOL → "Bill of
  Lading — the full list of what was on this truck"). This is a hard standard.
- Detection is weight-aware: `min_trucks_needed = ceil(total_weight / 48000)`.
- Order queue lifecycle: received → consolidating → dispatched. A check on
  not-yet-dispatched orders analyzes 0 records; the dashboard/fleet API skip
  those empty runs so the map never blanks out.
- Map colors: red = wasted trip, amber = truck ran with room to spare, blue =
  efficient route.

## Known pending item

- **Supabase auth redirect URL** — `https://boise-cascade-ro.vercel.app/**` still
  needs to be added to Supabase → Authentication → URL Configuration → Redirect
  URLs. This only affects magic-link login on production; email+password login
  works without it. Requires the Supabase dashboard or a Management API token.
