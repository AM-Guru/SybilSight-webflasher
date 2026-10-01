"""Current additive CFW packaging entry point; keyboard relay is mandatory.

Accepts only the hash-pinned .84 image and its original or archive-wrapped recipe.
Historical packaging scripts remain usable for reproducing older revisions.
"""
import subprocess
import sys
import os
from pathlib import Path
import build_keyboard_relay

if __name__ == "__main__":
    result = build_keyboard_relay.main()
    # Emitted-code, sanitizer, provenance and replay checks gate a current build.
    subprocess.run([sys.executable, "-m", "unittest", "-v", "test_keyboard_relay"],
                   cwd=Path(__file__).parent, check=True,
                   env=dict(os.environ, G2_KEYBOARD_ARTIFACT=str(Path(result["image"]).resolve().parent)))
