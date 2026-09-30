#!/usr/bin/env python3
"""Fail if any text file contains an em dash (U+2014).

Usage:
    python3 scripts/check_no_em_dash.py --staged   # staged files only
    python3 scripts/check_no_em_dash.py --all      # every tracked file

Prints ``path:line`` for each hit and exits non-zero if any are found.
Binary files, lockfiles, fixtures, raw data, generated geo files, and model
artifacts are skipped because they are data, not writing.
"""

from __future__ import annotations

import argparse
import fnmatch
import subprocess
import sys
from pathlib import Path

EM_DASH = chr(0x2014)

SKIP_PATTERNS = (
    "tests/fixtures/*",
    "services/tests/fixtures/*",
    "data/*",
    "ml/artifacts/*",
    "web/public/geo/*",
    "web/e2e/fixtures/*",
    "*.lock",
    "uv.lock",
    "Cargo.lock",
    "pnpm-lock.yaml",
    "package-lock.json",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.webp",
    "*.ico",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.otf",
    "*.wasm",
    "*.gz",
    "*.zip",
    "*.txt.bin",
    "*.bin",
    "*.pkl",
    "*.mp4",
)


def is_skipped(path: str) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in SKIP_PATTERNS)


def git_files(staged: bool) -> list[str]:
    if staged:
        cmd = ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"]
    else:
        cmd = ["git", "ls-files"]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    return [line for line in out.splitlines() if line]


def scan(path: Path) -> list[int]:
    try:
        raw = path.read_bytes()
    except (FileNotFoundError, IsADirectoryError):
        return []
    if b"\x00" in raw[:8192]:
        return []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return []
    return [i for i, line in enumerate(text.splitlines(), start=1) if EM_DASH in line]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--staged", action="store_true", help="check staged files")
    mode.add_argument("--all", action="store_true", help="check all tracked files")
    args = parser.parse_args()

    hits = 0
    for name in git_files(staged=args.staged):
        if is_skipped(name):
            continue
        for line in scan(Path(name)):
            print(f"{name}:{line}")
            hits += 1
    if hits:
        print(f"Found {hits} line(s) with an em dash. Use a period, comma, colon, or hyphen.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
