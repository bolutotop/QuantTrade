'use client';

import { useEffect, useState, useCallback } from 'react';
import { Star, ArrowUpDown, ArrowDown, ArrowUp } from 'lucide-react';
import { cn, fmt, fmtBig, pnlColor } from '@/lib/utils';
import { useWatchlist, type WatchlistItem } from '@/lib/use-watchlist';

// =============================================================================
// MarketView —— A 股全市场实时行情列表
//
// 与之前 page.tsx 里塞在一起的逻辑相同，独立出来作为一个 view 模块。
// =============================================================================

export type SortKey = 'changepercent' | 'trade' | 'amount' | 'volume' | 'turnoverratio' | 'mktcap';
export type NodeKey =
  | 'hs_a' | 'sh_a' | 'sz_a' | 'bj_a' | 'hs_kcb' | 'hs_cyb' | 'new_cb'
  | 'hk_all' | 'hk_main' | 'hk_gem' | 'hk_blue' | 'hk_red' | 'hk_h';

export type Quote = {
  symbol: string;
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  prevClose: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  marketCap: number;
  turnover: number;
  time: string;
};

type RankResp = {
  node: NodeKey;
  sort: SortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
  items: Quote[];
  error?: string;
};

const REFRESH_MS = 10_000;
const PAGE_SIZE = 50;

const NODE_LABELS: Record<NodeKey, string> = {
  hs_a: '沪深 A',
  sh_a: '沪市 A',
  sz_a: '深市 A',
  bj_a: '北交所',
  hs_kcb: '科创板',
  hs_cyb: '创业板',
  new_cb: '可转债',
  hk_all: '港股',
  hk_main: '港主板',
  hk_blue: '港蓝筹',
  hk_red: '港红筹',
  hk_h: 'H 股',
  hk_gem: '港 GEM',
};

const SORT_LABELS: Record<SortKey, string> = {
  changepercent: '涨跌幅',
  trade: '现价',
  amount: '成交额',
  volume: '成交量',
  turnoverratio: '换手率',
  mktcap: '总市值',
};

export type MarketViewProps = {
  searchTerm: string;
  onOpenDetail: (q: Quote) => void;
  /** 顶部右上的更新时间显示给外层 header 用 */
  onUpdatedAtChange?: (s: string) => void;
};

export default function MarketView({ searchTerm, onOpenDetail, onUpdatedAtChange }: MarketViewProps) {
  const [node, setNode] = useState<NodeKey>('hs_a');
  const [sort, setSort] = useState<SortKey>('changepercent');
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RankResp | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAuto] = useState(true);

  const { has: isStarred, toggle: toggleStar } = useWatchlist();

  // 拉总数
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/total?node=${node}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setTotal(j.total ?? 0); })
      .catch(() => { if (!cancelled) setTotal(0); });
    return () => { cancelled = true; };
  }, [node]);

  const fetchData = useCallback(async () => {
    try {
      const url = `/api/rank?node=${node}&sort=${sort}&order=${order}&page=${page}&pageSize=${PAGE_SIZE}`;
      const res = await fetch(url, { cache: 'no-store' });
      const json: RankResp = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || `HTTP ${res.status}`);
      } else {
        setData(json);
        setError(null);
        const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        onUpdatedAtChange?.(ts);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [node, sort, order, page, onUpdatedAtChange]);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      await fetchData();
    };
    tick();
    if (!autoRefresh) return () => { cancelled = true; };
    const id = setInterval(tick, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [autoRefresh, fetchData]);

  const items = data?.items ?? [];
  const totalPg = total > 0 ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;
  const filtered = searchTerm.trim()
    ? items.filter((it) => {
        const q = searchTerm.trim().toLowerCase();
        // 名称模糊
        if (it.name.toLowerCase().includes(q)) return true;
        // 代码精确
        if (it.code.includes(q)) return true;
        // 代码去前导零再比（港股：7552 ↔ 07552，A股：601 → 600601）
        const strippedCode = it.code.replace(/^0+/, '');
        const strippedQ = q.replace(/^0+/, '');
        if (strippedCode.includes(strippedQ)) return true;
        // symbol 带前缀（sh600519 / hk09626）
        if (it.symbol && it.symbol.toLowerCase().includes(q)) return true;
        return false;
      })
    : items;

  const switchNode = (n: NodeKey) => { setNode(n); setPage(1); };
  const switchSort = (s: SortKey) => {
    if (sort === s) setOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
    else { setSort(s); setOrder('desc'); }
    setPage(1);
  };

  const onStar = (e: React.MouseEvent, q: Quote) => {
    e.stopPropagation();
    const item: Omit<WatchlistItem, 'addedAt'> = { symbol: q.symbol, code: q.code, name: q.name };
    toggleStar(item);
  };

  return (
    <div className="space-y-3">
      {/* 控件区：板块 + 排序 + 自动刷新 */}
      <div className="bg-white rounded-xl border border-slate-200/70 p-3 shadow-sm space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(NODE_LABELS) as NodeKey[]).map((n) => (
            <button
              key={n}
              onClick={() => switchNode(n)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-bold tracking-wider transition-colors',
                node === n
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {NODE_LABELS[n]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(SORT_LABELS) as SortKey[]).map((s) => {
            const active = sort === s;
            const Icon = active ? (order === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown;
            return (
              <button
                key={s}
                onClick={() => switchSort(s)}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-colors',
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                {SORT_LABELS[s]}
                <Icon className={cn('w-3 h-3', active ? 'opacity-100' : 'opacity-40')} strokeWidth={3} />
              </button>
            );
          })}
          <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAuto(e.target.checked)}
                className="accent-blue-600"
              />
              10s 自动刷新
            </label>
          </span>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs">❌ {error}</div>
      )}

      {/* 表格 */}
      <div className="overflow-x-auto bg-white border border-slate-200/70 rounded-xl shadow-sm">
        <table className="w-full table-auto text-sm">
          <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-widest border-b border-slate-200/70">
            <tr>
              <th className="px-3 py-2 text-center font-bold w-10">★</th>
              <th className="px-3 py-2 text-left font-bold w-10 hidden sm:table-cell">#</th>
              <th className="px-3 py-2 text-left font-bold">名称</th>
              <th className="px-3 py-2 text-left font-bold w-24 hidden sm:table-cell">代码</th>
              <th className="px-3 py-2 text-right font-bold">现价</th>
              <th className="px-3 py-2 text-right font-bold">涨跌额</th>
              <th className="px-3 py-2 text-right font-bold">涨跌幅</th>
              <th className="px-3 py-2 text-right font-bold hidden md:table-cell">今开</th>
              <th className="px-3 py-2 text-right font-bold hidden md:table-cell">昨收</th>
              <th className="px-3 py-2 text-right font-bold hidden lg:table-cell">最高</th>
              <th className="px-3 py-2 text-right font-bold hidden lg:table-cell">最低</th>
              <th className="px-3 py-2 text-right font-bold hidden xl:table-cell">成交额</th>
              <th className="px-3 py-2 text-right font-bold hidden xl:table-cell">换手率</th>
              <th className="px-3 py-2 text-right font-bold hidden 2xl:table-cell">总市值</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && !error && (
              <tr><td colSpan={14} className="px-3 py-12 text-center text-slate-400">无数据</td></tr>
            )}
            {filtered.map((q, i) => {
              const colorClass = pnlColor(q.change);
              const rank = (page - 1) * PAGE_SIZE + i + 1;
              const starred = isStarred(q.symbol);
              return (
                <tr
                  key={q.symbol}
                  className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                  onClick={() => onOpenDetail(q)}
                >
                  <td className="px-3 py-1.5 text-center" onClick={(e) => onStar(e, q)}>
                    <Star
                      className={cn(
                        'w-4 h-4 mx-auto transition-colors',
                        starred ? 'fill-amber-400 stroke-amber-500' : 'stroke-slate-300 hover:stroke-amber-400',
                      )}
                      strokeWidth={2}
                    />
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-400 hidden sm:table-cell">{rank}</td>
                  <td className="px-3 py-1.5 font-bold whitespace-nowrap text-slate-800 hover:text-blue-600">{q.name}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500 hidden sm:table-cell">{q.code}</td>
                  <td className={cn('px-3 py-1.5 text-right font-mono font-black', colorClass)}>{fmt(q.price)}</td>
                  <td className={cn('px-3 py-1.5 text-right font-mono', colorClass)}>
                    {q.change > 0 ? '+' : ''}{fmt(q.change)}
                  </td>
                  <td className={cn('px-3 py-1.5 text-right font-mono font-bold', colorClass)}>
                    {q.changePct > 0 ? '+' : ''}{fmt(q.changePct)}%
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500 hidden md:table-cell">{fmt(q.open)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-400 hidden md:table-cell">{fmt(q.prevClose)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-red-500/70 hidden lg:table-cell">{fmt(q.high)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-500/70 hidden lg:table-cell">{fmt(q.low)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500 hidden xl:table-cell">{fmtBig(q.amount)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500 hidden xl:table-cell">{fmt(q.turnover)}%</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500 hidden 2xl:table-cell">{fmtBig(q.marketCap)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div className="flex items-center justify-between text-xs flex-wrap gap-2 px-1">
        <span className="text-slate-500">
          第 <span className="font-mono font-bold text-slate-700">{page}</span> / {totalPg} 页 ·
          共 <span className="font-mono font-bold text-slate-700">{total.toLocaleString()}</span> 只 ·
          当前显示 {filtered.length} 条
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(1)} disabled={page <= 1} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 font-bold">首页</button>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 font-bold">上一页</button>
          <button onClick={() => setPage((p) => Math.min(totalPg, p + 1))} disabled={page >= totalPg} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 font-bold">下一页</button>
          <button onClick={() => setPage(totalPg)} disabled={page >= totalPg} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 font-bold">末页</button>
          <input
            type="number"
            min={1}
            max={totalPg}
            defaultValue={page}
            key={page}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (Number.isFinite(v) && v >= 1 && v <= totalPg) setPage(v);
              }
            }}
            className="ml-2 w-14 px-1 py-1 rounded border border-slate-200 text-center font-mono"
            title="输入页码 + Enter 跳转"
          />
        </div>
      </div>
    </div>
  );
}
