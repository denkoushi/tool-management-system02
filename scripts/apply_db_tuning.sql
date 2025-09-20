-- DBポストインストール（冪等）
-- 1) タイムゾーンを JST に
ALTER DATABASE sensordb SET timezone='Asia/Tokyo';

-- 2) loans のインデックス（未返却の高速化 / 履歴ソート最適化）
CREATE INDEX IF NOT EXISTS loans_open_by_tool_idx
  ON loans (tool_uid) WHERE returned_at IS NULL;

CREATE INDEX IF NOT EXISTS loans_open_by_borrower_idx
  ON loans (borrower_uid) WHERE returned_at IS NULL;

CREATE INDEX IF NOT EXISTS loans_loaned_at_idx
  ON loans (loaned_at DESC);

CREATE INDEX IF NOT EXISTS loans_returned_at_idx
  ON loans (returned_at DESC);

-- 3) 統計更新
ANALYZE;
