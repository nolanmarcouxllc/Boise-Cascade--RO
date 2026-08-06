"""
geocode.py -- turn addresses into lat/lng, with an on-disk cache.

Rules:
  1. If a row already has valid lat/lng (e.g. the client's TMS exported them),
     use those and don't touch the network.
  2. Otherwise look the address up in the JSON cache.
  3. Otherwise call the geocoder (Nominatim/OSM), rate-limited, and cache it.

This module also owns `distance_miles`, the one geodesic helper the rest of the
engine shares, so distance math is defined in exactly one place.
"""

from __future__ import annotations

import json
import os

import pandas as pd
from geopy.distance import geodesic


def distance_miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in miles between two (lat, lng) points."""
    return geodesic(a, b).miles


def _valid_coord(lat, lng) -> bool:
    """True only for real, in-range coordinates (not NaN, not 0/0)."""
    try:
        lat = float(lat)
        lng = float(lng)
    except (TypeError, ValueError):
        return False
    if pd.isna(lat) or pd.isna(lng):
        return False
    if lat == 0.0 and lng == 0.0:
        return False
    return -90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0


class _Cache:
    """Tiny JSON key->[lat,lng] cache that persists between runs."""

    def __init__(self, path: str):
        self.path = path
        self.data: dict[str, list[float]] = {}
        if path and os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    self.data = json.load(fh)
            except (json.JSONDecodeError, OSError):
                self.data = {}
        self._dirty = False

    def get(self, key: str):
        return self.data.get(key)

    def put(self, key: str, lat: float, lng: float) -> None:
        self.data[key] = [lat, lng]
        self._dirty = True

    def flush(self) -> None:
        if not self._dirty or not self.path:
            return
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(self.data, fh, indent=2, sort_keys=True)
        self._dirty = False


def _make_geocoder(cfg: dict):
    """Build a rate-limited geocode callable. Imported lazily so an offline run
    (all coords pre-supplied) never needs the network stack."""
    from geopy.extra.rate_limiter import RateLimiter
    from geopy.geocoders import Nominatim

    geolocator = Nominatim(user_agent=cfg.get("user_agent", "route-diagnostic"))
    return RateLimiter(
        geolocator.geocode,
        min_delay_seconds=float(cfg.get("rate_limit_seconds", 1.1)),
        max_retries=2,
        swallow_exceptions=True,
    )


def geocode_dataframe(df: pd.DataFrame, config: dict, engine_dir: str = ".") -> pd.DataFrame:
    """Return `df` with lat/lng populated. Adds a `geocode_source` column
    ('given' | 'cache' | 'lookup' | 'FAILED') for transparency."""
    cfg = config.get("geocoding", {})
    cache_path = os.path.join(engine_dir, cfg.get("cache_file", "cache/geocode_cache.json"))
    default_region = cfg.get("default_region", "")

    cache = _Cache(cache_path)
    geocode_fn = None  # built on first real lookup

    lats, lngs, sources = [], [], []
    n_given = n_cache = n_lookup = n_failed = 0

    for _, row in df.iterrows():
        # 1) coordinates already on the row?
        if _valid_coord(row.get("lat"), row.get("lng")):
            lats.append(float(row["lat"]))
            lngs.append(float(row["lng"]))
            sources.append("given")
            n_given += 1
            continue

        query = row.get("full_address", "")
        if default_region and default_region.lower() not in query.lower():
            query = f"{query}, {default_region}" if query else default_region

        # 2) cache hit?
        cached = cache.get(query)
        if cached:
            lats.append(cached[0])
            lngs.append(cached[1])
            sources.append("cache")
            n_cache += 1
            continue

        # 3) live lookup
        if geocode_fn is None:
            geocode_fn = _make_geocoder(cfg)
        loc = geocode_fn(query) if query else None
        if loc is not None:
            cache.put(query, loc.latitude, loc.longitude)
            lats.append(loc.latitude)
            lngs.append(loc.longitude)
            sources.append("lookup")
            n_lookup += 1
        else:
            lats.append(float("nan"))
            lngs.append(float("nan"))
            sources.append("FAILED")
            n_failed += 1

    out = df.copy()
    out["lat"] = lats
    out["lng"] = lngs
    out["geocode_source"] = sources
    cache.flush()

    print(f"[geocode] {n_given} given, {n_cache} cached, {n_lookup} looked up, "
          f"{n_failed} failed.")
    if n_failed:
        print(f"[geocode] warning: {n_failed} address(es) could not be geocoded "
              f"and will be dropped from detection.")
    return out
