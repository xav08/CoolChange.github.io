"""Verify the recorded model release after restoring its separate data bundle."""
import argparse
import json
from pathlib import Path

from coolchange._config import ROOT, CONFIG
from coolchange.coordinates import sha256_file


def verify_artifacts(root, manifest):
    """Check every listed file; missing or changed bytes invalidate this release."""
    errors = []
    for name, record in manifest["files"].items():
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"Manifest path must stay within the model directory: {name}")
        path = root / relative
        if not path.is_file():
            errors.append(f"Missing: {name}")
        elif path.stat().st_size != record["bytes"] or sha256_file(path) != record["sha256"]:
            errors.append(f"Checksum mismatch: {name}")
    if errors:
        raise ValueError("\n".join(errors))
    return len(manifest["files"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=CONFIG / "artifact_manifest.json")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    try:
        count = verify_artifacts(ROOT, manifest)
    except ValueError as exc:
        parser.exit(1, f"{exc}\nSee docs/ARTIFACTS.md to restore the matching release.\n")
    print(f"PASS {manifest['release']}: {count} artifact checksums match")


if __name__ == "__main__":
    main()
