#!/usr/bin/env python3
"""Compare this lab's coefficients with CoolChange GET /api/v1/bootstrap.

Requires CoolChange running on COOLCHANGE_API (default http://localhost:3000).

  python -m coolchange.train_ols
  python -m coolchange.compare_api
"""
from __future__ import annotations

import json
import sys

import requests

from coolchange._config import API, MODEL_JSON


def main() -> None:
    if not MODEL_JSON.exists():
        sys.exit(f"Missing {MODEL_JSON}. Run: python -m coolchange.train_ols")
    local = json.loads(MODEL_JSON.read_text(encoding="utf-8"))

    url = f"{API}/api/v1/bootstrap"
    print(f"GET {url}")
    try:
        r = requests.get(url, timeout=15)
        r.raise_for_status()
    except requests.RequestException as exc:
        sys.exit(
            f"API request failed: {exc}\n"
            "Start CoolChange (`cd backend && npm run dev`) and retry."
        )

    live = r.json().get("model") or {}
    print("\nCoolChange live model (bootstrap):")
    print(json.dumps(live, indent=2))
    print("\nThis lab (full multivariate refit):")
    print(json.dumps({
        "function": local["function"],
        "coefficients": local["coefficients"],
        "full_r_squared": local["full_r_squared"],
        "test": local["test"],
    }, indent=2))

    live_slope = live.get("slope")
    lab_canopy = local["coefficients"].get("canopy_pct")
    if live_slope is not None and lab_canopy is not None:
        print(f"\ncanopy slope  live={live_slope}  lab_multivariate={lab_canopy}")
        print(
            "They will not match exactly: live is univariate OLS on all blocks; "
            "lab canopy coefficient is estimated with grass and density held constant."
        )


if __name__ == "__main__":
    main()
