'use client';

import { useEffect, useState, useMemo } from 'react';
import { BarChart3, Target, Clock, ArrowUpRight, ArrowDownRight, TrendingUp, Activity, DollarSign } from 'lucide-react';
import { cn, fmt, pnlColor } from '@/lib/utils';

// =============================================================================
// TradeStatsPanel — 交易统计面板（买卖量 / 频率 / 盈亏分布 / 个股活跃度）
//
// 数据源：/api/portfolio/stats
// 支持 range=7/30/90/all 切换
// =============================================================================

const RANGES = [
  { key: '7',  label: '7 天' },
  { key: '30', label: '30 天' },
  { key: '90', label: '90 天' },
  { key: 'all',label: '全部' },
] as const;

type StatsResp = {
  rangeDays: number | null;
  summary: {
    totalTrades: number;
    buyCount: number;
    sellCount: number;
    buyShares: number;
    sellShares: number;
    buyAmount: number;
    sellAmount: number;
    totalFees: number;
    totalRealized: number;
    avgWinLoss: number;
    winCount: number;
    lossCount: number;
    winRate: number | null;
  };
  fees: {
    total_commission: number;
    total_stamp: number;
    total_transfer: number;
    grand_total: number;
  };
  dailyTrades: Array<{
    date: string;
    buy_count: number;
    sell_count: number;
    buy_amount: number;
    sell_amount: number;
    realized_pnl: number;
  }>;
  topSymbols: Array<{
    symbol: string;
    name: string;
    trades: number;
    buy_amount: number;
    sell_amount: number;
    sell_shares: number;
    realized_pnl: number;
  }>;
  recentTrades: Array<{
    id: number;
    ts: number;
    side: string;
    symbol: string;
    name: string;
    shares: number;
    price: number;
    amount: number;
    total_fee: number;
    realized_pnl: number;
  }>;
};

export default function TradeStatsPanel() {
  const [range, setRange] = useState<string>('90');
  const [data, setData] = useState<StatsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/portfolio/stats?range=${range}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) {
          if (j.error) setErr(j.error);
          else setData(j);
        }
      })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  const s = data?.summary;
  const daily = data?.dailyTrades ?? [];
  const top = data?.topSymbols ?? [];

  // 每日最大交易量（用于柱状图比例）
  const dailyMaxCount = useMemo(() => {
    let mx = 0;
    for (const d of daily) {
      const total = d.buy_count + d.sell_count;
      if (total > mx) mx = total;
    }
    return mx || 1;
  }, [daily]);

  if (loading && !data) {
    return (
      <div className="py-8 text-center text-slate-400 text-xs animate-pulse">
        <BarChart3 className="w-5 h-5 mx-auto mb-2" /> 加载统计…
      </div>
    );
  }

  if (err) {
    return (
      <div className="py-3 px-3 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
        ❌ 加载失败: {err}
      </div>
    );
  }

  if (!s || s.totalTrades === 0) {
    return (
      <div className="py-10 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-md">
        <BarChart3 className="w-6 h-6 mx-auto mb-2 opacity-40" />
        暂无交易记录<br />
        <span className="text-[11px]">完成第一笔买卖后，统计数据将在此展示</span>
      </div>
    );
  }

  // -------- 渲染 --------
  const done = s.winCount + s.lossCount;

  return (
    <div className="space-y-4 text-xs">
      {/* 时间范围选择 */}
      <div className="flex items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={cn(
              'px-2.5 py-1 rounded text-[11px] font-bold border transition-colors',
              range === r.key
                ? 'bg-slate-800 text-white border-slate-800'
                : 'text-slate-500 border-slate-200 hover:bg-slate-50',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ===== 摘要卡片 ===== */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MiniCard icon={Activity} label="总交易" value={`${s.totalTrades} 笔`} sub={`买${s.buyCount} / 卖${s.sellCount}`} />
        <MiniCard
          icon={s.buyAmount >= s.sellAmount ? ArrowUpRight : ArrowDownRight}
          label="累计买/卖"
          value={`¥${(s.buyAmount / 1e4).toFixed(1)}万 / ¥${(s.sellAmount / 1e4).toFixed(1)}万`}
          sub={`${((s.buyShares + s.sellShares) / 100).toFixed(0)} 手`}
        />
        <MiniCard
          icon={Target}
          label="胜率"
          value={s.winRate !== null ? `${s.winRate}%` : '—'}
          sub={done > 0 ? `${s.winCount}赢 / ${s.lossCount}亏` : '暂无卖出'}
          colorClass={s.winRate !== null && s.winRate >= 50 ? 'text-emerald-600' : 'text-red-500'}
        />
        <MiniCard
          icon={TrendingUp}
          label="已实现盈亏"
          value={`${s.totalRealized >= 0 ? '+' : ''}¥${s.totalRealized.toLocaleString()}`}
          sub={done > 0 ? `均笔 ¥${fmt(Math.abs(s.avgWinLoss), 0)}` : '—'}
          colorClass={pnlColor(s.totalRealized)}
        />
      </div>

      {/* ===== 费率构成 ===== */}
      {data?.fees && data.fees.grand_total > 0 && (
        <div className="border border-slate-200/70 rounded-md p-3 bg-slate-50/50">
          <div className="flex items-center gap-1.5 text-[10px] font-black tracking-wider text-slate-400 uppercase mb-2">
            <DollarSign className="w-3 h-3" /> 费用构成
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px]">
            <span>佣金 <b className="text-slate-700">¥{data.fees.total_commission}</b></span>
            <span>印花税 <b className="text-slate-700">¥{data.fees.total_stamp}</b></span>
            <span>过户费 <b className="text-slate-700">¥{data.fees.total_transfer}</b></span>
            <span className="text-slate-400">合计 <b className="text-slate-700">¥{data.fees.grand_total}</b></span>
          </div>
        </div>
      )}

      {/* ===== 每日交易频率柱状图 ===== */}
      {daily.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-black tracking-wider text-slate-400 uppercase mb-2">
            <Clock className="w-3 h-3" /> 每日交易频率
          </div>
          <div className="flex items-end gap-[2px] h-20 bg-slate-50/50 rounded-md p-2 overflow-x-auto">
            {daily.slice(0, 60).reverse().map((d) => {
              const total = d.buy_count + d.sell_count;
              const h = Math.max(4, (total / dailyMaxCount) * 100);
              return (
                <div key={d.date} className="flex flex-col items-center gap-0.5 shrink-0" style={{ width: 'calc(100% / 30)' }}>
                  <span className="text-[8px] text-slate-400 leading-none">{total}</span>
                  <div style={{ height: `${h}%`, width: '100%', maxWidth: 18 }}>
                    <div style={{ height: `${(d.buy_count / (total || 1)) * 100}%` }} className="rounded-t-sm bg-red-500" />
                    <div style={{ height: `${(d.sell_count / (total || 1)) * 100}%` }} className="rounded-b-sm bg-emerald-500" />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[9px] text-slate-400">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-500" /> 买入</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500" /> 卖出</span>
          </div>
        </div>
      )}

      {/* ===== 最活跃股票排行 ===== */}
      {top.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-black tracking-wider text-slate-400 uppercase mb-2">
            <BarChart3 className="w-3 h-3" /> 持仓活跃度
          </div>
          <div className="space-y-1">
            {top.map((t, idx) => (
              <div key={t.symbol} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 border border-slate-100">
                <span className="text-[10px] text-slate-400 font-mono w-4">{idx + 1}</span>
                <span className="font-bold text-slate-700 truncate flex-1">{t.name}</span>
                <span className="font-mono text-[11px] text-slate-500">{t.trades} 笔</span>
                <span className={cn('font-mono text-[11px] font-bold', pnlColor(t.realized_pnl))}>
                  {t.realized_pnl !== 0 ? `${t.realized_pnl >= 0 ? '+' : ''}${fmt(t.realized_pnl)}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== 最近交易 ===== */}
      {data?.recentTrades && data.recentTrades.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-black tracking-wider text-slate-400 uppercase mb-2">
            <Activity className="w-3 h-3" /> 最近交易
          </div>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[11px]">
              <thead className="text-[9px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-2 py-1 text-left font-bold">日期</th>
                  <th className="px-2 py-1 text-left font-bold">股票</th>
                  <th className="px-2 py-1 text-left font-bold">方向</th>
                  <th className="px-2 py-1 text-right font-bold">股数</th>
                  <th className="px-2 py-1 text-right font-bold">金额</th>
                  <th className="px-2 py-1 text-right font-bold hidden sm:table-cell">盈亏</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.recentTrades.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-2 py-1 text-slate-500 whitespace-nowrap">{t.ts ? new Date(t.ts).toLocaleDateString('zh-CN').slice(5) : ''}</td>
                    <td className="px-2 py-1 text-slate-700 font-bold truncate max-w-[80px]">{t.name}</td>
                    <td className={cn(
                      'px-2 py-1 font-bold',
                      t.side === 'buy' ? 'text-red-600' : 'text-emerald-600',
                    )}>
                      {t.side === 'buy' ? '买' : '卖'}
                    </td>
                    <td className="px-2 py-1 text-right">{t.shares}</td>
                    <td className="px-2 py-1 text-right">¥{t.amount.toLocaleString()}</td>
                    <td className={cn(
                      'px-2 py-1 text-right font-bold hidden sm:table-cell',
                      pnlColor(t.realized_pnl),
                    )}>
                      {t.side === 'sell' ? `${t.realized_pnl >= 0 ? '+' : ''}${fmt(t.realized_pnl)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// 小卡片辅助
function MiniCard({
  icon: Icon, label, value, sub, colorClass,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  colorClass?: string;
}) {
  return (
    <div className="border border-slate-200/70 rounded-md p-2.5 bg-white">
      <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold tracking-wider uppercase mb-1">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className={cn('font-mono font-black text-sm', colorClass ?? 'text-slate-800')}>{value}</div>
      <div className="text-[10px] text-slate-400 font-mono mt-0.5">{sub}</div>
    </div>
  );
}
