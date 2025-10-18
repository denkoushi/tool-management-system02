#!/usr/bin/env python3
"""Manage API tokens (multiple entries supported)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from api_token_store import (  # noqa: E402
    generate_token,
    get_token_info,
    list_tokens,
    issue_token,
    revoke_token,
    delete_token_file,
    API_TOKEN_FILE,
)


def cmd_show(args: argparse.Namespace) -> int:
    summary = get_token_info()
    tokens = list_tokens(with_token=args.reveal)
    result = {
        "summary": {k: v for k, v in summary.items() if k != "token" or args.reveal},
        "tokens": tokens,
        "file": str(API_TOKEN_FILE),
    }
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def cmd_issue(args: argparse.Namespace) -> int:
    station_id = args.station_id.strip()
    if not station_id:
        print("station_id を指定してください", file=sys.stderr)
        return 1
    entry = issue_token(
        station_id=station_id,
        token=args.token,
        note=args.note,
        keep_existing=args.keep_existing,
    )
    entry_out = dict(entry)
    if not args.reveal:
        entry_out["token_preview"] = entry_out["token"][:4] + "***"
        entry_out["token"] = entry_out["token"]
    json.dump(entry_out, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def cmd_rotate(args: argparse.Namespace) -> int:
    summary = get_token_info()
    station_id = args.station_id or summary.get("station_id")
    if not station_id:
        print("station_id を指定するか、既存設定に station_id が必要です", file=sys.stderr)
        return 1
    return cmd_issue(argparse.Namespace(
        station_id=station_id,
        token=None,
        note=args.note,
        keep_existing=False,
        reveal=args.reveal,
    ))


def cmd_revoke(args: argparse.Namespace) -> int:
    if args.file:
        delete_token_file()
        print(f"トークンファイル {API_TOKEN_FILE} を削除しました")
        return 0

    if not (args.token or args.station_id or args.all):
        print("--token / --station-id / --all のいずれかを指定してください", file=sys.stderr)
        return 1

    count = revoke_token(token=args.token, station_id=args.station_id, all_tokens=args.all)
    print(f"{count} 件のトークンに revoked_at を付与しました")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="API トークンを管理します")
    sub = parser.add_subparsers(dest="command", required=True)

    show_p = sub.add_parser("show", help="現在のトークン一覧を表示")
    show_p.add_argument("--reveal", action="store_true", help="トークン文字列をマスクせず表示")
    show_p.set_defaults(func=cmd_show)

    issue_p = sub.add_parser("issue", help="新しいトークンを発行して保存")
    issue_p.add_argument("--station-id", required=True, help="ステーションID (例: CUTTING-01)")
    issue_p.add_argument("--note", help="任意メモ")
    issue_p.add_argument("--token", help="任意のトークン文字列を指定 (通常は自動生成)")
    issue_p.add_argument("--keep-existing", action="store_true", help="既存トークンを無効化せず追加する")
    issue_p.add_argument("--reveal", action="store_true", help="発行結果でトークン全文を表示")
    issue_p.set_defaults(func=cmd_issue)

    rotate_p = sub.add_parser("rotate", help="トークンを再発行 (既存は無効化)")
    rotate_p.add_argument("--station-id", help="任意: 新しい station_id を指定")
    rotate_p.add_argument("--note", help="任意メモ")
    rotate_p.add_argument("--reveal", action="store_true", help="発行結果でトークン全文を表示")
    rotate_p.set_defaults(func=cmd_rotate)

    revoke_p = sub.add_parser("revoke", help="トークンを無効化")
    revoke_p.add_argument("--token", help="無効化するトークン文字列")
    revoke_p.add_argument("--station-id", help="指定ステーションのトークンを無効化")
    revoke_p.add_argument("--all", action="store_true", help="全トークンを無効化")
    revoke_p.add_argument("--file", action="store_true", help="ファイルごと削除")
    revoke_p.set_defaults(func=cmd_revoke)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
