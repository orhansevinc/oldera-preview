#!/usr/bin/env python3
"""Current frozen control baseline for the WS50 staging rehearsal."""

import staging_candidate

# main moved after the first freeze only because of an unrelated official-site
# hero change. Re-freeze the current main control baseline without weakening any
# provider SHA checks in staging_candidate.py.
staging_candidate.FROZEN["MAIN"] = (
    "main",
    "c1c09f087ac01b3a700afefb5cdc4a7072cdec66",
)

raise SystemExit(staging_candidate.main())
