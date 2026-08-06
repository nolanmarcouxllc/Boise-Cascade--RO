"""
run.py -- Phase 0 route-consolidation diagnostic, end to end.

    python run.py --config config/boise_cascade.yaml --data data/boise_cascade_deliveries.csv

Pipeline: ingest -> geocode -> detect -> quantify -> report.
A new client is a new --config + --data. No code changes.
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
                   help="Delivery CSV. Defaults to the config's data file if set.")
    p.add_argument("--output", default="output",
                   help="Directory for summary.md and map.html.")
    args = p.parse_args(argv)

    config_path = _resolve(args.config)
    if not os.path.exists(config_path):
        print(f"error: config not found: {config_path}", file=sys.stderr)
        return 2
    with open(config_path, "r", encoding="utf-8") as fh:
        config = yaml.safe_load(fh)

    data_path = _resolve(args.data or config.get("data_file", "data/deliveries.csv"))
    if not os.path.exists(data_path):
        print(f"error: data CSV not found: {data_path}", file=sys.stderr)
        return 2

    output_dir = _resolve(args.output)

    print(f"=== Route Consolidation Diagnostic — {config.get('client',{}).get('name','')} ===")
    df = ingest.load(data_path, config)
    df = geocode.geocode_dataframe(df, config, engine_dir=ENGINE_DIR)
    df, groups = detect.find_candidates(df, config)
    result = quantify.quantify(groups, config)
    report.build(df, result, config, output_dir)
    print("=== done ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
