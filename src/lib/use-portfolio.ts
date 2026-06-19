'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

// =============================================================================
// 模拟交易相关 hooks（统一从 /api/portfolio/* 拉数据）
// =============================================================================

export type TradeSide = 'buy' | 'sell' | 'adjust';

export type Settings = {
  commissionRate: number;
  commissionMin: number;
  stampTaxRate: number;
  transferFeeRate: number;
  enableT1: boolean;
};

export type Position = {
  symbol: string;
  code: string;
  name: string;
  shares: number;
  availShares: number;
  costPrice: number;
  cost: number;
  realized: number;
  lastPrice?: number;
  marketValue?: number;
  floatingPnl?: number;
  floatingPnlPct?: number;
  updatedAt: number;
};

export type Account = {
  userId: string;
  cash: number;
  initialCash: number;
  marketValue: number;
  totalAsset: number;
  totalProfit: number;
  totalProfitPct: number;
  realizedPnl: number;
  floatingPnl: number;
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
  // adjust 专用
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

export type FeePreview = {
  amount: number;
  commission: number;
  stampTax: number;
  transferFee: number;
  totalFee: number;
  netAmount: number;
  settings: Settings;
};

// ---------------- 通用 fetcher ----------------

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok || j?.error) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as T;
}
async function jpost<T>(url: string, body: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok || j?.error) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as T;
}

// ---------------- 总览 ----------------

export function usePortfolio(intervalMs = 10_000) {
  const [data, setData] = useState<{ account: Account; positions: Position[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const j = await jget<{ account: Account; positions: Position[] }>('/api/portfolio');
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      void refresh();
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [refresh, intervalMs]);

  return { data, loading, error, refresh };
}

// ---------------- 流水 ----------------

export function useTrades(symbol?: string, limit = 100) {
  const [items, setItems] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const url = symbol
        ? `/api/portfolio/trades?symbol=${symbol}&limit=${limit}`
        : `/api/portfolio/trades?limit=${limit}`;
      const j = await jget<{ items: Trade[] }>(url);
      setItems(j.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { items, loading, error, refresh };
}

export function useCashFlows() {
  const [items, setItems] = useState<CashFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const j = await jget<{ items: CashFlow[] }>('/api/portfolio/cash');
      setItems(j.items);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { items, loading, refresh };
}

export function useSettings() {
  const [data, setData] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const j = await jget<Settings>('/api/portfolio/settings');
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await jpost<Settings>('/api/portfolio/settings', patch, 'PATCH');
    setData(next);
    return next;
  }, []);

  return { data, loading, error, refresh, update };
}

// ---------------- 操作 ----------------

export async function placeTrade(input: {
  side: TradeSide;
  symbol: string;
  code: string;
  name: string;
  shares: number;
  price?: number;
  useLivePrice?: boolean;
  note?: string;
}): Promise<{ trade: Trade; usedLivePrice: boolean }> {
  return jpost('/api/portfolio/trade', input);
}

export async function adjustCash(
  type: 'deposit' | 'withdraw' | 'reset',
  amount: number,
  note?: string,
): Promise<{ cash: number; flow: CashFlow }> {
  return jpost('/api/portfolio/cash', { type, amount, note });
}

export async function adjustPosition(input: {
  symbol: string;
  code: string;
  name: string;
  targetShares: number;
  targetCostPrice: number;
  syncCash?: boolean;
  note?: string;
}): Promise<{ trade: Trade }> {
  return jpost('/api/portfolio/adjust', input);
}

export async function revertTrade(id: number): Promise<{ trade: Trade }> {
  return jpost('/api/portfolio/trades/revert', { id });
}

// ---------------- 费用预估（带防抖） ----------------

export function useFeePreview(
  side: TradeSide,
  symbol: string,
  shares: number,
  price: number,
): { fee: FeePreview | null; loading: boolean; error: string | null } {
  const [fee, setFee] = useState<FeePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!symbol || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0) {
      setFee(null);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const j = await jget<FeePreview>(
          `/api/portfolio/trades?preview=1&side=${side}&symbol=${symbol}&shares=${shares}&price=${price}`,
        );
        if (my !== seq.current) return;
        setFee(j);
        setError(null);
      } catch (e) {
        if (my !== seq.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [side, symbol, shares, price]);

  return { fee, loading, error };
}
