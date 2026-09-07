#!/usr/bin/env python3
"""Package the extension directory into an XPI.

An XPI is a plain zip with manifest.json at the root. Uses zipfile rather than
the zip(1) binary so a build needs nothing but Python.
"""

import json
import sys
import zipfile
from pathlib import Path

EXT = Path(__file__).parent / "watch_later_ext"


def main():
    version = json.loads((EXT / "manifest.json").read_text())["version"]
    out = Path(__file__).parent / f"watch_later_ext@k11m1.eu-{version}.xpi"

    files = sorted(
        p for p in EXT.rglob("*")
        if p.is_file() and not p.name.startswith(".") and "META-INF" not in p.parts
    )

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            zf.write(path, path.relative_to(EXT).as_posix())

    print(f"built {out.name} ({out.stat().st_size} bytes, {len(files)} files)")
    for path in files:
        print(f"  {path.relative_to(EXT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
