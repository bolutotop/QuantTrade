'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Wallet, RefreshCw, Settings as SettingsIcon, History as HistoryIcon, TrendingUp, TrendingDown, AlertTriangle, Edit3, Undo2 } from 'lucide-react';
import { cn, fmt, pnlColor } from '@/lib/utils';
import {
  usePortfolio,
  useTrades,
  useCashFlows,
  useSettings,
  adjustCash,
  revertTrade,
  type Position,
} from '@/lib/use-portfolio';
import TradeDialog from '@/components/trade-dialog';
import AdjustDialog from '@/components/adjust-dialog';

// =============================================================================
// /portfolio —— 完整的"我的持仓"主页面
//
// 模块：
//   1. 顶部资产概览：总资产 / 持仓市值 / 现金 / 总盈亏（今日 + 累计）
//   2. 持仓表：每行可买入/卖出
//   3. 设置抽屉：费率/T+1 等可调
//   4. 交易流水
//   5. 资金流水（入金/出金/重置）
// =============================================================================

type SubTab = 'positions' | 'trades' | 'cash' | 'settings';

const SUB_TABS: Array<{ key: SubTab; label: string; icon: typeof Wallet }> = [
  { key: 'positions', label: '持仓', icon: Wallet },
  { key: 'trades', label: '交易流水', icon: HistoryIcon },
  { key: 'cash', label: '资金流水', icon: HistoryIcon },
  { key: 'settings', label: '账户设置', icon: SettingsIcon },
];

export default function PortfolioPage() {
  const { data, loading, error, refresh } = usePortfolio(10_000);
  const [tab, setTab] = useState<SubTab>('positions');
  const [tradeDialog, setTradeDialog] = useState<null | {
    side: 'buy' | 'sell';
    symbol: string;
    code: string;
    name: string;
    livePrice?: number;
    cashAvail?: number;
    posAvail?: number;
  }>(null);
  const [adjustDialog, setAdjustDialog] = useState<null | {
    symbol: string;
    code: string;
    name: string;
    curShares: number;
    curCostPrice: number;
    curAvail: number;
  }>(null);

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* 顶栏 */}
      <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm font-bold"
          >
            <ArrowLeft className="w-4 h-4" /> 返回
          </Link>
          <h1 className="text-lg font-black tracking-tight text-slate-800">我的持仓</h1>
          <span className="ml-auto text-[11px] text-slate-400 font-mono">
            {data?.account.updatedAt
              ? new Date(data.account.updatedAt).toLocaleString('zh-CN', { hour12: false })
              : ''}
          </span>
          <button
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-xs font-bold"
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} /> 刷新
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 space-y-5">
        {/* 风险提示 */}
        <div className="bg-amber-50/80 border border-amber-200 rounded-lg px-3 py-2 text-[12px] text-amber-800 leading-relaxed inline-flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            <strong>模拟交易</strong>，所有资金、持仓、盈亏均为<strong>虚拟数据</strong>，按 A 股惯例计算手续费，
            不构成投资建议。当前数据保存在<strong>服务器本地</strong> SQLite 文件 (<code className="font-mono">.data/portfolio.db</code>)。
          </p>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs">❌ {error}</div>
        )}

        {/* 资产概览 */}
        <AccountSummary loading={loading} data={data} />

        {/* 子 Tab */}
        <div className="border-b border-slate-200/70 flex items-center gap-1 overflow-x-auto">
          {SUB_TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors',
                  active ? 'text-blue-600 border-blue-600' : 'text-slate-500 border-transparent hover:text-slate-800',
                )}
              >
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'positions' && (
          <PositionsTable
            positions={data?.positions ?? []}
            cashAvail={data?.account.cash ?? 0}
            onTrade={(side, p) => setTradeDialog({
              side,
              symbol: p.symbol,
              code: p.code,
              name: p.name,
              livePrice: p.lastPrice,
              cashAvail: data?.account.cash,
              posAvail: p.availShares,
            })}
            onAdjust={(p) => setAdjustDialog({
              symbol: p.symbol,
              code: p.code,
              name: p.name,
              curShares: p.shares,
              curCostPrice: p.costPrice,
              curAvail: p.availShares,
            })}
            onRefresh={() => void refresh()}
          />
        )}
        {tab === 'trades' && <TradesTable />}
        {tab === 'cash' && <CashTable onChange={() => void refresh()} cashAvail={data?.account.cash ?? 0} />}
        {tab === 'settings' && <SettingsForm />}

        {tradeDialog && (
          <TradeDialog
            open
            side={tradeDialog.side}
            symbol={tradeDialog.symbol}
            code={tradeDialog.code}
            name={tradeDialog.name}
            livePrice={tradeDialog.livePrice}
            cashAvail={tradeDialog.cashAvail}
            posAvail={tradeDialog.posAvail}
            onClose={() => setTradeDialog(null)}
            onDone={() => void refresh()}
          />
        )}
        {adjustDialog && (
          <AdjustDialog
            open
            symbol={adjustDialog.symbol}
            code={adjustDialog.code}
            name={adjustDialog.name}
            curShares={adjustDialog.curShares}
            curCostPrice={adjustDialog.curCostPrice}
            curAvail={adjustDialog.curAvail}
            cashAvail={data?.account.cash ?? 0}
            onClose={() => setAdjustDialog(null)}
            onDone={() => void refresh()}
          />
        )}
      </main>
    </div>
  );
}

// -------------------------- 子组件 --------------------------

function AccountSummary({ data, loading }: { data: ReturnType<typeof usePortfolio>['data']; loading: boolean }) {
  if (!data) {
    return (
      <div className="bg-white border border-slate-200/70 rounded-xl p-6 text-center text-slate-400 text-sm">
        {loading ? '加载中…' : '暂无账户数据'}
      </div>
    );
  }
  const a = data.account;
  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-xl p-5 shadow-md">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-400 font-bold tracking-widest uppercase">总资产</div>
          <div className="font-mono font-black text-3xl mt-1">¥{a.totalAsset.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div className={cn(
            'text-sm font-mono font-bold mt-1',
            a.totalProfit >= 0 ? 'text-red-400' : 'text-emerald-400',
          )}>
            {a.totalProfit >= 0 ? '+' : ''}¥{a.totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            <span className="ml-2">({a.totalProfitPct >= 0 ? '+' : ''}{fmt(a.totalProfitPct)}%)</span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs flex-1 max-w-3xl">
          <Mini label="现金" value={`¥${a.cash.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
          <Mini label="持仓市值" value={`¥${a.marketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
          <Mini label="浮动盈亏" value={`${a.floatingPnl >= 0 ? '+' : ''}¥${a.floatingPnl.toLocaleString()}`} colorClass={a.floatingPnl >= 0 ? 'text-red-400' : 'text-emerald-400'} />
          <Mini label="已实现" value={`${a.realizedPnl >= 0 ? '+' : ''}¥${a.realizedPnl.toLocaleString()}`} colorClass={a.realizedPnl >= 0 ? 'text-red-400' : 'text-emerald-400'} />
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">{label}</div>
      <div className={cn('font-mono font-bold mt-0.5 text-sm', colorClass ?? 'text-white')}>{value}</div>
    </div>
  );
}

function PositionsTable({
  positions, cashAvail, onTrade, onAdjust, onRefresh,
}: {
  positions: Position[];
  cashAvail: number;
  onTrade: (side: 'buy' | 'sell', p: Position) => void;
  onAdjust: (p: Position) => void;
  onRefresh: () => void;
}) {
  if (positions.length === 0) {
    return (
      <div className="bg-white border border-slate-200/70 rounded-xl p-10 text-center space-y-2">
        <Wallet className="w-12 h-12 mx-auto text-slate-300" strokeWidth={1.5} />
        <p className="font-bold text-slate-600">暂无持仓</p>
        <p className="text-xs text-slate-400">在『行情』或『自选』里点开个股，进入「交易·持仓」Tab 即可下单或调账</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto bg-white border border-slate-200/70 rounded-xl shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-widest border-b border-slate-200/70">
          <tr>
            <th className="px-3 py-2 text-left font-bold">名称</th>
            <th className="px-3 py-2 text-right font-bold">持仓 / 可卖</th>
            <th className="px-3 py-2 text-right font-bold">成本价</th>
            <th className="px-3 py-2 text-right font-bold">现价</th>
            <th className="px-3 py-2 text-right font-bold">市值</th>
            <th className="px-3 py-2 text-right font-bold">浮动盈亏</th>
            <th className="px-3 py-2 text-right font-bold hidden lg:table-cell">已实现</th>
            <th className="px-3 py-2 text-center font-bold w-32">操作</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const f = p.floatingPnl ?? 0;
            const fp = p.floatingPnlPct ?? 0;
            return (
              <tr key={p.symbol} className="border-t border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">
                  <div className="font-bold text-slate-800">{p.name}</div>
                  <div className="font-mono text-[11px] text-slate-400">{p.code}</div>
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  <div className="font-bold text-slate-800">{p.shares}</div>
                  <div className={cn('text-[11px]', p.availShares < p.shares ? 'text-amber-600' : 'text-slate-400')}>
                    可卖 {p.availShares}
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-700">{fmt(p.costPrice)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold">
                  {p.lastPrice ? fmt(p.lastPrice) : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {p.marketValue ? `¥${p.marketValue.toLocaleString()}` : '—'}
                </td>
                <td className={cn('px-3 py-2 text-right font-mono font-bold', pnlColor(f))}>
                  {p.marketValue ? (
                    <>
                      <div>{f >= 0 ? '+' : ''}{fmt(f)}</div>
                      <div className="text-[11px]">{fp >= 0 ? '+' : ''}{fmt(fp)}%</div>
                    </>
                  ) : '—'}
                </td>
                <td className={cn('px-3 py-2 text-right font-mono hidden lg:table-cell', pnlColor(p.realized))}>
                  {p.realized ? `${p.realized >= 0 ? '+' : ''}${fmt(p.realized)}` : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="inline-flex gap-1">
                    <button
                      onClick={() => onTrade('buy', p)}
                      disabled={cashAvail < (p.lastPrice ?? 0) * 100}
                      className="inline-flex items-center gap-0.5 px-2 py-1 text-[11px] rounded border border-red-200 text-red-600 hover:bg-red-50 font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <TrendingUp className="w-3 h-3" /> 买
                    </button>
                    <button
                      onClick={() => onTrade('sell', p)}
                      disabled={p.availShares < 100}
                      className="inline-flex items-center gap-0.5 px-2 py-1 text-[11px] rounded border border-emerald-200 text-emerald-600 hover:bg-emerald-50 font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <TrendingDown className="w-3 h-3" /> 卖
                    </button>
                    <button
                      onClick={() => onAdjust(p)}
                      title="同步外部持仓 / 校准成本"
                      className="inline-flex items-center gap-0.5 px-2 py-1 text-[11px] rounded border border-blue-200 text-blue-600 hover:bg-blue-50 font-bold"
                    >
                      <Edit3 className="w-3 h-3" /> 调
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100 flex items-center justify-between">
        <span>当前现金 ¥{cashAvail.toLocaleString()}</span>
        <button onClick={onRefresh} className="hover:text-slate-700 inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> 实时价 10s 自动刷新
        </button>
      </div>
    </div>
  );
}

function TradesTable() {
  const { items, loading, refresh } = useTrades(undefined, 200);
  const [reverting, setReverting] = useState<number | null>(null);

  const handleRevert = async (id: number) => {
    if (!confirm('确定撤销该调账记录？将恢复持仓与现金到调账前状态。')) return;
    setReverting(id);
    try {
      await revertTrade(id);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setReverting(null);
    }
  };

  if (loading) return <div className="text-center text-slate-400 py-8 text-sm">加载中…</div>;
  if (!items.length) return <div className="text-center text-slate-400 py-8 text-sm">尚无交易</div>;
  return (
    <div className="overflow-x-auto bg-white border border-slate-200/70 rounded-xl shadow-sm">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-200/70">
          <tr>
            <th className="px-2 py-2 text-left font-bold">时间</th>
            <th className="px-2 py-2 text-left font-bold">股票</th>
            <th className="px-2 py-2 text-left font-bold">类型</th>
            <th className="px-2 py-2 text-right font-bold">股数</th>
            <th className="px-2 py-2 text-right font-bold">价格</th>
            <th className="px-2 py-2 text-right font-bold">成交额</th>
            <th className="px-2 py-2 text-right font-bold">佣金</th>
            <th className="px-2 py-2 text-right font-bold">印花税</th>
            <th className="px-2 py-2 text-right font-bold hidden md:table-cell">过户费</th>
            <th className="px-2 py-2 text-right font-bold">净额</th>
            <th className="px-2 py-2 text-right font-bold">已实现</th>
            <th className="px-2 py-2 text-right font-bold hidden lg:table-cell">余额</th>
            <th className="px-2 py-2 text-center font-bold w-16">操作</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {items.map((t) => {
            const isBuy = t.side === 'buy';
            const isAdj = t.side === 'adjust';
            return (
              <tr key={t.id} className={cn(
                'border-t border-slate-100',
                t.reverted && 'opacity-40',
                isAdj && !t.reverted && 'bg-blue-50/30',
              )}>
                <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap text-[11px]">
                  {new Date(t.ts).toLocaleString('zh-CN', { hour12: false })}
                </td>
                <td className="px-2 py-1.5">
                  <div className="font-sans font-bold text-slate-800">{t.name}</div>
                  <div className="text-[10px] text-slate-400">{t.code}</div>
                </td>
                <td className={cn(
                  'px-2 py-1.5 font-bold',
                  isAdj ? 'text-blue-600' : isBuy ? 'text-red-600' : 'text-emerald-600',
                )}>
                  {isAdj
                    ? (t.reverted
                        ? <span className="line-through">调账</span>
                        : <span className="inline-flex items-center gap-1"><Edit3 className="w-3 h-3" />调账</span>)
                    : isBuy ? '买入' : '卖出'}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {isAdj && t.beforeShares != null
                    ? <span title={`从 ${t.beforeShares} 股 → ${t.shares} 股`}>{t.beforeShares} → {t.shares}</span>
                    : t.shares}
                </td>
                <td className="px-2 py-1.5 text-right">{fmt(t.price)}</td>
                <td className="px-2 py-1.5 text-right">{isAdj ? fmt(t.amount) : fmt(t.amount)}</td>
                <td className="px-2 py-1.5 text-right text-slate-500">{isAdj ? '—' : fmt(t.commission)}</td>
                <td className="px-2 py-1.5 text-right text-slate-500">{isAdj || t.stampTax === 0 ? '—' : fmt(t.stampTax)}</td>
                <td className="px-2 py-1.5 text-right text-slate-500 hidden md:table-cell">{isAdj || t.transferFee === 0 ? '—' : fmt(t.transferFee)}</td>
                <td className="px-2 py-1.5 text-right font-bold">
                  {isAdj
                    ? (t.syncCash ? `${t.netAmount > 0 ? '−' : t.netAmount < 0 ? '+' : ''}${fmt(Math.abs(t.netAmount))}` : '—')
                    : fmt(t.netAmount)}
                </td>
                <td className={cn('px-2 py-1.5 text-right', pnlColor(t.realizedPnl))}>
                  {(!isBuy && t.realizedPnl !== 0) ? `${t.realizedPnl >= 0 ? '+' : ''}${fmt(t.realizedPnl)}` : '—'}
                </td>
                <td className="px-2 py-1.5 text-right text-slate-500 hidden lg:table-cell">{fmt(t.cashAfter)}</td>
                <td className="px-2 py-1.5 text-center">
                  {isAdj && !t.reverted ? (
                    <button
                      onClick={() => handleRevert(t.id)}
                      disabled={reverting === t.id}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 font-bold disabled:opacity-40"
                      title="撤销该调账"
                    >
                      <Undo2 className="w-2.5 h-2.5" />撤销
                    </button>
                  ) : t.reverted ? (
                    <span className="text-[10px] text-slate-400">已撤销</span>
                  ) : (
                    <span className="text-[10px] text-slate-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CashTable({ cashAvail, onChange }: { cashAvail: number; onChange: () => void }) {
  const { items, loading, refresh } = useCashFlows();
  const [type, setType] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('10000');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      await adjustCash(type, Number(amount), note || undefined);
      setNote('');
      await refresh();
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = async () => {
    if (!confirm('确定重置账户？将清空所有持仓与交易，重置现金到 100w。')) return;
    setSubmitting(true);
    try {
      await adjustCash('reset', 0);
      await refresh();
      onChange();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200/70 rounded-xl p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <label className="text-[11px] text-slate-500 font-bold mb-1">类型</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'deposit' | 'withdraw')}
              className="h-9 px-2 rounded-md border border-slate-200 text-sm font-bold"
            >
              <option value="deposit">入金</option>
              <option value="withdraw">出金</option>
            </select>
          </div>
          <div className="flex flex-col flex-1 min-w-[140px]">
            <label className="text-[11px] text-slate-500 font-bold mb-1">金额</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-9 px-3 rounded-md border border-slate-300 font-mono"
            />
          </div>
          <div className="flex flex-col flex-1 min-w-[160px]">
            <label className="text-[11px] text-slate-500 font-bold mb-1">备注（可选）</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-9 px-3 rounded-md border border-slate-300"
            />
          </div>
          <button
            onClick={submit}
            disabled={submitting || !amount || Number(amount) <= 0}
            className="h-9 px-4 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm disabled:opacity-50"
          >
            {submitting ? '提交中…' : '提交'}
          </button>
          <button
            onClick={reset}
            disabled={submitting}
            className="h-9 px-3 rounded-md border border-red-200 text-red-600 hover:bg-red-50 font-bold text-sm disabled:opacity-50"
          >
            重置账户
          </button>
        </div>
        <div className="text-[11px] text-slate-400 mt-2 font-mono">当前现金 ¥{cashAvail.toLocaleString()}</div>
        {err && <div className="text-xs text-red-700 mt-2">❌ {err}</div>}
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-8 text-sm">加载中…</div>
      ) : items.length === 0 ? (
        <div className="text-center text-slate-400 py-8 text-sm">无记录</div>
      ) : (
        <div className="overflow-x-auto bg-white border border-slate-200/70 rounded-xl shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-widest border-b border-slate-200/70">
              <tr>
                <th className="px-3 py-2 text-left font-bold">时间</th>
                <th className="px-3 py-2 text-left font-bold">类型</th>
                <th className="px-3 py-2 text-right font-bold">金额</th>
                <th className="px-3 py-2 text-right font-bold">余额</th>
                <th className="px-3 py-2 text-left font-bold">备注</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {items.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-500 text-xs">{new Date(c.ts).toLocaleString('zh-CN', { hour12: false })}</td>
                  <td className="px-3 py-1.5 font-bold text-slate-700 text-xs">
                    {c.type === 'deposit' ? '入金' : c.type === 'withdraw' ? '出金' : '重置'}
                  </td>
                  <td className={cn(
                    'px-3 py-1.5 text-right',
                    c.type === 'deposit' ? 'text-red-600' : c.type === 'withdraw' ? 'text-emerald-600' : 'text-slate-500',
                  )}>
                    {c.type === 'deposit' ? '+' : c.type === 'withdraw' ? '-' : ''}{fmt(c.amount)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-700">{fmt(c.cashAfter)}</td>
                  <td className="px-3 py-1.5 text-slate-500 text-xs font-sans">{c.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsForm() {
  const { data, error, update } = useSettings();
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!data) {
    return <div className="text-center text-slate-400 py-8 text-sm">{error ?? '加载中…'}</div>;
  }

  const apply = async (patch: Parameters<typeof update>[0]) => {
    setSubmitting(true);
    setMsg(null);
    try {
      await update(patch);
      setMsg('已保存');
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200/70 rounded-xl p-5 max-w-2xl space-y-4">
      <h3 className="text-sm font-black text-slate-800">手续费规则（可调）</h3>
      <NumberRow
        label="佣金费率"
        suffix="（双向收取）"
        value={data.commissionRate}
        unit="率"
        onSave={(v) => apply({ commissionRate: v })}
        format={(v) => `${(v * 10000).toFixed(2)} ‱（万分之${(v * 10000).toFixed(2)}）`}
        parse={(s) => Number(s)}
      />
      <NumberRow
        label="佣金最低"
        suffix=""
        value={data.commissionMin}
        unit="¥"
        onSave={(v) => apply({ commissionMin: v })}
        format={(v) => `¥${v}`}
        parse={(s) => Number(s)}
      />
      <NumberRow
        label="印花税"
        suffix="（仅卖出）"
        value={data.stampTaxRate}
        unit="率"
        onSave={(v) => apply({ stampTaxRate: v })}
        format={(v) => `${(v * 1000).toFixed(2)} ‰（千分之${(v * 1000).toFixed(2)}）`}
        parse={(s) => Number(s)}
      />
      <NumberRow
        label="过户费"
        suffix="（仅沪市，双向）"
        value={data.transferFeeRate}
        unit="率"
        onSave={(v) => apply({ transferFeeRate: v })}
        format={(v) => `${(v * 1e6).toFixed(1)} / 百万`}
        parse={(s) => Number(s)}
      />

      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        <div>
          <div className="font-bold text-sm text-slate-700">T+1 限制</div>
          <div className="text-[11px] text-slate-400">A 股标准：当日买入次日才可卖</div>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={data.enableT1}
            onChange={(e) => apply({ enableT1: e.target.checked })}
            className="accent-blue-600 w-4 h-4"
          />
          <span className="text-sm font-bold text-slate-700">{data.enableT1 ? '开启' : '关闭'}</span>
        </label>
      </div>

      {msg && <div className="text-xs text-emerald-700">{msg}</div>}
      {submitting && <div className="text-xs text-slate-400">保存中…</div>}

      <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
        默认值参考 A 股普遍水平：佣金万 2.5（最低 5 元）、印花税千 0.5（卖出）、过户费万 0.1（沪市双向）。
      </p>
    </div>
  );
}

function NumberRow({
  label, suffix, value, unit, onSave, format, parse,
}: {
  label: string;
  suffix: string;
  value: number;
  unit: string;
  onSave: (v: number) => void;
  format: (v: number) => string;
  parse: (s: string) => number;
}) {
  const [v, setV] = useState(String(value));
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-[150px]">
        <div className="font-bold text-sm text-slate-700">{label}</div>
        <div className="text-[11px] text-slate-400">{suffix}</div>
      </div>
      {editing ? (
        <div className="flex items-center gap-2 ml-auto">
          <input
            type="number"
            step="0.000001"
            value={v}
            onChange={(e) => setV(e.target.value)}
            className="h-8 w-32 px-2 rounded border border-slate-300 font-mono text-sm"
          />
          <span className="text-[11px] text-slate-400">{unit}</span>
          <button
            onClick={() => { onSave(parse(v)); setEditing(false); }}
            className="h-8 px-3 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
          >保存</button>
          <button
            onClick={() => { setV(String(value)); setEditing(false); }}
            className="h-8 px-3 rounded border border-slate-200 text-slate-500 text-xs font-bold"
          >取消</button>
        </div>
      ) : (
        <div className="flex items-center gap-3 ml-auto">
          <span className="font-mono text-sm text-slate-800 font-bold">{format(value)}</span>
          <button
            onClick={() => { setV(String(value)); setEditing(true); }}
            className="text-xs text-blue-600 hover:underline font-bold"
          >修改</button>
        </div>
      )}
    </div>
  );
}
