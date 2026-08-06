"""
ingest.py -- normalize a raw delivery CSV into our standard schema.

The only client-specific knowledge here is the `schema:` mapping in the config,
which says which raw column maps to each standard field. Everything downstream
(geocode, detect, quantify, report) speaks the standard schema, so a new client
is a new config + CSV, not a code change.

Standard fields produced:
    order_id, date, customer_id, customer_name,
    address, city, state, zip, truck_id, weight_lbs,
    lat, lng, full_address
"""

from __future__ import annotations

import pandas as pd


# Fields the engine cannot work without.
REQUIRED = ["order_id", "date", "customer_id", "truck_id", "address"]

# Optional fields -- filled with sensible defaults if the client doesn't supply them.
OPTIONAL = ["customer_name", "city", "state", "zip", "weight_lbs", "lat", "lng"]


def load(csv_path: str, config: dict) -> pd.DataFrame:
    """Read `csv_path` and return a DataFrame in the standard schema."""
    schema = config["schema"]
    raw = pd.read_csv(csv_path, dtype=str, keep_default_na=False)

    # Map raw columns -> standard names. Missing source columns are allowed only
    # for optional fields; a missing required source column is a hard error.
    df = pd.DataFrame()
    for std_field, src_col in schema.items():
        if src_col in raw.columns:
            df[std_field] = raw[src_col]
        elif std_field in REQUIRED:
            raise ValueError(
                f"Config maps required field '{std_field}' -> column '{src_col}', "
                f"but that column is not in {csv_path}. "
                f"Available columns: {list(raw.columns)}"
            )
        else:
            df[std_field] = ""  # optional field absent -> blank, cleaned below

    _normalize(df)
    _validate(df, csv_path)
    return df


def _normalize(df: pd.DataFrame) -> None:
    """Clean types and whitespace in place."""
    # Trim every text field.
    for col in df.columns:
        df[col] = df[col].astype(str).str.strip()

    # Dates -> pandas datetime (normalized to midnight so same-day compares are exact).
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.normalize()

    # State codes -> upper, e.g. "id" -> "ID".
    if "state" in df:
        df["state"] = df["state"].str.upper()

    # Numerics.
    for col in ("weight_lbs", "lat", "lng"):
        if col in df:
            df[col] = pd.to_numeric(df[col].replace("", None), errors="coerce")

    # Fall back to the id when a human-readable name is missing.
    if "customer_name" in df:
        df["customer_name"] = df["customer_name"].where(
            df["customer_name"].astype(bool), df["customer_id"]
        )

    # A single geocodable address string ("addr, city, state zip").
    df["full_address"] = df.apply(_compose_address, axis=1)


def _compose_address(row: pd.Series) -> str:
    """Join the parts of an address that are present into one clean string."""
    street = str(row.get("address", "")).strip()
    city = str(row.get("city", "")).strip()
    state = str(row.get("state", "")).strip()
    zipc = str(row.get("zip", "")).strip()

    tail = " ".join(p for p in (state, zipc) if p)          # "ID 83702"
    parts = [p for p in (street, city, tail) if p]
    return ", ".join(parts)


def _validate(df: pd.DataFrame, csv_path: str) -> None:
    """Warn on rows that can't be used; raise only if nothing is usable."""
    bad_date = df["date"].isna()
    if bad_date.any():
        print(f"[ingest] warning: {int(bad_date.sum())} row(s) had an unparseable "
              f"date and will be ignored by detection.")

    if df.empty:
        raise ValueError(f"[ingest] {csv_path} produced zero rows.")

    print(f"[ingest] loaded {len(df)} deliveries from {csv_path} "
          f"across {df['date'].dt.date.nunique()} day(s), "
          f"{df['truck_id'].nunique()} truck(s), "
          f"{df['customer_id'].nunique()} customer(s).")
