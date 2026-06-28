'use client';

import { useEffect, useState, useCallback } from 'react';
import { Star, Trash2, Info, RefreshCw, Inbox } from 'lucide-react';
import { cn, fmt, fmtBig, pnlColor } from '@/lib/utils';
import { useWatchlist, type WatchlistItem } from '@/lib/use-watchlist';
import type { Quote } from './market-view';

// =============================================================================
// WatchlistView —— 自选股
//
// - 来源：localStorage（useWatchlist hook）
// - 价格：/api/quote?code=sh600519,sz000001,... 批量
// - 自动刷新：10s
// - 移动端卡片式 / PC 端表格
// =============================================================================

const REFRESH_MS = 10_000;

type QuoteApiRow = {
  code: string;       // sh600519
  name: string;
  open: number;
  prevClose: number;
  price: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  date: string;
  time: string;
  change: number;
  changePct: number;
};

export type WatchlistViewProps = {
  searchTerm: string;
  onOpenDetail: (q: Quote) => void;
  onJumpMarket: () => void;
};

export default function WatchlistView({ searchTerm, onOpenDetail, onJumpMarket }: WatchlistViewProps) {
  const { list, hydrated, remove, clear } = useWatchlist();

  const [rows, setRows] = useState<Record<string, QuoteApiRow>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');

  const symbols = list.map((i) => i.symbol);
  const symbolKey = symbols.join(',');

  const fetchPrices = useCallback(async () => {
    if (symbols.length === 0) {
      setRows({});
      return;
    }
    try {
      // /api/quote 限制 80 个 / 次，超出分批
      const chunks: string[][] = [];
      for (let i = 0; i < symbols.length; i += 80) {
        chunks.push(symbols.slice(i, i + 80));
      }
      const merged: Record<string, QuoteApiRow> = {};
      for (const ch of chunks) {
        const res = await fetch(`/api/quote?code=${ch.join(',')}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || (json && json.error)) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        if (Array.isArray(json)) {
          for (const r of json as QuoteApiRow[]) {
            if (r && r.code) merged[r.code] = r;
          }
        }
      }
      setRows(merged);
      setError(null);
      setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey]);

  useEffect(() => {
    if (!hydrated) return;
    setLoading(true);
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      await fetchPrices();
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [hydrated, fetchPrices]);

  // SSR 期间 hydrated=false，先占位避免 mismatch
  if (!hydrated) {
    return <div className="text-center text-slate-400 text-sm py-12">加载自选列表…</div>;
  }

  // 空状态
  if (list.length === 0) {
    return (
      <div className="bg-white border border-slate-200/70 rounded-xl shadow-sm p-12 text-center space-y-4">
        <Inbox className="w-14 h-14 mx-auto text-slate-300" strokeWidth={1.5} />
        <div className="space-y-1">
          <p className="text-base font-bold text-slate-700">暂无自选股</p>
          <p className="text-xs text-slate-400">在「行情」页中点击 ⭐ 按钮，把感兴趣的股票加入自选</p>
        </div>
        <button
          onClick={onJumpMarket}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-slate-800 text-white text-sm font-bold hover:bg-slate-900 transition-colors"
        >
          去添加
        </button>
      </div>
    );
  }

  // 应用搜索过滤（支持去前导零、名称、symbol）
  const filtered = searchTerm.trim()
    ? list.filter((i) => {
        const q = searchTerm.trim().toLowerCase();
        if (i.name.toLowerCase().includes(q)) return true;
        if (i.code.includes(q)) return true;
        // 去前导零：7552 ↔ 07552
        const strippedCode = i.code.replace(/^0+/, '');
        const strippedQ = q.replace(/^0+/, '');
        if (strippedCode.includes(strippedQ)) return true;
        if (i.symbol.toLowerCase().includes(q)) return true;
        return false;
      })
    : list;

  // 转 Quote 类型（部分字段缺失就 0）供 Modal 用
  const toQuote = (it: WatchlistItem): Quote => {
    const r = rows[it.symbol];
    return {
      symbol: it.symbol,
      code: it.code,
      name: it.name,
      price: r?.price ?? 0,
      change: r?.change ?? 0,
      changePct: r?.changePct ?? 0,
      open: r?.open ?? 0,
      prevClose: r?.prevClose ?? 0,
      high: r?.high ?? 0,
      low: r?.low ?? 0,
      volume: r?.volume ?? 0,
      amount: r?.amount ?? 0,
      marketCap: 0,
      turnover: 0,
      time: r?.time ?? '',
    };
  };

  // 简易统计：上涨 / 下跌 / 平
  const stat = filtered.reduce(
    (a, it) => {
      const r = rows[it.symbol];
      if (!r) return a;
      if (r.change > 0) a.up++;
      else if (r.change < 0) a.down++;
      else a.flat++;
      return a;
    },
    { up: 0, down: 0, flat: 0 },
  );

  return (
    <div className="space-y-3">
      {/* 头条统计条 */}
      <div className="bg-white rounded-xl border border-slate-200/70 shadow-sm px-4 py-3 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 text-xs">
          <span className="font-bold text-slate-800">
            自选共 <span className="font-mono">{list.length}</span> 只
          </span>
          <span className="text-red-600 font-bold">↑ {stat.up}</span>
          <span className="text-emerald-600 font-bold">↓ {stat.down}</span>
          <span className="text-slate-500 font-bold">— {stat.flat}</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="font-mono">{loading ? '加载中…' : updatedAt && `更新 ${updatedAt}`}</span>
          <button
            onClick={() => { setLoading(true); fetchPrices(); }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 font-bold"
            title="立即刷新"
          >
            <RefreshCw className="w-3 h-3" /> 刷新
          </button>
          <button
            onClick={() => {
              if (confirm('清空全部自选股？')) clear();
            }}
            className="text-slate-400 hover:text-red-600 transition-colors font-bold"
          >
            清空
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs">❌ {error}</div>
      )}

      {/* 移动端：卡片网格；PC：表格 */}
      {/* 卡片视图 - sm 以下 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:hidden gap-2">
        {filtered.map((it) => {
          const r = rows[it.symbol];
          const change = r?.change ?? 0;
          const changePct = r?.changePct ?? 0;
          const price = r?.price ?? 0;
          const colorBg = change > 0 ? 'bg-red-50/60' : change < 0 ? 'bg-emerald-50/60' : 'bg-slate-50/60';
          const colorClass = pnlColor(change);
          return (
            <div
              key={it.symbol}
              className={cn(
                'bg-white border border-slate-200/70 rounded-xl shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow',
                colorBg,
              )}
              onClick={() => onOpenDetail(toQuote(it))}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-black text-sm text-slate-800 truncate">{it.name}</div>
                  <div className="font-mono text-[10px] text-slate-400 mt-0.5">{it.code}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(it.symbol); }}
                  className="text-slate-300 hover:text-red-500 transition-colors p-1 -mr-1 -mt-1"
                  aria-label="移出自选"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <div className={cn('font-mono font-black text-2xl', colorClass)}>
                  {price > 0 ? fmt(price) : '—'}
                </div>
                <div className={cn('font-mono text-xs font-bold', colorClass)}>
                  {price > 0 ? (
                    <>
                      <div>{change > 0 ? '+' : ''}{fmt(change)}</div>
                      <div>{changePct > 0 ? '+' : ''}{fmt(changePct)}%</div>
                    </>
                  ) : (
                    <div className="text-slate-400">无报价</div>
                  )}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-slate-500 border-t border-slate-100 pt-2">
                <div>开 <span className="font-mono text-slate-700">{fmt(r?.open ?? 0)}</span></div>
                <div>高 <span className="font-mono text-red-500/70">{fmt(r?.high ?? 0)}</span></div>
                <div>低 <span className="font-mono text-emerald-500/70">{fmt(r?.low ?? 0)}</span></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 表格视图 - md 以上 */}
      <div className="hidden md:block overflow-x-auto bg-white border border-slate-200/70 rounded-xl shadow-sm">
        <table className="w-full table-auto text-sm">
          <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-widest border-b border-slate-200/70">
            <tr>
              <th className="px-3 py-2 text-left font-bold">名称</th>
              <th className="px-3 py-2 text-left font-bold w-24">代码</th>
              <th className="px-3 py-2 text-right font-bold">现价</th>
              <th className="px-3 py-2 text-right font-bold">涨跌额</th>
              <th className="px-3 py-2 text-right font-bold">涨跌幅</th>
              <th className="px-3 py-2 text-right font-bold hidden lg:table-cell">今开</th>
              <th className="px-3 py-2 text-right font-bold hidden lg:table-cell">最高</th>
              <th className="px-3 py-2 text-right font-bold hidden lg:table-cell">最低</th>
              <th className="px-3 py-2 text-right font-bold hidden xl:table-cell">成交额</th>
              <th className="px-3 py-2 text-center font-bold w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-12 text-center text-slate-400">无匹配项</td></tr>
            )}
            {filtered.map((it) => {
              const r = rows[it.symbol];
              const change = r?.change ?? 0;
              const colorClass = pnlColor(change);
              const has = !!r && r.price > 0;
              return (
                <tr
                  key={it.symbol}
                  className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                  onClick={() => onOpenDetail(toQuote(it))}
                >
                  <td className="px-3 py-2 font-bold whitespace-nowrap text-slate-800 hover:text-blue-600">
                    <div className="flex items-center gap-1.5">
                      <Star className="w-3.5 h-3.5 fill-amber-400 stroke-amber-500" strokeWidth={2} />
                      {it.name}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{it.code}</td>
                  <td className={cn('px-3 py-2 text-right font-mono font-black', colorClass)}>
                    {has ? fmt(r.price) : '—'}
                  </td>
                  <td className={cn('px-3 py-2 text-right font-mono', colorClass)}>
                    {has ? `${change > 0 ? '+' : ''}${fmt(change)}` : '—'}
                  </td>
                  <td className={cn('px-3 py-2 text-right font-mono font-bold', colorClass)}>
                    {has ? `${r.changePct > 0 ? '+' : ''}${fmt(r.changePct)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500 hidden lg:table-cell">{fmt(r?.open ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-500/70 hidden lg:table-cell">{fmt(r?.high ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-500/70 hidden lg:table-cell">{fmt(r?.low ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500 hidden xl:table-cell">{fmtBig(r?.amount ?? 0)}</td>
                  <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onOpenDetail(toQuote(it))}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-blue-200 text-blue-600 hover:bg-blue-50 font-bold mr-1"
                    >
                      <Info className="w-3 h-3" />详情
                    </button>
                    <button
                      onClick={() => remove(it.symbol)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 font-bold"
                    >
                      <Trash2 className="w-3 h-3" />移除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400 px-1">
        ⚠ 自选数据保存在浏览器本地（localStorage）。换浏览器、清缓存会丢失。
      </p>
    </div>
  );
}
