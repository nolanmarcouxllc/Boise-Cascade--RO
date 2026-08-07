-- Integration layer tables (applied 2026-08 to project qotlilqjkrewqoribepb).
-- Every table is org-scoped with RLS matching the original 7 tables
-- (org_id IN memberships of auth.uid()). The existing 7 tables are unchanged.
-- Server code uses the service role (bypasses RLS); the web UI reads under the
-- user session and is scoped by these policies.

create table if not exists public.integration_audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  source_system text not null,            -- dmsi | pcmiler | edi | optimizer | csv
  event_type text not null,               -- pull_orders | push_plan | edi_204 | edi_211 | rejected
  direction text not null default 'inbound', -- inbound | outbound
  status text not null,                    -- success | failure | rejected
  record_count integer not null default 0,
  message text,
  payload jsonb,                           -- e.g. the exact plan that would post to DMSi
  source_ip text,
  created_at timestamptz not null default now()
);
create index if not exists integration_audit_log_org_created_idx
  on public.integration_audit_log (org_id, created_at desc);

create table if not exists public.integration_status (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  system text not null,                    -- dmsi | pcmiler | edi
  connected boolean not null default false,
  last_sync_at timestamptz,
  last_record_count integer not null default 0,
  detail text,
  updated_at timestamptz not null default now(),
  unique (org_id, system)
);

create table if not exists public.route_geometry_cache (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  cache_key text not null,
  provider text not null,                  -- pcmiler | osrm | straight
  geometry jsonb not null,                 -- [[lat,lng], ...]
  created_at timestamptz not null default now(),
  unique (org_id, cache_key)
);

create table if not exists public.optimized_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  run_id uuid references public.analysis_runs(id),
  plan jsonb not null,
  trucks_before integer,
  trucks_after integer,
  miles_before numeric,
  miles_after numeric,
  created_at timestamptz not null default now()
);
create index if not exists optimized_plans_run_idx on public.optimized_plans (run_id);

alter table public.integration_audit_log enable row level security;
alter table public.integration_status enable row level security;
alter table public.route_geometry_cache enable row level security;
alter table public.optimized_plans enable row level security;

create policy integration_audit_log_org_access on public.integration_audit_log
  for all using (org_id in (select org_id from public.memberships where user_id = auth.uid()));
create policy integration_status_org_access on public.integration_status
  for all using (org_id in (select org_id from public.memberships where user_id = auth.uid()));
create policy route_geometry_cache_org_access on public.route_geometry_cache
  for all using (org_id in (select org_id from public.memberships where user_id = auth.uid()));
create policy optimized_plans_org_access on public.optimized_plans
  for all using (org_id in (select org_id from public.memberships where user_id = auth.uid()));
