"""
run.py -- Phase 0 route-consolidation diagnostic, end to end.

Local-only (unchanged default):
    python run.py --config config/boise_cascade.yaml --data data/boise_cascade_deliveries.csv

With Supabase (server-side, service-role):
    # ingest a CSV, persist records + run + findings to Supabase:
    python run.py --data data/boise_cascade_deliveries.csv --write-db --db-cache

    # re-analyze records already stored in Supabase:
    python run.py --source db --write-db --db-cache

Pipeline: ingest/fetch -> geocode -> detect -> quantify -> report (+ optional DB writes).
A new client is a new --config + --data (or a new org in the DB). No code changes.
"""

from __future__ import annotations

import argparse
import os
import sys

import yaml

import ingest
import geocode
import detect
import quantify
import report

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))


def _resolve(path: str) -> str:
    """Allow config/data/output paths to be given relative to the engine dir."""
    return path if os.path.isabs(path) else os.path.join(ENGINE_DIR, path)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Route consolidation diagnostic (Phase 0)")
    p.add_argument("--config", default="config/boise_cascade.yaml",
                   help="Client YAML config (schema + rates).")
    p.add_argument("--data", default=None,
                   help="Delivery CSV (source=csv). Defaults to the config's data_file.")
    p.add_argument("--output", default="output",
                   help="Directory for summary.md and map.html.")
    # --- Supabase options (all opt-in; omitting them keeps the run fully local) ---
    p.add_argument("--source", choices=["csv", "db"], default="csv",
                   help="Where deliveries come from: local CSV or Supabase delivery_records.")
    p.add_argument("--write-db", action="store_true",
                   help="Persist records (csv source), the analysis_run, and findings to Supabase.")
    p.add_argument("--db-cache", action="store_true",
                   help="Use the Supabase geocode_cache table instead of the local JSON cache.")
    p.add_argument("--org", default=None,
                   help="Org name to read/write under (default: client name from config).")
    p.add_argument("--org-id", default=None,
                   help="Org UUID to use directly (skips name lookup).")
    p.add_argument("--upload-id", default=None,
                   help="Existing upload id to read (source=db) or attach records to.")
    args = p.parse_args(argv)

    config_path = _resolve(args.config)
    if not os.path.exists(config_path):
        print(f"error: config not found: {config_path}", file=sys.stderr)
        return 2
    with open(config_path, "r", encoding="utf-8") as fh:
        config = yaml.safe_load(fh)

    output_dir = _resolve(args.output)
    client_name = config.get("client", {}).get("name", "")
    need_db = args.source == "db" or args.write_db or args.db_cache

    print(f"=== Route Consolidation Diagnostic — {client_name} ===")

    # --- Supabase client + org (only if any DB feature is requested) ---------
    client = org_id = None
    if need_db:
        import db  # imported lazily so a pure-local run never needs supabase installed
        client = db.get_client()
        org_id = args.org_id or db.ensure_org(client, args.org or client_name)

    # --- input: CSV or DB ----------------------------------------------------
    upload_id = args.upload_id
    if args.source == "csv":
        data_path = _resolve(args.data or config.get("data_file", "data/deliveries.csv"))
        if not os.path.exists(data_path):
            print(f"error: data CSV not found: {data_path}", file=sys.stderr)
            return 2
        df = ingest.load(data_path, config)
    else:  # db
        df = db.fetch_delivery_records(client, org_id, upload_id)
        if df.empty:
            print("error: no delivery_records found for that org/upload.", file=sys.stderr)
            return 3

    # --- geocode (file cache by default, Supabase cache if requested) --------
    cache = db.SupabaseCache(client, org_id) if args.db_cache else None
    df = geocode.geocode_dataframe(df, config, engine_dir=ENGINE_DIR, cache=cache)

    # --- persist records (csv -> DB) after geocoding so coords are stored -----
    if args.write_db and args.source == "csv":
        if upload_id is None:
            src_name = os.path.basename(_resolve(args.data or config.get("data_file", "deliveries.csv")))
            upload_id = db.create_upload(client, org_id, storage_path=src_name)
        db.insert_delivery_records(client, org_id, df, upload_id)

    # --- detect + quantify ---------------------------------------------------
    df, groups = detect.find_candidates(df, config)
    result = quantify.quantify(groups, config)

    # --- persist run + findings ---------------------------------------------
    if args.write_db:
        params = {
            "engine": "phase0",
            "source": args.source,
            "detection": config.get("detection", {}),
            "costs": config.get("costs", {}),
            "totals": result["totals"],
        }
        run_id = db.create_analysis_run(client, org_id, params, upload_id, status="running")
        db.insert_findings(client, org_id, run_id, result)
        db.update_run_status(client, run_id, "completed")

    # --- report (always writes local summary + map) --------------------------
    report.build(df, result, config, output_dir)
    print("=== done ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
