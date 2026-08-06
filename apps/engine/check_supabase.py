"""
check_supabase.py -- verify the Supabase connection.

Loads SUPABASE_URL / SUPABASE_ANON_KEY from the project-root .env, builds a
client, and pings the REST endpoint to confirm the URL is reachable and the key
is accepted. Prints a clear pass/fail. No project tables required yet.

    cd apps/engine
    .venv/Scripts/python check_supabase.py
"""

from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request

from dotenv import load_dotenv

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(ENGINE_DIR, "..", ".."))
ENV_PATH = os.path.join(PROJECT_ROOT, ".env")


def main() -> int:
    load_dotenv(ENV_PATH)
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_ANON_KEY")

    if not url or not key:
        print(f"FAIL: SUPABASE_URL / SUPABASE_ANON_KEY not found in {ENV_PATH}")
        return 1
    print(f"[env]  loaded from {ENV_PATH}")
    print(f"[env]  SUPABASE_URL = {url}")
    print(f"[env]  SUPABASE_ANON_KEY = {key[:12]}...{key[-6:]} (len {len(key)})")

    # 1) The client library builds cleanly (validates URL/key shape).
    try:
        from supabase import create_client
        create_client(url, key)
        print("[client] supabase.create_client() OK")
    except Exception as exc:  # noqa: BLE001 - report whatever the lib raises
        print(f"FAIL: create_client() raised: {exc!r}")
        return 1

    # 2) Live reachability + auth. The anon key is validated against an endpoint
    #    it's actually allowed to use: GoTrue's /auth/v1/settings (gated by the
    #    apikey header). 200 => reachable and key accepted.
    #    NOTE: the PostgREST root /rest/v1/ is service_role-only by design and
    #    will 401 for the anon key -- that's expected, not a bad key. Real table
    #    reads (/rest/v1/<table>) work with the anon key once tables + RLS exist.
    endpoint = url.rstrip("/") + "/auth/v1/settings"
    req = urllib.request.Request(
        endpoint,
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            code = resp.status
    except urllib.error.HTTPError as exc:
        code = exc.code
    except urllib.error.URLError as exc:
        print(f"FAIL: could not reach {endpoint}: {exc.reason}")
        return 1

    if code == 200:
        print(f"[auth] {endpoint} -> 200 OK (reachable, anon key accepted)")
        print("\nPASS: Supabase connection verified.")
        return 0
    if code in (401, 403):
        print(f"FAIL: {endpoint} -> {code} (reachable, but key rejected)")
        return 1
    print(f"WARN: {endpoint} -> {code} (reachable; unexpected status)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
