"""
db.py -- Supabase data access for the engine (server-side, service-role).

All writes/reads here use the SERVICE ROLE key, which bypasses RLS. That is
correct for a trusted server-side batch job and MUST NEVER run in a browser or
be shipped to a client. The key is read from the project-root .env as
SUPABASE_SERVICE_ROLE_KEY.

Schema mapping (engine standard field  <->  DB column) lives in this module so
the rest of the pipeline keeps speaking the standard schema:

    delivery_records:
        customer_name <- customer_name        order_size  <- weight_lbs
        address       <- full_address         truck_id    <- truck_id
        delivery_date <- date                  route_id    <- route_id (if any)
        lat/lng       <- lat/lng
        (DB has no customer_id; detection groups on customer_name)

    consolidation_findings:
        customer_name  <- joined group customer names
        date           <- group date
        duplicate_trucks <- redundant_trucks
        wasted_miles   <- wasted_miles
        wasted_hours   <- wasted_fleet_hours
        est_cost_usd   <- cost_internal
        consolidated_plan_json <- full group detail (type, trucks, orders, ...)
"""

from __future__ import annotations

import math
import os

import pandas as pd
from dotenv import load_dotenv

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(ENGINE_DIR, "..", ".."))
ENV_PATH = os.path.join(PROJECT_ROOT, ".env")

_INSERT_CHUNK = 500


# --------------------------------------------------------------------------- #
# client
# --------------------------------------------------------------------------- #
def get_client():
    """Build a Supabase client with the service-role key. Raises a clear error
    if the key is missing so the caller knows exactly what to add to .env."""
    load_dotenv(ENV_PATH)
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url:
        raise RuntimeError(f"SUPABASE_URL missing from {ENV_PATH}")
    if not key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY missing from .env. Server-side DB access "
            "needs the service_role key (Supabase dashboard -> Project Settings "
            "-> API -> service_role). Add it as SUPABASE_SERVICE_ROLE_KEY=..."
        )
    from supabase import create_client
    return create_client(url, key)


# --------------------------------------------------------------------------- #
# small conversion helpers (keep everything JSON/PostgREST-safe)
# --------------------------------------------------------------------------- #
def _num(v):
    """Return a float, or None for NaN/blank/unparseable."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _isodate(v):
    """Return 'YYYY-MM-DD' or None."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    ts = pd.to_datetime(v, errors="coerce")
    return None if pd.isna(ts) else ts.date().isoformat()


def _txt(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    s = str(v).strip()
    return s or None


# --------------------------------------------------------------------------- #
# orgs / uploads
# --------------------------------------------------------------------------- #
def ensure_org(client, name: str) -> str:
    """Return the org id for `name`, creating the org if it doesn't exist."""
    existing = client.table("orgs").select("id").eq("name", name).limit(1).execute()
    if existing.data:
        oid = existing.data[0]["id"]
        print(f"[db] org '{name}' -> {oid} (existing)")
        return oid
    created = client.table("orgs").insert({"name": name}).execute()
    oid = created.data[0]["id"]
    print(f"[db] org '{name}' -> {oid} (created)")
    return oid


def create_upload(client, org_id: str, storage_path: str, status: str = "processed") -> str:
    """Record an upload row (one CSV = one upload) and return its id."""
    row = {"org_id": org_id, "storage_path": storage_path, "status": status}
    res = client.table("uploads").insert(row).execute()
    uid = res.data[0]["id"]
    print(f"[db] upload '{storage_path}' -> {uid}")
    return uid


# --------------------------------------------------------------------------- #
# delivery_records
# --------------------------------------------------------------------------- #
def insert_delivery_records(client, org_id: str, df: pd.DataFrame, upload_id=None) -> int:
    """Write standard-schema rows into delivery_records. Returns count inserted."""
    rows = []
    for _, r in df.iterrows():
        rows.append({
            "org_id": org_id,
            "upload_id": upload_id,
            "customer_name": _txt(r.get("customer_name")),
            "address": _txt(r.get("full_address") or r.get("address")),
            "delivery_date": _isodate(r.get("date")),
            "delivery_window": _txt(r.get("delivery_window")),
            "order_size": _num(r.get("weight_lbs")),
            "truck_id": _txt(r.get("truck_id")),
            "route_id": _txt(r.get("route_id")),
            "lat": _num(r.get("lat")),
            "lng": _num(r.get("lng")),
        })
    for i in range(0, len(rows), _INSERT_CHUNK):
        client.table("delivery_records").insert(rows[i:i + _INSERT_CHUNK]).execute()
    print(f"[db] inserted {len(rows)} delivery_records"
          + (f" for upload {upload_id}" if upload_id else ""))
    return len(rows)


def fetch_delivery_records(client, org_id: str, upload_id=None) -> pd.DataFrame:
    """Read delivery_records for an org (optionally one upload) into the engine's
    standard schema. DB uuid becomes order_id; customer_name doubles as
    customer_id (the grouping key), since the DB has no separate customer id."""
    q = client.table("delivery_records").select("*").eq("org_id", org_id)
    if upload_id:
        q = q.eq("upload_id", upload_id)
    res = q.execute()
    recs = res.data or []
    print(f"[db] fetched {len(recs)} delivery_records"
          + (f" for upload {upload_id}" if upload_id else ""))

    df = pd.DataFrame(recs)
    std = pd.DataFrame()
    if df.empty:
        # Return an empty frame with the columns downstream expects.
        cols = ["order_id", "date", "customer_id", "customer_name", "address",
                "city", "state", "zip", "truck_id", "weight_lbs", "lat", "lng",
                "route_id", "full_address"]
        return pd.DataFrame(columns=cols)

    std["order_id"] = df["id"].astype(str)
    std["date"] = pd.to_datetime(df.get("delivery_date"), errors="coerce").dt.normalize()
    std["customer_id"] = df.get("customer_name")       # no separate id in DB
    std["customer_name"] = df.get("customer_name")
    std["address"] = df.get("address")
    std["city"] = ""
    std["state"] = ""
    std["zip"] = ""
    std["truck_id"] = df.get("truck_id")
    std["weight_lbs"] = pd.to_numeric(df.get("order_size"), errors="coerce")
    std["lat"] = pd.to_numeric(df.get("lat"), errors="coerce")
    std["lng"] = pd.to_numeric(df.get("lng"), errors="coerce")
    std["route_id"] = df.get("route_id")
    std["full_address"] = df.get("address")
    return std


# --------------------------------------------------------------------------- #
# geocode_cache  (a pluggable cache backend for geocode.geocode_dataframe)
# --------------------------------------------------------------------------- #
class SupabaseCache:
    """Duck-typed like geocode._Cache (get/put/flush), backed by geocode_cache.
    Scoped to one org. Only newly discovered addresses are written on flush."""

    def __init__(self, client, org_id: str):
        self.client = client
        self.org_id = org_id
        self.data: dict[str, list[float]] = {}
        self._new: dict[str, list[float]] = {}
        res = (client.table("geocode_cache")
               .select("address,lat,lng").eq("org_id", org_id).execute())
        for row in (res.data or []):
            self.data[row["address"]] = [float(row["lat"]), float(row["lng"])]
        print(f"[db] loaded {len(self.data)} geocode_cache row(s) for org")

    def get(self, key: str):
        return self.data.get(key)

    def put(self, key: str, lat: float, lng: float) -> None:
        self.data[key] = [lat, lng]
        self._new[key] = [lat, lng]

    def flush(self) -> None:
        if not self._new:
            return
        rows = [{"org_id": self.org_id, "address": k, "lat": v[0], "lng": v[1]}
                for k, v in self._new.items()]
        for i in range(0, len(rows), _INSERT_CHUNK):
            self.client.table("geocode_cache").insert(rows[i:i + _INSERT_CHUNK]).execute()
        print(f"[db] wrote {len(rows)} new geocode_cache row(s)")
        self._new.clear()


# --------------------------------------------------------------------------- #
# analysis_runs / consolidation_findings
# --------------------------------------------------------------------------- #
def create_analysis_run(client, org_id: str, params: dict,
                        upload_id=None, status: str = "running") -> str:
    """Open an analysis_runs row and return its id."""
    row = {"org_id": org_id, "upload_id": upload_id, "status": status, "params": params}
    res = client.table("analysis_runs").insert(row).execute()
    rid = res.data[0]["id"]
    print(f"[db] analysis_run -> {rid} (status={status})")
    return rid


def update_run_status(client, run_id: str, status: str) -> None:
    client.table("analysis_runs").update({"status": status}).eq("id", run_id).execute()
    print(f"[db] analysis_run {run_id} -> {status}")


def insert_findings(client, org_id: str, run_id: str, result: dict) -> int:
    """Write one consolidation_findings row per candidate group."""
    rows = []
    for g in result["groups"]:
        rows.append({
            "org_id": org_id,
            "run_id": run_id,
            "customer_name": ", ".join(g["customer_names"]),
            "date": g["date"],                       # already 'YYYY-MM-DD'
            "duplicate_trucks": int(g["redundant_trucks"]),
            "wasted_miles": float(g["wasted_miles"]),
            "wasted_hours": float(g["wasted_fleet_hours"]),
            "est_cost_usd": float(g["cost_internal"]),
            "consolidated_plan_json": {
                "group_id": g["group_id"],
                "type": g["type"],
                "truck_ids": g["truck_ids"],
                "customer_ids": g["customer_ids"],
                "order_ids": [str(o) for o in g["order_ids"]],
                "delivery_count": g["delivery_count"],
                "distinct_trucks": g["distinct_trucks"],
                "leg_miles": g["leg_miles"],
                "centroid": list(g["centroid"]),
                "cost_3pl_benchmark": g["cost_3pl_benchmark"],
            },
        })
    if not rows:
        print("[db] no findings to insert")
        return 0
    for i in range(0, len(rows), _INSERT_CHUNK):
        client.table("consolidation_findings").insert(rows[i:i + _INSERT_CHUNK]).execute()
    print(f"[db] inserted {len(rows)} consolidation_findings for run {run_id}")
    return len(rows)
