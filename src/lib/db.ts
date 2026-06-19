// =============================================================================
// 数据库连接（DAO 抽象层）
//
// 当前实现：node:sqlite（Node 22+ 内置，零依赖）
// 数据文件：项目根 .data/portfolio.db
//
// 切换数据库步骤（未来要换 PG/MySQL 时）：
//   1. 新建 src/lib/db-pg.ts 实现同样的 getDb() / withTx() 契约
//   2. 这里 export * from './db-pg'
//   3. 调用方零改动
// =============================================================================

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'portfolio.db');

let _db: DatabaseSync | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 账户：当前全局单账户（user_id='default'），未来按用户隔离时只需新增行
CREATE TABLE IF NOT EXISTS accounts (
  user_id      TEXT PRIMARY KEY,
  cash         REAL NOT NULL DEFAULT 1000000,    -- 初始 100w
  initial_cash REAL NOT NULL DEFAULT 1000000,    -- 入金累计（含初始 + 后续入金 - 出金）
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- 费率/规则配置（可被前端 PATCH 修改）
CREATE TABLE IF NOT EXISTS settings (
  user_id           TEXT PRIMARY KEY,
  commission_rate   REAL NOT NULL DEFAULT 0.00025,  -- 佣金 万 2.5
  commission_min    REAL NOT NULL DEFAULT 5,        -- 佣金最低
  stamp_tax_rate    REAL NOT NULL DEFAULT 0.0005,   -- 印花税 千 0.5（仅卖）
  transfer_fee_rate REAL NOT NULL DEFAULT 0.00001,  -- 过户费 万 0.1（仅沪市）
  enable_t1         INTEGER NOT NULL DEFAULT 1,     -- T+1 启用
  updated_at        INTEGER NOT NULL
);

-- 持仓：每只股票一行
CREATE TABLE IF NOT EXISTS positions (
  user_id      TEXT NOT NULL,
  symbol       TEXT NOT NULL,                    -- sh600519
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  shares       INTEGER NOT NULL DEFAULT 0,       -- 持仓股数
  avail_shares INTEGER NOT NULL DEFAULT 0,       -- 可卖股数（T+1）
  cost         REAL NOT NULL DEFAULT 0,          -- 移动加权成本（含费）
  realized     REAL NOT NULL DEFAULT 0,          -- 已实现盈亏累计
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, symbol)
);

-- 交易流水：每次下单一行
CREATE TABLE IF NOT EXISTS trades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  ts            INTEGER NOT NULL,                -- 成交时间 ms
  side          TEXT NOT NULL,                   -- buy / sell / adjust
  symbol        TEXT NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  shares        INTEGER NOT NULL,                -- 本笔股数（adjust 时 = 目标股数）
  price         REAL NOT NULL,                   -- 成交价（adjust 时 = 目标成本价）
  amount        REAL NOT NULL,                   -- 成交额 = shares*price
  commission    REAL NOT NULL DEFAULT 0,
  stamp_tax     REAL NOT NULL DEFAULT 0,
  transfer_fee  REAL NOT NULL DEFAULT 0,
  total_fee     REAL NOT NULL DEFAULT 0,
  net_amount    REAL NOT NULL,                   -- 买入扣款 = amount+fee；卖出到账 = amount-fee；adjust 同步现金时 = delta_cost
  realized_pnl  REAL NOT NULL DEFAULT 0,         -- 本笔已实现（卖出/调账减仓时有）
  cash_after    REAL NOT NULL,                   -- 成交后账户现金
  note          TEXT,
  -- 调账专用：保留调账前的快照，用于"撤销"
  before_shares    INTEGER,
  before_cost      REAL,
  before_realized  REAL,
  before_avail     INTEGER,
  before_cash      REAL,
  sync_cash        INTEGER NOT NULL DEFAULT 0,   -- adjust 时是否同步扣/补现金
  reverted         INTEGER NOT NULL DEFAULT 0    -- 是否已被撤销（撤销后该行保留以审计）
);
CREATE INDEX IF NOT EXISTS idx_trades_user_ts ON trades(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(user_id, symbol, ts DESC);

-- 资金流水：入金 / 出金 / 重置等非交易类账户变动
CREATE TABLE IF NOT EXISTS cash_flows (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  type      TEXT NOT NULL,                       -- deposit / withdraw / reset
  amount    REAL NOT NULL,
  note      TEXT,
  cash_after REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cashflows_user_ts ON cash_flows(user_id, ts DESC);

-- 用户问题反馈
--   用户提交问题（文字 + 截图）→ 开发者标记已修复（可附说明）→
--   用户在看板上"确认完成"后才彻底删除并清理图片。
CREATE TABLE IF NOT EXISTS issues (
  id           TEXT PRIMARY KEY,                 -- 自生成短 id：iss_<8 hex>
  description  TEXT NOT NULL,
  images_json  TEXT NOT NULL DEFAULT '[]',       -- ["<url>", ...]
  status       TEXT NOT NULL DEFAULT 'OPEN',     -- OPEN / RESOLVED
  reporter     TEXT,                             -- 浏览器临时 ID
  resolution   TEXT,                             -- 修复说明
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_issues_status_created ON issues(status, created_at DESC);
`;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function getDb(): DatabaseSync {
  if (_db) return _db;
  ensureDir();
  _db = new DatabaseSync(DB_FILE);
  _db.exec(SCHEMA);
  migrate(_db);
  return _db;
}

/** 轻量迁移：只增字段，不破坏老数据 */
function migrate(db: DatabaseSync) {
  const cols = db.prepare(`PRAGMA table_info(trades)`).all() as Array<{ name: string }>;
  const has = (n: string) => cols.some((c) => c.name === n);
  const adds: string[] = [];
  if (!has('before_shares'))   adds.push(`ALTER TABLE trades ADD COLUMN before_shares INTEGER`);
  if (!has('before_cost'))     adds.push(`ALTER TABLE trades ADD COLUMN before_cost REAL`);
  if (!has('before_realized')) adds.push(`ALTER TABLE trades ADD COLUMN before_realized REAL`);
  if (!has('before_avail'))    adds.push(`ALTER TABLE trades ADD COLUMN before_avail INTEGER`);
  if (!has('before_cash'))     adds.push(`ALTER TABLE trades ADD COLUMN before_cash REAL`);
  if (!has('sync_cash'))       adds.push(`ALTER TABLE trades ADD COLUMN sync_cash INTEGER NOT NULL DEFAULT 0`);
  if (!has('reverted'))        adds.push(`ALTER TABLE trades ADD COLUMN reverted INTEGER NOT NULL DEFAULT 0`);
  for (const sql of adds) db.exec(sql);
}

/** 简易事务封装 */
export function withTx<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const ret = fn(db);
    db.exec('COMMIT');
    return ret;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

/** 预编译 + 缓存 statement */
const _stmtCache = new Map<string, StatementSync>();
export function prep(sql: string): StatementSync {
  let s = _stmtCache.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    _stmtCache.set(sql, s);
  }
  return s;
}
