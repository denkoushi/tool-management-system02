#!/usr/bin/env python3
"""Manage API token for this station."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from api_token_store import (
    generate_token,
    get_token_info,
    save_token_file,
    delete_token_file,
    API_TOKEN_FILE,
)


def cmd_show(args: argparse.Namespace) -> int:
    info = get_token_info()
    if info.get("token") and not args.reveal:
        masked = info["token"][:4] + "***" if len(info["token"]) > 4 else "***"
        info = {**info, "token": masked, "token_masked": True}
    json.dump(info, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def cmd_issue(args: argparse.Namespace) -> int:
    station_id = args.station_id.strip()
    if not station_id:
        print("station_id を指定してください", file=sys.stderr)
        return 1
    token = args.token or generate_token()
    info = save_token_file(station_id=station_id, token=token, note=args.note)
    info["token"] = token  # ensure full token is printed
    json.dump(info, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


def cmd_rotate(args: argparse.Namespace) -> int:
    station_id = args.station_id or get_token_info().get("station_id", "")
    if not station_id:
        print("station_id を指定するか、既存設定に station_id が必要です", file=sys.stderr)
        return 1
    return cmd_issue(argparse.Namespace(station_id=station_id, token=None, note=args.note))


def cmd_revoke(_args: argparse.Namespace) -> int:
    delete_token_file()
    print(f"トークンファイル {API_TOKEN_FILE} を削除しました")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="API トークンを管理します")
    sub = parser.add_subparsers(dest="command", required=True)

    show_p = sub.add_parser("show", help="現在のトークン情報を表示")
    show_p.add_argument("--reveal", action="store_true", help="トークン文字列をマスクせず表示")
    show_p.set_defaults(func=cmd_show)

    issue_p = sub.add_parser("issue", help="新しいトークンを発行して保存")
    issue_p.add_argument("--station-id", required=True, help="ステーションID (例: CUTTING-01)")
    issue_p.add_argument("--note", help="任意メモ")
    issue_p.add_argument("--token", help="任意のトークン文字列を指定 (通常は自動生成)")
    issue_p.set_defaults(func=cmd_issue)

    rotate_p = sub.add_parser("rotate", help="トークンを再発行 (station_id は既存設定を使用)")
    rotate_p.add_argument("--station-id", help="任意: 新しい station_id を指定")
    rotate_p.add_argument("--note", help="任意メモ")
    rotate_p.set_defaults(func=cmd_rotate)

    revoke_p = sub.add_parser("revoke", help="トークンファイルを削除 (無効化)")
    revoke_p.set_defaults(func=cmd_revoke)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
