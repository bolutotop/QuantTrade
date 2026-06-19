// =============================================================================
// 模拟交易业务逻辑
//
// 设计要点：
//   1. 移动加权平均成本：买入合并入成本（含买入手续费），卖出按当前均价结算 realized_pnl
//   2. T+1：买入当天不计入 avail_shares，跨自然日通过 settleT1OnRead() 结转
//   3. 手续费：佣金 + 印花税(仅卖) + 过户费(仅沪市)，全部默认值可被前端配置覆盖
//   4. A 股 100 股一手
// =============================================================================

import { getDb, withTx, prep } from './db';
import { isShanghaiSymbol } from './markets';

export const DEFAULT_USER_ID = 'default';

export type TradeSide = 'buy' | 'sell' | 'adjust';

export type Settings = {
  commissionRate: number;      // 默认 0.00025
  commissionMin: number;       // 5
  stampTaxRate: number;        // 0.0005
  transferFeeRate: number;     // 0.00001
  enableT1: boolean;
};

export type Account = {
  userId: string;
  cash: number;
  initialCash: number;
  marketValue: number;         // 持仓市值（实时价 × 股数 之和）
  totalAsset: number;          // cash + marketValue
  totalProfit: number;         // totalAsset - initialCash
  totalProfitPct: number;
  realizedPnl: number;         // 累计已实现
  floatingPnl: number;         // 累计浮动 (marketValue - 持仓成本)
  updatedAt: number;
};

export type Position = {
  symbol: string;
  code: string;
  name: string;
  shares: number;
  availShares: number;
  costPrice: number;           // 单股成本
  cost: number;                // 总成本（= shares × costPrice）
  realized: number;            // 该标的已实现累计
  // 以下市价相关字段需调用方注入实时价后计算
  lastPrice?: number;
  marketValue?: number;
  floatingPnl?: number;
  floatingPnlPct?: number;
  updatedAt: number;
};

export type Trade = {
  id: number;
  ts: number;
  side: TradeSide;
  symbol: string;
  code: string;
  name: string;
  shares: number;
  price: number;
  amount: number;
  commission: number;
  stampTax: number;
  transferFee: number;
  totalFee: number;
  netAmount: number;
  realizedPnl: number;
  cashAfter: number;
  note?: string | null;
  // 调账专用
  beforeShares?: number | null;
  beforeCost?: number | null;
  beforeRealized?: number | null;
  beforeAvail?: number | null;
  beforeCash?: number | null;
  syncCash?: boolean;
  reverted?: boolean;
};

export type CashFlow = {
  id: number;
  ts: number;
  type: 'deposit' | 'withdraw' | 'reset';
  amount: number;
  cashAfter: number;
  note?: string | null;
};

// ---------------- 内部工具 ----------------

/** 沪市判定：用于过户费计算 */
function isSH(symbol: string): boolean {
  return isShanghaiSymbol(symbol);
}

/** 当日 0 点（UTC+8）的 epoch ms —— 用于 T+1 结转 */
function todayStart(now = Date.now()): number {
  const d = new Date(now + 8 * 3600_000);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 8 * 3600_000;
}

// ---------------- Account ----------------

export function ensureAccount(userId = DEFAULT_USER_ID) {
  const now = Date.now();
  prep(
    `INSERT INTO accounts (user_id, cash, initial_cash, created_at, updated_at)
     VALUES (?, 1000000, 1000000, ?, ?)
     ON CONFLICT(user_id) DO NOTHING`
  ).run(userId, now, now);
  prep(
    `INSERT INTO settings (user_id, updated_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO NOTHING`
  ).run(userId, now);
}

export function getSettings(userId = DEFAULT_USER_ID): Settings {
  ensureAccount(userId);
  const row = prep('SELECT * FROM settings WHERE user_id = ?').get(userId) as
    | { commission_rate: number; commission_min: number; stamp_tax_rate: number; transfer_fee_rate: number; enable_t1: number }
    | undefined;
  if (!row) throw new Error('settings missing');
  return {
    commissionRate: row.commission_rate,
    commissionMin: row.commission_min,
    stampTaxRate: row.stamp_tax_rate,
    transferFeeRate: row.transfer_fee_rate,
    enableT1: !!row.enable_t1,
  };
}

export function updateSettings(patch: Partial<Settings>, userId = DEFAULT_USER_ID): Settings {
  ensureAccount(userId);
  const cur = getSettings(userId);
  const next = { ...cur, ...patch };
  // 简单校验
  for (const k of ['commissionRate', 'stampTaxRate', 'transferFeeRate'] as const) {
    if (next[k] < 0 || next[k] > 0.05) throw new Error(`${k} 超出合理范围 [0, 0.05]`);
  }
  if (next.commissionMin < 0 || next.commissionMin > 1000) throw new Error('commissionMin 超范围');
  prep(
    `UPDATE settings SET commission_rate=?, commission_min=?, stamp_tax_rate=?, transfer_fee_rate=?, enable_t1=?, updated_at=?
     WHERE user_id=?`
  ).run(
    next.commissionRate,
    next.commissionMin,
    next.stampTaxRate,
    next.transferFeeRate,
    next.enableT1 ? 1 : 0,
    Date.now(),
    userId,
  );
  return next;
}

// ---------------- 费用计算 ----------------

export type FeeBreakdown = {
  amount: number;        // 成交额
  commission: number;
  stampTax: number;
  transferFee: number;
  totalFee: number;
  netAmount: number;     // 买入：扣款 = amount + totalFee；卖出：到账 = amount - totalFee
};

export function calcFees(
  side: TradeSide,
  symbol: string,
  shares: number,
  price: number,
  s: Settings,
): FeeBreakdown {
  const amount = shares * price;
  const commission = Math.max(s.commissionMin, amount * s.commissionRate);
  const stampTax = side === 'sell' ? amount * s.stampTaxRate : 0;
  const transferFee = isSH(symbol) ? amount * s.transferFeeRate : 0;
  const totalFee = round2(commission) + round2(stampTax) + round2(transferFee);
  const netAmount = side === 'buy' ? amount + totalFee : amount - totalFee;
  return {
    amount: round2(amount),
    commission: round2(commission),
    stampTax: round2(stampTax),
    transferFee: round2(transferFee),
    totalFee: round2(totalFee),
    netAmount: round2(netAmount),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------------- T+1 结转 ----------------

/** 把历史买入但今天才需要可卖的股数补到 avail_shares */
export function settleT1(userId = DEFAULT_USER_ID): void {
  const start = todayStart();
  // 找出所有截至昨天还有股票但 avail < shares 的持仓，并且今天没有再买入（或买入也已 < 当日 0 点）
  // 简化处理：把所有 avail_shares < shares 且无"今天 ts >= 当日 0 点的买入" 的标记结转
  const rows = prep(
    `SELECT p.user_id, p.symbol, p.shares, p.avail_shares,
            (SELECT COALESCE(SUM(shares), 0) FROM trades t
              WHERE t.user_id = p.user_id AND t.symbol = p.symbol
                AND t.side = 'buy' AND t.ts >= ?) AS today_buy
       FROM positions p
      WHERE p.user_id = ? AND p.shares > 0 AND p.avail_shares < p.shares`
  ).all(start, userId) as Array<{ user_id: string; symbol: string; shares: number; avail_shares: number; today_buy: number }>;

  for (const r of rows) {
    // 可结转 = shares - today_buy（今天买的不能解锁），但不超过 shares
    const target = Math.max(r.avail_shares, Math.min(r.shares, r.shares - Number(r.today_buy)));
    if (target > r.avail_shares) {
      prep(`UPDATE positions SET avail_shares=? WHERE user_id=? AND symbol=?`).run(
        target, r.user_id, r.symbol,
      );
    }
  }
}

// ---------------- 下单 ----------------

export type TradeInput = {
  side: 'buy' | 'sell';   // 仅普通下单；adjust 走 adjustPosition()
  symbol: string;
  code: string;
  name: string;
  shares: number;     // 必须 > 0 且 100 倍数
  price: number;      // > 0
  ts?: number;
  note?: string;
};

export function placeTrade(input: TradeInput, userId = DEFAULT_USER_ID): Trade {
  const ts = input.ts ?? Date.now();
  if (!Number.isFinite(input.shares) || input.shares <= 0 || !Number.isInteger(input.shares)) {
    throw new Error('股数必须为正整数');
  }
  // A 股 100 整数倍约束；港股各股票一手不同（保守允许任意正整数）
  if (isShanghaiSymbol(input.symbol) || /^(sz|bj)/i.test(input.symbol)) {
    if (input.shares % 100 !== 0) {
      throw new Error('A 股股数必须为 100 的整数倍');
    }
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error('成交价必须 > 0');
  }
  ensureAccount(userId);
  settleT1(userId); // 每次下单前先结转

  const settings = getSettings(userId);
  const fee = calcFees(input.side, input.symbol, input.shares, input.price, settings);

  return withTx(() => {
    const acc = prep('SELECT cash FROM accounts WHERE user_id = ?').get(userId) as { cash: number } | undefined;
    if (!acc) throw new Error('account missing');
    let cash = acc.cash;

    const posRow = prep(
      `SELECT shares, avail_shares, cost, realized FROM positions WHERE user_id=? AND symbol=?`
    ).get(userId, input.symbol) as { shares: number; avail_shares: number; cost: number; realized: number } | undefined;

    let posShares = posRow?.shares ?? 0;
    let posAvail = posRow?.avail_shares ?? 0;
    let posCost = posRow?.cost ?? 0;
    let posRealized = posRow?.realized ?? 0;
    let realizedPnl = 0;

    if (input.side === 'buy') {
      if (cash < fee.netAmount) {
        throw new Error(`资金不足：需 ¥${fee.netAmount.toFixed(2)}，可用 ¥${cash.toFixed(2)}`);
      }
      cash = round2(cash - fee.netAmount);
      // 移动加权：cost += amount + fees（买入手续费计入成本）
      posCost = round2(posCost + fee.netAmount);
      posShares += input.shares;
      // T+1：avail 不变；T+0 模式下立即可卖
      if (!settings.enableT1) posAvail += input.shares;
    } else {
      // sell
      if (posShares < input.shares) throw new Error(`持仓不足：现有 ${posShares} 股，欲卖 ${input.shares} 股`);
      if (settings.enableT1 && posAvail < input.shares) {
        throw new Error(`可卖不足（T+1）：可卖 ${posAvail} 股，欲卖 ${input.shares} 股`);
      }
      // 当前单股均价
      const avgCost = posShares > 0 ? posCost / posShares : 0;
      // 卖出对应的成本
      const costOut = round2(avgCost * input.shares);
      realizedPnl = round2(fee.netAmount - costOut);
      posCost = round2(posCost - costOut);
      posShares -= input.shares;
      posAvail -= input.shares;
      posRealized = round2(posRealized + realizedPnl);
      cash = round2(cash + fee.netAmount);
      // 卖光时把残余 cost 清零（防浮点）
      if (posShares === 0) posCost = 0;
    }

    // 写交易流水
    const result = prep(
      `INSERT INTO trades (user_id, ts, side, symbol, code, name, shares, price, amount,
                           commission, stamp_tax, transfer_fee, total_fee, net_amount,
                           realized_pnl, cash_after, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId, ts, input.side, input.symbol, input.code, input.name,
      input.shares, input.price, fee.amount,
      fee.commission, fee.stampTax, fee.transferFee, fee.totalFee, fee.netAmount,
      realizedPnl, cash, input.note ?? null,
    );

    // upsert positions
    if (posShares > 0) {
      prep(
        `INSERT INTO positions (user_id, symbol, code, name, shares, avail_shares, cost, realized, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, symbol) DO UPDATE SET
           shares=excluded.shares,
           avail_shares=excluded.avail_shares,
           cost=excluded.cost,
           realized=excluded.realized,
           name=excluded.name,
           updated_at=excluded.updated_at`
      ).run(userId, input.symbol, input.code, input.name, posShares, posAvail, posCost, posRealized, ts);
    } else {
      // 卖光：保留行但 shares=0；也可以 DELETE，这里保留以记忆 realized 累计
      prep(
        `INSERT INTO positions (user_id, symbol, code, name, shares, avail_shares, cost, realized, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)
         ON CONFLICT(user_id, symbol) DO UPDATE SET
           shares=0, avail_shares=0, cost=0,
           realized=excluded.realized,
           name=excluded.name,
           updated_at=excluded.updated_at`
      ).run(userId, input.symbol, input.code, input.name, posRealized, ts);
    }

    // 更新 account.cash
    prep('UPDATE accounts SET cash=?, updated_at=? WHERE user_id=?').run(cash, ts, userId);

    return {
      id: Number(result.lastInsertRowid),
      ts, side: input.side, symbol: input.symbol, code: input.code, name: input.name,
      shares: input.shares, price: input.price,
      amount: fee.amount, commission: fee.commission, stampTax: fee.stampTax,
      transferFee: fee.transferFee, totalFee: fee.totalFee, netAmount: fee.netAmount,
      realizedPnl, cashAfter: cash, note: input.note ?? null,
    };
  });
}

// ---------------- 资金 ----------------

export function adjustCash(
  type: 'deposit' | 'withdraw' | 'reset',
  amount: number,
  note: string | null,
  userId = DEFAULT_USER_ID,
): { cash: number; flow: CashFlow } {
  if (type !== 'reset' && (!Number.isFinite(amount) || amount <= 0)) {
    throw new Error('金额必须 > 0');
  }
  ensureAccount(userId);
  return withTx(() => {
    const acc = prep('SELECT cash, initial_cash FROM accounts WHERE user_id=?').get(userId) as
      | { cash: number; initial_cash: number }
      | undefined;
    if (!acc) throw new Error('account missing');
    let cash = acc.cash;
    let initial = acc.initial_cash;
    let realAmount = amount;

    if (type === 'deposit') {
      cash = round2(cash + amount);
      initial = round2(initial + amount);
    } else if (type === 'withdraw') {
      if (cash < amount) throw new Error('现金不足以出金');
      cash = round2(cash - amount);
      initial = round2(initial - amount);
    } else {
      // reset：清账户与持仓
      prep('DELETE FROM positions WHERE user_id=?').run(userId);
      prep('DELETE FROM trades WHERE user_id=?').run(userId);
      prep('DELETE FROM cash_flows WHERE user_id=?').run(userId);
      cash = 1_000_000;
      initial = 1_000_000;
      realAmount = cash;
    }

    const ts = Date.now();
    prep('UPDATE accounts SET cash=?, initial_cash=?, updated_at=? WHERE user_id=?')
      .run(cash, initial, ts, userId);

    const r = prep(
      `INSERT INTO cash_flows (user_id, ts, type, amount, note, cash_after) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, ts, type, realAmount, note, cash);

    return {
      cash,
      flow: {
        id: Number(r.lastInsertRowid),
        ts, type, amount: realAmount, cashAfter: cash, note,
      },
    };
  });
}

// ---------------- 查询 ----------------

export function listPositions(userId = DEFAULT_USER_ID): Position[] {
  settleT1(userId);
  const rows = prep(
    `SELECT * FROM positions WHERE user_id=? AND shares > 0 ORDER BY updated_at DESC`
  ).all(userId) as Array<{
    symbol: string; code: string; name: string;
    shares: number; avail_shares: number; cost: number; realized: number; updated_at: number;
  }>;
  return rows.map((r) => ({
    symbol: r.symbol, code: r.code, name: r.name,
    shares: r.shares, availShares: r.avail_shares,
    costPrice: r.shares > 0 ? round2(r.cost / r.shares) : 0,
    cost: round2(r.cost),
    realized: round2(r.realized),
    updatedAt: r.updated_at,
  }));
}

export function listTrades(opts: { limit?: number; offset?: number; symbol?: string } = {}, userId = DEFAULT_USER_ID): Trade[] {
  ensureAccount(userId);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = opts.symbol
    ? prep(`SELECT * FROM trades WHERE user_id=? AND symbol=? ORDER BY ts DESC LIMIT ? OFFSET ?`)
        .all(userId, opts.symbol, limit, offset)
    : prep(`SELECT * FROM trades WHERE user_id=? ORDER BY ts DESC LIMIT ? OFFSET ?`)
        .all(userId, limit, offset);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    ts: Number(r.ts),
    side: String(r.side) as TradeSide,
    symbol: String(r.symbol), code: String(r.code), name: String(r.name),
    shares: Number(r.shares), price: Number(r.price), amount: Number(r.amount),
    commission: Number(r.commission), stampTax: Number(r.stamp_tax),
    transferFee: Number(r.transfer_fee), totalFee: Number(r.total_fee),
    netAmount: Number(r.net_amount), realizedPnl: Number(r.realized_pnl),
    cashAfter: Number(r.cash_after),
    note: r.note as string | null,
    beforeShares:   r.before_shares   == null ? null : Number(r.before_shares),
    beforeCost:     r.before_cost     == null ? null : Number(r.before_cost),
    beforeRealized: r.before_realized == null ? null : Number(r.before_realized),
    beforeAvail:    r.before_avail    == null ? null : Number(r.before_avail),
    beforeCash:     r.before_cash     == null ? null : Number(r.before_cash),
    syncCash:       !!Number(r.sync_cash ?? 0),
    reverted:       !!Number(r.reverted ?? 0),
  }));
}

export function listCashFlows(limit = 100, userId = DEFAULT_USER_ID): CashFlow[] {
  ensureAccount(userId);
  const rows = prep(`SELECT * FROM cash_flows WHERE user_id=? ORDER BY ts DESC LIMIT ?`).all(userId, limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    ts: Number(r.ts),
    type: r.type as CashFlow['type'],
    amount: Number(r.amount),
    cashAfter: Number(r.cash_after),
    note: r.note as string | null,
  }));
}

/** 获取账户总览（不含市值；调用方注入实时价后再 enrich） */
export function getAccountBase(userId = DEFAULT_USER_ID): Pick<Account, 'userId' | 'cash' | 'initialCash' | 'updatedAt'> {
  ensureAccount(userId);
  const row = prep(`SELECT cash, initial_cash, updated_at FROM accounts WHERE user_id=?`).get(userId) as
    | { cash: number; initial_cash: number; updated_at: number }
    | undefined;
  if (!row) throw new Error('account missing');
  return {
    userId,
    cash: row.cash,
    initialCash: row.initial_cash,
    updatedAt: row.updated_at,
  };
}

/** 给定每个 symbol 的最新价，组合出完整 Account 视图 */
export function buildAccountView(prices: Record<string, number>, userId = DEFAULT_USER_ID): { account: Account; positions: Position[] } {
  const base = getAccountBase(userId);
  const positions = listPositions(userId).map((p) => {
    const lastPrice = prices[p.symbol];
    if (typeof lastPrice === 'number' && lastPrice > 0 && p.shares > 0) {
      const marketValue = round2(lastPrice * p.shares);
      const floatingPnl = round2(marketValue - p.cost);
      const floatingPnlPct = p.cost > 0 ? round2((floatingPnl / p.cost) * 10000) / 100 : 0;
      return { ...p, lastPrice, marketValue, floatingPnl, floatingPnlPct };
    }
    return p;
  });
  const marketValue = positions.reduce((a, p) => a + (p.marketValue ?? 0), 0);
  const totalCost = positions.reduce((a, p) => a + p.cost, 0);
  const floatingPnl = round2(marketValue - totalCost);
  const realizedPnl = positions.reduce((a, p) => a + p.realized, 0)
    + (prep(`SELECT COALESCE(SUM(realized), 0) AS r FROM positions WHERE user_id=? AND shares=0`).get(userId) as { r: number }).r;
  const totalAsset = round2(base.cash + marketValue);
  const totalProfit = round2(totalAsset - base.initialCash);
  const totalProfitPct = base.initialCash > 0 ? round2((totalProfit / base.initialCash) * 10000) / 100 : 0;

  return {
    account: {
      userId: base.userId,
      cash: base.cash,
      initialCash: base.initialCash,
      marketValue: round2(marketValue),
      totalAsset,
      totalProfit,
      totalProfitPct,
      realizedPnl: round2(realizedPnl),
      floatingPnl,
      updatedAt: base.updatedAt,
    },
    positions,
  };
}

// ---------------- 手动调账 ----------------

export type AdjustInput = {
  symbol: string;
  code: string;
  name: string;
  targetShares: number;     // 目标持仓股数（≥ 0；0 = 清仓）
  targetCostPrice: number;  // 目标成本价（targetShares > 0 时必填且 > 0）
  syncCash?: boolean;       // 是否同步扣/补现金（默认 false：纯改持仓快照）
  ts?: number;
  note?: string;
};

/**
 * 手动调整某只股票的持仓与成本价（典型场景：从其他软件同步过来）。
 *
 * 语义（详见顶部注释）：
 *   - 直接覆盖 positions.{shares, cost, avail_shares} 为目标值
 *   - 减仓的部分以 targetCostPrice 虚拟卖出，差额计入 realized
 *   - syncCash=true 时按 (新持仓总成本 − 旧持仓总成本) 同步扣/补现金；不收手续费
 *   - 一并写一条 side='adjust' 的流水（保留 before 快照供撤销）
 */
export function adjustPosition(input: AdjustInput, userId = DEFAULT_USER_ID): Trade {
  const { symbol, code, name } = input;
  const targetShares = Math.floor(Number(input.targetShares));
  const targetCostPrice = Number(input.targetCostPrice);

  if (!Number.isFinite(targetShares) || targetShares < 0) {
    throw new Error('目标股数必须 >= 0');
  }
  if (targetShares > 0) {
    if (!Number.isFinite(targetCostPrice) || targetCostPrice <= 0) {
      throw new Error('目标成本价必须 > 0');
    }
  }
  // A 股 100 整数倍约束；港股放开
  if (targetShares > 0 && /^(sh|sz|bj)/i.test(symbol) && targetShares % 100 !== 0) {
    throw new Error('A 股股数必须为 100 的整数倍');
  }
  ensureAccount(userId);

  const ts = input.ts ?? Date.now();
  const syncCash = !!input.syncCash;

  return withTx(() => {
    const acc = prep('SELECT cash FROM accounts WHERE user_id=?').get(userId) as { cash: number } | undefined;
    if (!acc) throw new Error('account missing');
    const beforeCash = acc.cash;

    const posRow = prep(
      `SELECT shares, avail_shares, cost, realized FROM positions WHERE user_id=? AND symbol=?`
    ).get(userId, symbol) as { shares: number; avail_shares: number; cost: number; realized: number } | undefined;

    const beforeShares = posRow?.shares ?? 0;
    const beforeAvail = posRow?.avail_shares ?? 0;
    const beforeCost = posRow?.cost ?? 0;
    const beforeRealized = posRow?.realized ?? 0;
    const oldAvgCost = beforeShares > 0 ? beforeCost / beforeShares : 0;

    const targetTotalCost = round2(targetShares * targetCostPrice);
    let realizedPnl = 0;

    // 减仓：把减少的部分以 targetCostPrice 虚拟卖出
    if (targetShares < beforeShares && beforeShares > 0) {
      const reduce = beforeShares - targetShares;
      realizedPnl = round2((targetCostPrice - oldAvgCost) * reduce);
    }

    const newRealized = round2(beforeRealized + realizedPnl);

    // 现金变动
    let cash = beforeCash;
    let netAmount = 0;
    if (syncCash) {
      // 新成本 - 旧成本 = 你"付出"的钱（正数=扣款，负数=补款）
      const delta = round2(targetTotalCost - beforeCost);
      netAmount = delta;
      if (delta > 0 && cash < delta) {
        throw new Error(`同步扣款资金不足：需 ¥${delta.toFixed(2)}，可用 ¥${cash.toFixed(2)}`);
      }
      cash = round2(cash - delta);
    }

    // 写流水（adjust）
    const r = prep(
      `INSERT INTO trades (user_id, ts, side, symbol, code, name, shares, price, amount,
                           commission, stamp_tax, transfer_fee, total_fee, net_amount,
                           realized_pnl, cash_after, note,
                           before_shares, before_cost, before_realized, before_avail, before_cash,
                           sync_cash, reverted)
       VALUES (?, ?, 'adjust', ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      userId, ts, symbol, code, name,
      targetShares, targetCostPrice, targetTotalCost,
      netAmount, realizedPnl, cash, input.note ?? null,
      beforeShares, beforeCost, beforeRealized, beforeAvail, beforeCash,
      syncCash ? 1 : 0,
    );

    // upsert positions：直接覆盖
    prep(
      `INSERT INTO positions (user_id, symbol, code, name, shares, avail_shares, cost, realized, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, symbol) DO UPDATE SET
         shares=excluded.shares,
         avail_shares=excluded.avail_shares,
         cost=excluded.cost,
         realized=excluded.realized,
         name=excluded.name,
         updated_at=excluded.updated_at`
    ).run(
      userId, symbol, code, name,
      targetShares,
      targetShares,             // avail_shares = shares：视为历史持仓立即可卖
      targetTotalCost,
      newRealized,
      ts,
    );

    if (syncCash) {
      prep('UPDATE accounts SET cash=?, updated_at=? WHERE user_id=?').run(cash, ts, userId);
    }

    return {
      id: Number(r.lastInsertRowid),
      ts, side: 'adjust', symbol, code, name,
      shares: targetShares, price: targetCostPrice, amount: targetTotalCost,
      commission: 0, stampTax: 0, transferFee: 0, totalFee: 0,
      netAmount, realizedPnl, cashAfter: cash,
      note: input.note ?? null,
      beforeShares, beforeCost, beforeRealized, beforeAvail, beforeCash,
      syncCash, reverted: false,
    };
  });
}

// ---------------- 撤销（仅 adjust） ----------------

/**
 * 撤销一条 adjust 流水。
 *   - 把持仓还原到 before 快照
 *   - 如果是 syncCash 调账，则把现金还原
 *   - 把 trades.reverted = 1（保留行，便于审计）
 *
 * 限制：只能撤销最近一次该股票的 adjust，且其后该股票不能再有 buy/sell/adjust，
 *      否则状态机会乱。
 */
export function revertTrade(tradeId: number, userId = DEFAULT_USER_ID): { trade: Trade } {
  ensureAccount(userId);
  return withTx(() => {
    const row = prep(
      `SELECT * FROM trades WHERE id=? AND user_id=?`
    ).get(tradeId, userId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('交易不存在');
    if (String(row.side) !== 'adjust') throw new Error('只能撤销手动调账记录');
    if (Number(row.reverted) === 1) throw new Error('该记录已被撤销');

    const symbol = String(row.symbol);
    const ts = Number(row.ts);

    // 保护：检查 ts 之后是否有该股票的其它流水
    const newer = prep(
      `SELECT COUNT(*) AS c FROM trades
        WHERE user_id=? AND symbol=? AND ts > ? AND reverted=0`
    ).get(userId, symbol, ts) as { c: number };
    if (newer.c > 0) throw new Error('该调账之后还有交易，请先处理后续记录');

    const beforeShares = Number(row.before_shares ?? 0);
    const beforeCost = Number(row.before_cost ?? 0);
    const beforeRealized = Number(row.before_realized ?? 0);
    const beforeAvail = Number(row.before_avail ?? 0);
    const beforeCash = Number(row.before_cash ?? 0);
    const syncCash = Number(row.sync_cash ?? 0) === 1;

    // 还原 positions
    const code = String(row.code);
    const name = String(row.name);
    prep(
      `INSERT INTO positions (user_id, symbol, code, name, shares, avail_shares, cost, realized, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, symbol) DO UPDATE SET
         shares=excluded.shares,
         avail_shares=excluded.avail_shares,
         cost=excluded.cost,
         realized=excluded.realized,
         name=excluded.name,
         updated_at=excluded.updated_at`
    ).run(userId, symbol, code, name, beforeShares, beforeAvail, beforeCost, beforeRealized, Date.now());

    // 还原现金
    if (syncCash) {
      prep('UPDATE accounts SET cash=?, updated_at=? WHERE user_id=?').run(beforeCash, Date.now(), userId);
    }

    prep(`UPDATE trades SET reverted=1 WHERE id=?`).run(tradeId);

    return {
      trade: {
        id: tradeId,
        ts: Number(row.ts),
        side: 'adjust',
        symbol, code, name,
        shares: Number(row.shares),
        price: Number(row.price),
        amount: Number(row.amount),
        commission: 0, stampTax: 0, transferFee: 0, totalFee: 0,
        netAmount: Number(row.net_amount),
        realizedPnl: Number(row.realized_pnl),
        cashAfter: beforeCash,
        note: row.note as string | null,
        beforeShares, beforeCost, beforeRealized, beforeAvail, beforeCash,
        syncCash, reverted: true,
      },
    };
  });
}
