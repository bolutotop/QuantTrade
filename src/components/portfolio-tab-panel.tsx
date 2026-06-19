'use client';

import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Wallet, History as HistoryIcon, Edit3 } from 'lucide-react';
import { cn, fmt, pnlColor } from '@/lib/utils';
import { usePortfolio, useTrades } from '@/lib/use-portfolio';
import TradeDialog from './trade-dialog';
import AdjustDialog from './adjust-dialog';

// =============================================================================
// PortfolioTabPanel —— 在 BasicInfoModal 中嵌入的"交易/持仓"Tab
//
// 功能：
//   - 显示该股票当前持仓（股数 / 可卖 / 成本 / 浮盈）
//   - 一键买入 / 卖出 → 弹 TradeDialog
//   - 列出该股票最近 30 笔自家交易流水
// =============================================================================

export type PortfolioTabPanelProps = {
  symbol: string;
  code: string;
  name: string;
  livePrice?: number;
};

export default function PortfolioTabPanel({ symbol, code, name, livePrice }: PortfolioTabPanelProps) {
  const { data, refresh } = usePortfolio();
  const { items: trades, refresh: refreshTrades } = useTrades(symbol, 50);

  const [dialog, setDialog] = useState<null | 'buy' | 'sell'>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const pos = useMemo(
    () => data?.positions.find((p) => p.symbol === symbol),
    [data, symbol],
  );

  const cashAvail = data?.account.cash ?? 0;
  const posShares = pos?.shares ?? 0;
  const posAvail = pos?.availShares ?? 0;
  const costPrice = pos?.costPrice ?? 0;
  const cost = pos?.cost ?? 0;
  const mv = pos?.marketValue ?? (livePrice && posShares ? livePrice * posShares : 0);
  const floating = mv && cost ? +(mv - cost).toFixed(2) : 0;
  const floatingPct = cost > 0 ? +((floating / cost) * 100).toFixed(2) : 0;

  return (
    <div className="space-y-4">
      {/* 持仓概览卡 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Stat label="持仓" value={posShares ? `${posShares} 股` : '—'} hint={posShares ? `${posShares / 100} 手` : undefined} />
        <Stat label="可卖" value={posAvail ? `${posAvail} 股` : '—'} hint={posShares > posAvail ? `T+1 锁定 ${posShares - posAvail}` : undefined} />
        <Stat label="成本价" value={costPrice ? `¥${fmt(costPrice)}` : '—'} hint={cost ? `成本 ¥${cost.toLocaleString()}` : undefined} />
        <Stat
          label="浮动盈亏"
          value={posShares > 0 ? `${floating >= 0 ? '+' : ''}¥${floating.toLocaleString()}` : '—'}
          hint={posShares > 0 ? `${floatingPct >= 0 ? '+' : ''}${fmt(floatingPct)}%` : undefined}
          colorClass={posShares > 0 ? pnlColor(floating) : undefined}
        />
      </div>

      {/* 操作按钮 */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => setDialog('buy')}
          className="inline-flex items-center justify-center gap-1.5 h-11 rounded-md bg-red-600 hover:bg-red-700 text-white font-bold text-sm transition-colors"
        >
          <TrendingUp className="w-4 h-4" /> 买入
        </button>
        <button
          onClick={() => setDialog('sell')}
          disabled={posAvail < 100}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 h-11 rounded-md text-white font-bold text-sm transition-colors',
            posAvail >= 100
              ? 'bg-emerald-600 hover:bg-emerald-700'
              : 'bg-slate-300 cursor-not-allowed',
          )}
        >
          <TrendingDown className="w-4 h-4" />
          {posAvail >= 100 ? '卖出' : posShares > 0 ? '卖出 (T+1 锁定)' : '卖出'}
        </button>
        <button
          onClick={() => setAdjustOpen(true)}
          className="inline-flex items-center justify-center gap-1.5 h-11 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 font-bold text-sm transition-colors"
          title="同步外部软件的真实持仓 / 校准成本价"
        >
          <Edit3 className="w-4 h-4" /> 调账
        </button>
      </div>

      {/* 现金 + 资产小条 */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
        <span className="inline-flex items-center gap-1">
          <Wallet className="w-3 h-3" />
          现金 <span className="font-mono text-slate-700 font-bold">¥{cashAvail.toLocaleString()}</span>
        </span>
        {data?.account && (
          <span>
            总资产 <span className="font-mono text-slate-700 font-bold">¥{data.account.totalAsset.toLocaleString()}</span>
            <span className={cn('ml-2 font-mono', pnlColor(data.account.totalProfit))}>
              {data.account.totalProfit >= 0 ? '+' : ''}{fmt(data.account.totalProfitPct)}%
            </span>
          </span>
        )}
      </div>

      {/* 该股票交易流水 */}
      <div>
        <h4 className="text-[11px] font-black tracking-widest text-slate-400 uppercase mb-2 inline-flex items-center gap-1">
          <HistoryIcon className="w-3 h-3" /> 我的交易（{symbol}）
        </h4>
        {trades.length === 0 ? (
          <div className="py-6 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-md">
            尚无交易记录
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-2 py-1 text-left font-bold">时间</th>
                  <th className="px-2 py-1 text-left font-bold">方向</th>
                  <th className="px-2 py-1 text-right font-bold">股数</th>
                  <th className="px-2 py-1 text-right font-bold">价格</th>
                  <th className="px-2 py-1 text-right font-bold">费用</th>
                  <th className="px-2 py-1 text-right font-bold">净额</th>
                  <th className="px-2 py-1 text-right font-bold hidden sm:table-cell">已实现</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {trades.map((t) => {
                  const isBuy = t.side === 'buy';
                  const isAdj = t.side === 'adjust';
                  return (
                    <tr key={t.id} className={cn('border-t border-slate-100', t.reverted && 'opacity-40 line-through')}>
                      <td className="px-2 py-1 text-slate-500 whitespace-nowrap">
                        {new Date(t.ts).toLocaleString('zh-CN', { hour12: false }).replace(/\/\d{4}/, (m) => m.slice(1))}
                      </td>
                      <td className={cn(
                        'px-2 py-1 font-bold',
                        isAdj ? 'text-blue-600' : isBuy ? 'text-red-600' : 'text-emerald-600',
                      )}>
                        {isAdj ? '调' : isBuy ? '买' : '卖'}
                      </td>
                      <td className="px-2 py-1 text-right">{t.shares}</td>
                      <td className="px-2 py-1 text-right">{fmt(t.price)}</td>
                      <td className="px-2 py-1 text-right text-slate-500">{isAdj ? '—' : fmt(t.totalFee)}</td>
                      <td className="px-2 py-1 text-right font-bold">
                        {isAdj && !t.syncCash ? '—' : fmt(t.netAmount)}
                      </td>
                      <td className={cn(
                        'px-2 py-1 text-right hidden sm:table-cell',
                        pnlColor(t.realizedPnl),
                      )}>
                        {(t.side === 'sell' || (isAdj && t.realizedPnl !== 0))
                          ? `${t.realizedPnl >= 0 ? '+' : ''}${fmt(t.realizedPnl)}`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TradeDialog
        open={!!dialog}
        side={dialog ?? 'buy'}
        symbol={symbol}
        code={code}
        name={name}
        livePrice={livePrice ?? pos?.lastPrice}
        cashAvail={cashAvail}
        posAvail={posAvail}
        onClose={() => setDialog(null)}
        onDone={() => { void refresh(); void refreshTrades(); }}
      />

      <AdjustDialog
        open={adjustOpen}
        symbol={symbol}
        code={code}
        name={name}
        curShares={posShares}
        curCostPrice={costPrice}
        curAvail={posAvail}
        cashAvail={cashAvail}
        onClose={() => setAdjustOpen(false)}
        onDone={() => { void refresh(); void refreshTrades(); }}
      />
    </div>
  );
}

function Stat({ label, value, hint, colorClass }: { label: string; value: string; hint?: string; colorClass?: string }) {
  return (
    <div className="border border-slate-200/70 rounded-md p-2 bg-white">
      <div className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">{label}</div>
      <div className={cn('mt-0.5 font-mono font-black text-base', colorClass ?? 'text-slate-800')}>{value}</div>
      {hint && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{hint}</div>}
    </div>
  );
}
