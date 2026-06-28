import { NextRequest } from 'next/server';
import { getDb, prep } from '@/lib/db';

// =============================================================================
// /api/portfolio/stats — 交易统计（买卖量 / 频率 / 盈亏分布 / 个股活跃度）
//
// 查询参数：
//   range   天数范围，默认 90（最多 365）
//           ?range=30  → 只看最近 30 天
//           ?range=all → 全量（不做时间限制）
//
// 返回：
//   summary     总量统计（笔数、股数、金额、费率、胜率）
//   dailyTrades 按日统计交易频率和买卖量
//   fees        费率汇总
//   topSymbols  最活跃股票排行
//   recentTrades 最近 20 笔交易（带盈亏）
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// -------- SQL 聚合查询 --------

function querySummary(rangeDays: number | null) {
  const db = getDb();
  // 总交易笔数 + 买卖数量
  const totalStmt = db.prepare(`
    SELECT
      COUNT(*)                                                               AS total_trades,
      SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END)                        AS buy_count,
      SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END)                       AS sell_count,
      SUM(CASE WHEN side = 'buy' THEN shares ELSE 0 END)                   AS buy_shares,
      SUM(CASE WHEN side = 'sell' THEN shares ELSE 0 END)                  AS sell_shares,
      SUM(CASE WHEN side = 'buy' THEN amount ELSE 0 END)                   AS buy_amount,
      SUM(CASE WHEN side = 'sell' THEN amount ELSE 0 END)                  AS sell_amount,
      SUM(CASE WHEN side = 'sell' AND realized_pnl > 0 THEN 1 ELSE 0 END)  AS win_count,
      SUM(CASE WHEN side = 'sell' AND realized_pnl <= 0 THEN 1 ELSE 0 END) AS loss_count,
      SUM(CASE WHEN side = 'sell' THEN realized_pnl ELSE 0 END)            AS total_realized,
      SUM(total_fee)                                                        AS total_fees,
      CAST(ROUND(AVG(CASE WHEN side = 'sell' THEN realized_pnl ELSE NULL END), 2) AS REAL) AS avg_win_loss
    FROM trades
    WHERE user_id = 'default'
      AND reverted = 0
      AND side IN ('buy', 'sell')
  `);
  return totalStmt.get() as {
    total_trades: number; buy_count: number; sell_count: number;
    buy_shares: number; sell_shares: number;
    buy_amount: number; sell_amount: number;
    win_count: number; loss_count: number;
    total_realized: number; total_fees: number; avg_win_loss: number;
  };
}

function queryDaily(rangeDays: number | null) {
  const db = getDb();
  let sql: string;
  let row: unknown;

  if (rangeDays !== null) {
    const threshold = Date.now() - rangeDays * 86400000;
    const stmt = db.prepare(`
      SELECT
        DATE(ts / 1000, 'unixepoch', 'localtime')                             AS date,
        SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END)                         AS buy_count,
        SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END)                        AS sell_count,
        SUM(CASE WHEN side = 'buy' THEN amount ELSE 0 END)                    AS buy_amount,
        SUM(CASE WHEN side = 'sell' THEN amount ELSE 0 END)                   AS sell_amount,
        ROUND(SUM(CASE WHEN side = 'sell' THEN realized_pnl ELSE 0 END), 2)  AS realized_pnl
      FROM trades
      WHERE user_id = 'default'
        AND reverted = 0
        AND side IN ('buy', 'sell')
        AND ts >= ?1
      GROUP BY date
      ORDER BY date DESC
      LIMIT 365
    `);
    return stmt.all(threshold) as Array<{
      date: string; buy_count: number; sell_count: number;
      buy_amount: number; sell_amount: number; realized_pnl: number;
    }>;
  } else {
    const stmt = db.prepare(`
      SELECT
        DATE(ts / 1000, 'unixepoch', 'localtime')                             AS date,
        SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END)                         AS buy_count,
        SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END)                        AS sell_count,
        SUM(CASE WHEN side = 'buy' THEN amount ELSE 0 END)                    AS buy_amount,
        SUM(CASE WHEN side = 'sell' THEN amount ELSE 0 END)                   AS sell_amount,
        ROUND(SUM(CASE WHEN side = 'sell' THEN realized_pnl ELSE 0 END), 2)  AS realized_pnl
      FROM trades
      WHERE user_id = 'default'
        AND reverted = 0
        AND side IN ('buy', 'sell')
      GROUP BY date
      ORDER BY date DESC
      LIMIT 365
    `);
    return stmt.all() as Array<{
      date: string; buy_count: number; sell_count: number;
      buy_amount: number; sell_amount: number; realized_pnl: number;
    }>;
  }
}

function queryTopSymbols(rangeDays: number | null) {
  const db = getDb();
  let sql: string;
  if (rangeDays !== null) {
    const threshold = Date.now() - rangeDays * 86400000;
    const stmt = db.prepare(`
      SELECT
        symbol,
        MAX(name)                                                               AS name,
        COUNT(*)                                                                 AS trades,
        SUM(CASE WHEN side = 'buy' THEN amount ELSE 0 END)                     AS buy_amount,
        SUM(CASE WHEN side = 'sell' THEN amount ELSE 0 END)                    AS sell_amount,
        SUM(CASE WHEN side = 'sell' THEN shares ELSE 0 END)                    AS sell_shares,
        ROUND(SUM(CASE WHEN side = 'sell' THEN realized_pnl ELSE 0 END), 2)   AS realized_pnl
      FROM trades
      WHERE user_id = 'default'
        AND reverted = 0
        AND side IN ('buy', 'sell')
        AND ts >= ?1
      GROUP BY symbol
      ORDER BY trades DESC
      LIMIT 20
    `);
    return stmt.all(threshold) as Array<{
      symbol: string; name: string; trades: number;
      buy_amount: number; sell_amount: number; sell_shares: number;
      realized_pnl: number;
    }>;
  } else {
    const stmt = db.prepare(`
      SELECT
        symbol,
        MAX(name)                                                               AS name,
        COUNT(*)                                                                 AS trades,
        SUM(CASE WHEN side = 'buy' THEN amount ELSE 0 END)                     AS buy_amount,
        SUM(CASE WHEN side = 'sell' THEN amount ELSE 0 END)                    AS sell_amount,
        SUM(CASE WHEN side = 'sell' THEN shares ELSE 0 END)                    AS sell_shares,
        ROUND(SUM(CASE WHEN side = 'sell' THEN realized_pnl ELSE 0 END), 2)   AS realized_pnl
      FROM trades
      WHERE user_id = 'default'
        AND reverted = 0
        AND side IN ('buy', 'sell')
      GROUP BY symbol
      ORDER BY trades DESC
      LIMIT 20
    `);
    return stmt.all() as Array<{
      symbol: string; name: string; trades: number;
      buy_amount: number; sell_amount: number; sell_shares: number;
      realized_pnl: number;
    }>;
  }
}

function queryRecentTrades(limit: number) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT
      id, ts, side, symbol, code, name, shares, price, amount,
      commission, stamp_tax, transfer_fee, total_fee, net_amount,
      realized_pnl, cash_after, note
    FROM trades
    WHERE user_id = 'default'
      AND reverted = 0
      AND side IN ('buy', 'sell')
    ORDER BY ts DESC
    LIMIT ?
  `);
  return stmt.all(limit) as Array<{
    id: number; ts: number; side: string; symbol: string; code: string;
    name: string; shares: number; price: number; amount: number;
    commission: number; stamp_tax: number; transfer_fee: number;
    total_fee: number; net_amount: number; realized_pnl: number;
    cash_after: number; note: string | null;
  }>;
}

// 费率构成查询
function queryFeeBreakdown(rangeDays: number | null) {
  const db = getDb();
  if (rangeDays !== null) {
    const threshold = Date.now() - rangeDays * 86400000;
    const stmt = db.prepare(`
      SELECT
        ROUND(SUM(commission), 2)    AS total_commission,
        ROUND(SUM(stamp_tax), 2)     AS total_stamp,
        ROUND(SUM(transfer_fee), 2)  AS total_transfer,
        ROUND(SUM(total_fee), 2)     AS grand_total
      FROM trades
      WHERE user_id = 'default'
        AND reverted = 0
        AND side IN ('buy', 'sell')
        AND ts >= ?1
    `);
    return stmt.get(threshold) as {
      total_commission: number; total_stamp: number;
      total_transfer: number; grand_total: number;
    };
  } else {
    const stmt = db.prepare(`
      SELECT
        ROUND(SUM(commission), 2)    AS total_commission,
        ROUND(SUM(stamp_tax), 2)     AS total_stamp,
        ROUND(SUM(transfer_fee), 2)  AS total_transfer,
        ROUND(SUM(total_fee), 2)     AS grand_total
      FROM trades
      WHERE user_id = 'default'
        AND reverted = 0
        AND side IN ('buy', 'sell')
    `);
    return stmt.get() as {
      total_commission: number; total_stamp: number;
      total_transfer: number; grand_total: number;
    };
  }
}

// -------- 主入口 --------

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rangeRaw = sp.get('range') || '90';
  const rangeDays = rangeRaw === 'all' ? null : Math.min(365, Math.max(1, parseInt(rangeRaw, 10) || 90));

  try {
    const summary       = querySummary(rangeDays);
    const daily         = queryDaily(rangeDays);
    const topSymbols    = queryTopSymbols(rangeDays);
    const recentTrades  = queryRecentTrades(20);
    const fees          = queryFeeBreakdown(rangeDays);

    // 胜率
    const done = (summary.win_count || 0) + (summary.loss_count || 0);
    const winRate = done > 0
      ? Math.round((summary.win_count / done) * 10000) / 100
      : null;

    return Response.json({
      rangeDays,
      summary: {
        totalTrades:   summary.total_trades   ?? 0,
        buyCount:      summary.buy_count      ?? 0,
        sellCount:     summary.sell_count     ?? 0,
        buyShares:     summary.buy_shares     ?? 0,
        sellShares:    summary.sell_shares    ?? 0,
        buyAmount:     summary.buy_amount     ?? 0,
        sellAmount:    summary.sell_amount    ?? 0,
        totalFees:     Math.round((summary.total_fees ?? 0) * 100) / 100,
        totalRealized: Math.round((summary.total_realized ?? 0) * 100) / 100,
        avgWinLoss:    summary.avg_win_loss   ?? 0,
        winCount:      summary.win_count      ?? 0,
        lossCount:     summary.loss_count     ?? 0,
        winRate,
      },
      fees,
      dailyTrades: daily,
      topSymbols,
      recentTrades,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
