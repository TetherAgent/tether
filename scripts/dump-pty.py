#!/usr/bin/env python3
"""
Dump and inspect PTY byte streams from the local Tether SQLite store.

Why a Python script (not sqlite3 CLI):
  sqlite3 CLI renders 0x1b ESC bytes as the literal text "^[", which corrupts
  the byte stream. Python's sqlite3 + json.loads round-trip preserves real
  bytes, so the dumped file is a faithful PTY capture you can replay through
  xterm or analyze with ANSI tooling.

Examples:
  # List recent sessions
  scripts/dump-pty.py list
  scripts/dump-pty.py list --provider codex --limit 20

  # Dump a session's PTY bytes
  scripts/dump-pty.py dump tth_20260504_xxxxxx -o capture.bin
  scripts/dump-pty.py dump tth_20260504_xxxxxx > capture.bin

  # Analyze TUI patterns (ANSI sequences, semantic markers)
  scripts/dump-pty.py analyze tth_20260504_xxxxxx

  # Custom DB path
  TETHER_DB=/path/to/tether.db scripts/dump-pty.py list
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path


def db_path() -> Path:
    env = os.environ.get("TETHER_DB")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".tether" / "tether.db"


def open_db() -> sqlite3.Connection:
    path = db_path()
    if not path.exists():
        sys.exit(f"error: database not found at {path}\n"
                 f"  set TETHER_DB if it lives elsewhere")
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def cmd_list(args: argparse.Namespace) -> None:
    conn = open_db()
    sql = """
        SELECT s.id, s.provider, s.title, s.status,
               COUNT(e.id) as event_count,
               s.last_active_at
        FROM sessions s
        LEFT JOIN session_events e
          ON e.session_id = s.id AND e.type = 'terminal.output'
        {where}
        GROUP BY s.id
        ORDER BY s.last_active_at DESC
        LIMIT ?
    """
    params: list = []
    where = ""
    if args.provider:
        where = "WHERE s.provider = ?"
        params.append(args.provider)
    params.append(args.limit)
    rows = conn.execute(sql.format(where=where), params).fetchall()

    print(f"{'ID':<28} {'PROVIDER':<10} {'STATUS':<10} {'EVENTS':>8}  "
          f"{'LAST ACTIVE':<19}  TITLE")
    print("-" * 110)
    for r in rows:
        ts = datetime.fromtimestamp(r["last_active_at"] / 1000).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        title = (r["title"] or "")[:30]
        print(f"{r['id']:<28} {r['provider']:<10} {r['status']:<10} "
              f"{r['event_count']:>8}  {ts}  {title}")


def fetch_pty_bytes(sid: str) -> tuple[bytes, int]:
    conn = open_db()
    rows = conn.execute(
        "SELECT payload_json FROM session_events "
        "WHERE session_id = ? AND type = 'terminal.output' "
        "ORDER BY id",
        (sid,),
    ).fetchall()
    if not rows:
        sys.exit(f"error: no terminal.output events for {sid}")
    chunks: list[bytes] = []
    for r in rows:
        payload = json.loads(r["payload_json"])
        data = payload.get("data", "")
        chunks.append(data.encode("utf-8"))
    return b"".join(chunks), len(rows)


def cmd_dump(args: argparse.Namespace) -> None:
    raw, count = fetch_pty_bytes(args.session_id)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_bytes(raw)
        sys.stderr.write(
            f"wrote {len(raw)} bytes ({count} events) to {args.output}\n"
        )
    else:
        sys.stdout.buffer.write(raw)


SEMANTIC_MARKERS = "●⎿❯⏵⏷✻✱▶◐◓◑◒⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✗▸▾▿└├⏎⌘"
BOX_CHARS = "─│╭╮╰╯└├┘┐┌▏▕▔▁▌█▐▘▝▖▗"


def strip_ansi(data: bytes) -> str:
    s = data
    s = re.sub(rb"\x1b\][^\x07\x1b]*[\x07]", b"", s)        # OSC
    s = re.sub(rb"\x1b\[[0-9;<>?]*[a-zA-Z@]", b"", s)        # CSI
    s = re.sub(rb"\x1b[78=>HMNOPVWXYZ\\\]\^_`/]", b"", s)    # ESC + char
    s = re.sub(rb"\x1b\([AB012]", b"", s)                    # G0 charset
    return s.decode("utf-8", errors="replace")


def cmd_analyze(args: argparse.Namespace) -> None:
    raw, count = fetch_pty_bytes(args.session_id)
    print(f"session: {args.session_id}")
    print(f"events:  {count}")
    print(f"bytes:   {len(raw)}")
    print(f"esc:     {raw.count(0x1b)}")
    print()

    csi = re.findall(rb"\x1b\[[0-9;<>?]*[a-zA-Z@]", raw)
    osc = re.findall(rb"\x1b\][^\x07\x1b]*[\x07]", raw)
    print(f"CSI sequences: {len(csi)}")
    print(f"OSC sequences: {len(osc)}")
    print()
    print("top 10 CSI:")
    for s, c in Counter(csi).most_common(10):
        print(f"  {c:6d}  {s!r}")
    print()

    clean = strip_ansi(raw)
    markers = Counter(c for c in clean if c in SEMANTIC_MARKERS)
    print("semantic markers (used by some agents to express tool calls):")
    if markers:
        for m, c in markers.most_common():
            print(f"  {c:6d}  {m}")
    else:
        print("  (none) — agent likely paints to TUI grid via cursor "
              "positioning, not line-bullet patterns")
    print()

    # Verdict for B-mode applicability
    has_claude_markers = "●" in clean and "⎿" in clean
    has_box_only = (markers.get("●", 0) == 0
                    and any(c in clean for c in BOX_CHARS))
    print("=== B-mode (语义化) applicability ===")
    if has_claude_markers:
        print("  ✓ likely Claude Code style — '●' tool calls + '⎿' results "
              "found, regex parser will work")
    elif has_box_only:
        print("  ✗ likely Codex / pure-TUI style — only box drawing chars, "
              "no line markers; requires full xterm grid rendering")
    else:
        print("  ? unknown agent — manual inspection needed")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inspect Tether PTY captures from local SQLite store",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="list recent sessions")
    p_list.add_argument("--provider", help="filter by provider (claude, codex, ...)")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.set_defaults(func=cmd_list)

    p_dump = sub.add_parser("dump", help="write PTY bytes to file or stdout")
    p_dump.add_argument("session_id")
    p_dump.add_argument("-o", "--output",
                        help="output file path (default: stdout)")
    p_dump.set_defaults(func=cmd_dump)

    p_an = sub.add_parser("analyze",
                          help="show ANSI/TUI patterns and B-mode verdict")
    p_an.add_argument("session_id")
    p_an.set_defaults(func=cmd_analyze)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
