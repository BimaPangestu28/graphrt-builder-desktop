#!/usr/bin/env python3
"""Put one platform's block into an existing GitHub release body and print the result.

Usage: scripts/merge-release-notes.py <body.md> <block.md>

The block starts with "<!-- <name>:start -->" and ends with "<!-- <name>:end -->". If the body
already has a block with the same markers it is replaced, otherwise the block is appended.
Standard library only (runs on the macOS system python3).
"""

import re
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf-8") as body_file:
        body = body_file.read().strip()
    with open(sys.argv[2], encoding="utf-8") as block_file:
        block = block_file.read().strip()
    marker = re.match(r"<!-- ([\w-]+):start -->", block)
    if not marker or not block.endswith(f"<!-- {marker.group(1)}:end -->"):
        print(
            "error: the block must start and end with its <!-- name:start/end --> markers",
            file=sys.stderr,
        )
        return 1
    name = re.escape(marker.group(1))
    pattern = re.compile(rf"<!-- {name}:start -->.*?<!-- {name}:end -->", re.DOTALL)
    if pattern.search(body):
        body = pattern.sub(lambda _match: block, body, count=1)
    else:
        body = f"{body}\n\n{block}" if body else block
    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
