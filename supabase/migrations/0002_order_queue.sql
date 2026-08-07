-- Real-time order ingestion queue. All three entry points (EDI 204 webhook,
-- API push, CSV batch upload) write here; the consolidation scheduler drains
-- it. Same org+RLS pattern as every other table.
create table if not exists public.order_queue (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  source text not null,                    -- edi | api | csv
  status text not null default 'received', -- received | consolidating | dispatched | failed
  order_number text,
  dispatch_date date,
  delivery_record_id uuid references public.delivery_records(id),
  raw_payload jsonb,                       -- exactly what the source sent
  received_at timestamptz not null default now(),
  consolidated_at timestamptz,
  dispatched_at timestamptz
);
create index if not exists order_queue_org_status_idx on public.order_queue (org_id, status);
create index if not exists order_queue_org_date_idx on public.order_queue (org_id, dispatch_date);

alter table public.order_queue enable row level security;
create policy order_queue_org_access on public.order_queue
  for all using (org_id in (select org_id from public.memberships where user_id = auth.uid()));
