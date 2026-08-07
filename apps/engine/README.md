# Route Consolidation Diagnostic — Phase 0 Engine

A CLI tool that reads a delivery CSV and finds **consolidation candidates**:
same-day deliveries that were split across separate trucks when one truck could
have carried them. It quantifies the waste (miles, fleet-hours, dollars) and
renders a before/after summary plus a map.

Everything client-specific lives in a YAML config, so a second client is a new
config + CSV — not a rewrite.

## Pipeline

```
run.py
  ├─ ingest.py    raw CSV        → standard schema (column mapping from config)
  ├─ geocode.py   addresses      → lat/lng (uses given coords, then cache, then OSM)
  ├─ detect.py    deliveries     → candidate groups (same-customer OR geo-cluster)
  ├─ quantify.py  groups         → wasted miles / fleet-hours / $ (from config rates)
  └─ report.py    results        → output/summary.md + output/map.html (folium)
```

## Run it

```bash
cd apps/engine
python -m venv .venv && . .venv/Scripts/activate   # Windows; use bin/activate on macOS/Linux
pip install -r requirements.txt
python run.py --config config/boise_cascade.yaml --data data/boise_cascade_deliveries.csv
```

Outputs land in `apps/engine/output/`:
- `summary.md` — before/after table and the dollar figure
- `map.html` — depot, all stops, candidate groups colored and linked

The bundled synthetic dataset models Boise Cascade's Westfield, MA facility:
600 loads over 2 weeks (60/day, Mon-Fri), 53-ft flatbed distribution into the
northeast/mid-Atlantic corridor. It bakes in the real failure mode this tool
diagnoses — DMSi Agility releases orders in waves (06:30 / 09:45) and Trimble
PC*MILER routes only what's visible at dispatch time, so second-wave orders go
out on separate trucks into towns a wave-1 truck already covered with open
capacity. 59 consolidation groups are planted (11 on the "bad Wednesday",
2026-07-29), plus decoys that must NOT flag: legit heavy splits (combined
weight over the 48,000-lb legal payload) and same-truck doubles. Regenerate
with `tools/generate_dataset.py` (deterministic).

Detection is weight-aware: a split is only a candidate if fewer trucks could
legally have carried the combined load.

## Supabase (server-side, optional)

The run is fully local by default. Opt into Supabase with flags; all DB access
uses the **service_role** key (server-side only) read from the project-root
`.env` as `SUPABASE_SERVICE_ROLE_KEY`.

```bash
# ingest a CSV, then persist records + geocode cache + run + findings to Supabase
python run.py --data data/boise_cascade_deliveries.csv --write-db --db-cache

# re-analyze records already stored in Supabase (no CSV)
python run.py --source db --write-db --db-cache
```

Flags: `--source csv|db`, `--write-db`, `--db-cache`, `--org NAME` / `--org-id UUID`,
`--upload-id UUID`. Tables used: `orgs`, `uploads`, `delivery_records`,
`geocode_cache`, `analysis_runs`, `consolidation_findings`. Schema mapping (e.g.
`weight_lbs`->`order_size`, grouping on `customer_name` since the DB has no
`customer_id`) lives in `db.py`. Verify connectivity with `check_supabase.py`.

## Onboarding a second client

1. Copy `config/boise_cascade.yaml` → `config/<client>.yaml`.
2. Update `schema:` to map the client's CSV columns to the standard fields.
3. Update `costs:` with the client's rate card and depot location.
4. Drop their CSV in `data/` and point `data_file:` (or `--data`) at it.

No code changes. If the client's CSV lacks `lat`/`lng`, geocode.py fills them in
via OpenStreetMap/Nominatim and caches the results in `cache/`.

## The waste model (Phase 0)

For a candidate group served by *N* distinct trucks, one truck was enough. Each
of the other *N-1* trucks is charged one depot→stop→depot out-and-back — the trip
consolidation would remove. Miles convert to fleet-hours via `avg_speed_mph` plus
`service_time_minutes` per redundant stop, then to dollars via the rate card. See
`quantify.py` for the exact formula. This is intentionally simple and defensible;
Phase 1 can swap in real routing.
