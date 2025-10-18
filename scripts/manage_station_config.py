#!/usr/bin/env python3
"""CLI helper to manage station configuration."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from station_config import load_station_config, save_station_config


def cmd_show(_args: argparse.Namespace) -> int:
    config = load_station_config()
    json.dump(config, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def cmd_set(args: argparse.Namespace) -> int:
    config = load_station_config()
    process = args.process if args.process is not None else config.get("process", "")

    available = None
    if args.available is not None:
        available = [item.strip() for item in args.available.split(',') if item.strip()]
    updated = save_station_config(process=process, available=available)
    json.dump(updated, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    if not args.name.strip():
        print("追加する工程名を指定してください", file=sys.stderr)
        return 1
    config = load_station_config()
    available = config.get("available", [])
    if args.name not in available:
        available.append(args.name)
    save_station_config(process=config.get("process", ""), available=available)
    return cmd_show(args)


def cmd_remove(args: argparse.Namespace) -> int:
    target = args.name.strip()
    if not target:
        print("削除する工程名を指定してください", file=sys.stderr)
        return 1
    config = load_station_config()
    available = [item for item in config.get("available", []) if item != target]
    process = config.get("process", "")
    if process == target:
        process = ""
    save_station_config(process=process, available=available)
    return cmd_show(args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage station configuration (station.json)")
    sub = parser.add_subparsers(dest="command", required=True)

    show_parser = sub.add_parser("show", help="Show current configuration")
    show_parser.set_defaults(func=cmd_show)

    set_parser = sub.add_parser("set", help="Set current process and/or available list")
    set_parser.add_argument("--process", help="工程名を設定")
    set_parser.add_argument("--available", help="利用可能工程リストをカンマ区切りで指定")
    set_parser.set_defaults(func=cmd_set)

    add_parser = sub.add_parser("add", help="候補リストに工程を追加")
    add_parser.add_argument("name", help="追加する工程名")
    add_parser.set_defaults(func=cmd_add)

    remove_parser = sub.add_parser("remove", help="候補リストから工程を削除")
    remove_parser.add_argument("name", help="削除する工程名")
    remove_parser.set_defaults(func=cmd_remove)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
