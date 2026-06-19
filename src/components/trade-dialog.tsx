'use client';

import { useEffect, useState } from 'react';
import { X, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { cn, fmt } from '@/lib/utils';
import { placeTrade, useFeePreview, type TradeSide } from '@/lib/use-portfolio';

// =============================================================================
// TradeDialog —— 下单弹窗
//
// - 实时价 / 手动价（默认实时价，开关切换）
// - 数量按 100 股递增；提供 +1 手 / +10 手 / 1/2 仓 / 全仓 快捷键
// - 实时显示佣金 + 印花税 + 过户费 = 总费用 + 净额
// - 提交后回调 onDone（外层刷新持仓）
// =============================================================================

export type TradeDialogProps = {
  open: boolean;
  side: TradeSide;
  symbol: string;
  code: string;
  name: string;
  livePrice?: number;          // 来自调用方的最近一次实时价（可选）
  cashAvail?: number;          // 现金可用，用于"半仓/全仓"
  posAvail?: number;           // 卖出时该股票可卖股数
  onClose: () => void;
  onDone?: () => void;
};

const HUNDRED = 100;

export default function TradeDialog({
  open, side, symbol, code, name, livePrice, cashAvail = 0, posAvail = 0,
  onClose, onDone,
}: TradeDialogProps) {
  const [useLive, setUseLive] = useState(true);
  const [price, setPrice] = useState<string>(livePrice ? livePrice.toFixed(2) : '');
  const [shares, setShares] = useState<string>('100');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 打开时初始化
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setSubmitting(false);
    setUseLive(true);
    setShares('100');
    setPrice(livePrice ? livePrice.toFixed(2) : '');
  }, [open, livePrice]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const sharesN = Math.max(0, Math.floor(Number(shares) || 0));
  const priceN = useLive ? (livePrice ?? 0) : Math.max(0, Number(price) || 0);
  const { fee, loading: feeLoading } = useFeePreview(side, symbol, sharesN, priceN);

  if (!open) return null;

  const isBuy = side === 'buy';
  const colorClass = isBuy ? 'text-red-600' : 'text-emerald-600';
  const colorBgBtn = isBuy
    ? 'bg-red-600 hover:bg-red-700'
    : 'bg-emerald-600 hover:bg-emerald-700';

  // 快捷数量
  const setQuickByLot = (lots: number) => setShares(String(Math.max(HUNDRED, lots * HUNDRED)));
  const setQuickAllIn = () => {
    if (isBuy) {
      // 估算最大可买：cash / (price * 1.001)，再向下取整到 100
      if (priceN <= 0 || cashAvail <= 0) return;
      const maxByCash = Math.floor(cashAvail / (priceN * 1.001) / HUNDRED) * HUNDRED;
      setShares(String(Math.max(HUNDRED, maxByCash)));
    } else {
      // 卖：可卖整数 100 倍数
      const max = Math.floor(posAvail / HUNDRED) * HUNDRED;
      setShares(String(Math.max(HUNDRED, max)));
    }
  };
  const setQuickHalf = () => {
    if (isBuy) {
      if (priceN <= 0 || cashAvail <= 0) return;
      const v = Math.floor((cashAvail / 2) / (priceN * 1.001) / HUNDRED) * HUNDRED;
      setShares(String(Math.max(HUNDRED, v)));
    } else {
      const v = Math.floor(posAvail / 2 / HUNDRED) * HUNDRED;
      setShares(String(Math.max(HUNDRED, v)));
    }
  };

  const canSubmit =
    !!symbol && sharesN >= HUNDRED && sharesN % HUNDRED === 0 &&
    (useLive || priceN > 0) && !submitting;

  const submit = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      const res = await placeTrade({
        side, symbol, code, name,
        shares: sharesN,
        ...(useLive ? { useLivePrice: true } : { price: priceN }),
      });
      onDone?.();
      onClose();
      if (typeof window !== 'undefined') {
        // 简单提示，避免再做 toast 系统
        const msg = `${isBuy ? '买入' : '卖出'} ${name} ${res.trade.shares} 股 @ ${res.trade.price.toFixed(2)} ${
          res.usedLivePrice ? '(实时价)' : ''
        }，${isBuy ? '扣款' : '到账'} ¥${res.trade.netAmount.toLocaleString()}`;
        // eslint-disable-next-line no-alert
        alert(msg);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md overflow-hidden flex flex-col qt-modal-anim"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn(
          'px-5 py-3 border-b flex items-center justify-between',
          isBuy ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200',
        )}>
          <div className="flex items-center gap-2">
            {isBuy ? <TrendingUp className={cn('w-5 h-5', colorClass)} /> : <TrendingDown className={cn('w-5 h-5', colorClass)} />}
            <h3 className={cn('text-base font-black', colorClass)}>
              {isBuy ? '买入' : '卖出'} {name}
            </h3>
            <span className="font-mono text-xs text-slate-500">{code}</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          {/* 价格行 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-500">成交价</label>
              <label className="text-[11px] flex items-center gap-1 text-slate-500">
                <input
                  type="checkbox"
                  checked={useLive}
                  onChange={(e) => setUseLive(e.target.checked)}
                  className="accent-blue-600"
                />
                按实时价成交
              </label>
            </div>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                disabled={useLive}
                value={useLive ? (livePrice ? livePrice.toFixed(2) : '') : price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={useLive ? '提交时取实时价' : '请输入价格'}
                className={cn(
                  'w-full px-3 h-10 rounded-md border font-mono text-base',
                  useLive
                    ? 'bg-slate-50 border-slate-200 text-slate-500'
                    : 'bg-white border-slate-300 focus:border-blue-500 focus:outline-none',
                )}
              />
              {useLive && livePrice && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 inline-flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> 实时
                </span>
              )}
            </div>
          </div>

          {/* 数量行 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-500">
                数量（手 = 100 股）
              </label>
              <span className="text-[11px] text-slate-500 font-mono">
                {isBuy ? `可用 ¥${cashAvail.toLocaleString()}` : `可卖 ${posAvail} 股`}
              </span>
            </div>
            <input
              type="number"
              step={HUNDRED}
              min={HUNDRED}
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              className="w-full px-3 h-10 rounded-md border border-slate-300 focus:border-blue-500 focus:outline-none font-mono text-base"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[1, 5, 10, 50].map((l) => (
                <button
                  key={l}
                  onClick={() => setQuickByLot(l)}
                  className="px-2 py-1 text-[11px] rounded border border-slate-200 hover:bg-slate-50 font-bold"
                >
                  {l} 手
                </button>
              ))}
              <button onClick={setQuickHalf} className="px-2 py-1 text-[11px] rounded border border-slate-200 hover:bg-slate-50 font-bold">
                ½ 仓
              </button>
              <button onClick={setQuickAllIn} className="px-2 py-1 text-[11px] rounded border border-slate-200 hover:bg-slate-50 font-bold">
                全仓
              </button>
            </div>
          </div>

          {/* 费用预览 */}
          <div className="border border-slate-200 rounded-md p-3 bg-slate-50/60 text-xs space-y-1 font-mono">
            <Row k="成交额" v={fee?.amount} />
            <Row k="佣金" v={fee?.commission} hint={fee ? `(率 ${(fee.settings.commissionRate * 10000).toFixed(2)}‱，最低 ¥${fee.settings.commissionMin})` : undefined} />
            <Row k="印花税" v={fee?.stampTax} hint={isBuy ? '(买入免征)' : `(率 ${(fee?.settings.stampTaxRate ?? 0) * 1000}‰)`} />
            <Row k="过户费" v={fee?.transferFee} hint={symbol.startsWith('sh') ? `(率 ${(fee?.settings.transferFeeRate ?? 0) * 1e6}/百万)` : '(非沪市免征)'} />
            <div className="border-t border-slate-200 pt-1.5 mt-1.5 flex items-center justify-between font-bold">
              <span className="text-slate-600">总费用</span>
              <span className="text-slate-800">¥{(fee?.totalFee ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between font-black text-sm">
              <span className={colorClass}>{isBuy ? '应扣款' : '应到账'}</span>
              <span className={colorClass}>¥{(fee?.netAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            {feeLoading && <div className="text-[10px] text-slate-400 pt-1">计算中…</div>}
          </div>

          {err && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-2">
              ❌ {err}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 bg-slate-50/40">
          <button
            onClick={onClose}
            className="flex-1 px-3 h-10 rounded-md border border-slate-200 text-slate-600 hover:bg-white font-bold text-sm"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              'flex-[2] px-3 h-10 rounded-md text-white font-bold text-sm transition-colors',
              colorBgBtn,
              !canSubmit && 'opacity-50 cursor-not-allowed',
            )}
          >
            {submitting ? '提交中…' : isBuy ? '确认买入' : '确认卖出'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, hint }: { k: string; v?: number; hint?: string }) {
  return (
    <div className="flex items-center justify-between text-slate-500">
      <span className="flex items-center gap-1">
        {k}
        {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
      </span>
      <span className="text-slate-700">¥{(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
    </div>
  );
}

// 防止未使用 import 警告（fmt 在某些视图变体可能用到）
void fmt;
