'use client';

import { useEffect, useState } from 'react';
import { X, Edit3, AlertCircle } from 'lucide-react';
import { cn, fmt } from '@/lib/utils';

// =============================================================================
// AdjustDialog —— 手动调整持仓与成本价
//
// 适用场景：
//   - 之前在其它软件买的，想同步进来
//   - 系统计算成本与实际有偏差，需要校准
//
// 行为：
//   - 直接覆盖 positions.{shares, cost}，可立即卖出（不锁 T+1）
//   - 默认不动现金；勾选"同步扣/补现金"则按 (新成本 − 旧成本) 调整
//   - 减仓：差额（新成本价 − 旧均价）× 减少股数 计入已实现
//   - 写一条 side='adjust' 流水，可在交易流水中"撤销"
// =============================================================================

export type AdjustDialogProps = {
  open: boolean;
  symbol: string;
  code: string;
  name: string;
  // 当前快照（仅作展示与默认值）
  curShares: number;
  curCostPrice: number;
  curAvail?: number;
  cashAvail?: number;
  onClose: () => void;
  onDone?: () => void;
};

const HUNDRED = 100;

export default function AdjustDialog({
  open, symbol, code, name,
  curShares, curCostPrice, curAvail = 0, cashAvail = 0,
  onClose, onDone,
}: AdjustDialogProps) {
  const [shares, setShares] = useState(String(curShares));
  const [costPrice, setCostPrice] = useState(curCostPrice ? curCostPrice.toFixed(2) : '');
  const [syncCash, setSyncCash] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setShares(String(curShares));
    setCostPrice(curCostPrice ? curCostPrice.toFixed(2) : '');
    setSyncCash(false);
    setNote('');
    setErr(null);
    setSubmitting(false);
  }, [open, curShares, curCostPrice]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const targetShares = Math.max(0, Math.floor(Number(shares) || 0));
  const targetCost = Math.max(0, Number(costPrice) || 0);
  const targetTotal = +(targetShares * targetCost).toFixed(2);
  const curTotal = +(curShares * curCostPrice).toFixed(2);
  const deltaShares = targetShares - curShares;
  const deltaCost = +(targetTotal - curTotal).toFixed(2);
  const oldAvg = curShares > 0 ? curCostPrice : 0;
  const realizedPreview = targetShares < curShares
    ? +((targetCost - oldAvg) * (curShares - targetShares)).toFixed(2)
    : 0;

  const validShares = targetShares === 0 || (targetShares >= HUNDRED && targetShares % HUNDRED === 0);
  const validCost = targetShares === 0 || targetCost > 0;
  const cashOk = !syncCash || deltaCost <= 0 || cashAvail >= deltaCost;
  const canSubmit = validShares && validCost && cashOk && !submitting && (
    targetShares !== curShares || Math.abs(deltaCost) > 0.001
  );

  if (!open) return null;

  const submit = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/portfolio/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol, code, name,
          targetShares,
          targetCostPrice: targetCost,
          syncCash,
          note: note || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      onDone?.();
      onClose();
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
        <div className="px-5 py-3 border-b bg-blue-50 border-blue-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-black text-blue-700">同步持仓 · {name}</h3>
            <span className="font-mono text-xs text-slate-500">{code}</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          {/* 当前快照 */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Snap label="当前持仓" value={`${curShares} 股`} />
            <Snap label="可卖" value={`${curAvail} 股`} />
            <Snap label="当前成本" value={curCostPrice ? `¥${fmt(curCostPrice)}` : '—'} />
          </div>

          {/* 目标股数 */}
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1.5 block">
              目标股数（100 整数倍；0 = 清仓）
            </label>
            <input
              type="number"
              min={0}
              step={HUNDRED}
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              className="w-full px-3 h-10 rounded-md border border-slate-300 focus:border-blue-500 focus:outline-none font-mono text-base"
            />
            {!validShares && (
              <div className="text-[11px] text-amber-600 mt-1">需为 0 或 100 的整数倍</div>
            )}
          </div>

          {/* 目标成本价 */}
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1.5 block">
              目标成本价（单股，含费均摊）
            </label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              disabled={targetShares === 0}
              className={cn(
                'w-full px-3 h-10 rounded-md border font-mono text-base',
                targetShares === 0
                  ? 'bg-slate-50 border-slate-200 text-slate-400'
                  : 'border-slate-300 focus:border-blue-500 focus:outline-none',
              )}
            />
            {!validCost && targetShares > 0 && (
              <div className="text-[11px] text-amber-600 mt-1">成本价需 &gt; 0</div>
            )}
          </div>

          {/* 同步现金开关 */}
          <label className="flex items-start gap-2 px-3 py-2 rounded-md border border-slate-200 bg-slate-50/60 cursor-pointer">
            <input
              type="checkbox"
              checked={syncCash}
              onChange={(e) => setSyncCash(e.target.checked)}
              className="mt-0.5 accent-blue-600"
            />
            <div className="flex-1">
              <div className="text-xs font-bold text-slate-700">同步扣/补现金</div>
              <div className="text-[11px] text-slate-500 leading-relaxed mt-0.5">
                勾选后按 (新成本总额 − 旧成本总额) 同步从账户现金中扣或补，<span className="font-bold">不收手续费</span>。
                未勾选则视为「外部带入的持仓」，仅修改持仓快照、不动现金。
              </div>
            </div>
          </label>

          {/* 备注 */}
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1.5 block">备注（可选）</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="如：从 XX 同步、校准成本价"
              className="w-full px-3 h-9 rounded-md border border-slate-300"
            />
          </div>

          {/* 影响预览 */}
          <div className="border border-blue-200 bg-blue-50/40 rounded-md p-3 text-xs space-y-1 font-mono">
            <Row k="股数变化" v={`${deltaShares >= 0 ? '+' : ''}${deltaShares} 股`} colorClass={deltaShares > 0 ? 'text-red-600' : deltaShares < 0 ? 'text-emerald-600' : ''} />
            <Row k="成本总额" v={`¥${curTotal.toLocaleString()} → ¥${targetTotal.toLocaleString()}`} />
            {deltaShares < 0 && (
              <Row k="计入已实现" v={`${realizedPreview >= 0 ? '+' : ''}¥${realizedPreview.toLocaleString()}`} colorClass={realizedPreview > 0 ? 'text-red-600' : realizedPreview < 0 ? 'text-emerald-600' : ''} hint="(新成本价−旧均价)×减少股数" />
            )}
            {syncCash && (
              <Row
                k={deltaCost > 0 ? '应扣款' : deltaCost < 0 ? '应补款' : '无变动'}
                v={`¥${Math.abs(deltaCost).toLocaleString()}`}
                colorClass={deltaCost > 0 ? 'text-red-600' : deltaCost < 0 ? 'text-emerald-600' : 'text-slate-500'}
              />
            )}
            <Row k="可卖股数" v={`${targetShares} 股`} hint="视为历史持仓，立即可卖" />
          </div>

          {!cashOk && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 inline-flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              现金不足以同步扣款（需 ¥{deltaCost.toLocaleString()}，可用 ¥{cashAvail.toLocaleString()}），请取消勾选或先入金。
            </div>
          )}
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
              'flex-[2] px-3 h-10 rounded-md text-white font-bold text-sm transition-colors bg-blue-600 hover:bg-blue-700',
              !canSubmit && 'opacity-50 cursor-not-allowed',
            )}
          >
            {submitting ? '提交中…' : '确认调账'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Snap({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded-md p-2 bg-slate-50/40">
      <div className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">{label}</div>
      <div className="font-mono font-bold text-slate-800 mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function Row({ k, v, hint, colorClass }: { k: string; v: string; hint?: string; colorClass?: string }) {
  return (
    <div className="flex items-center justify-between text-slate-500">
      <span className="flex items-center gap-1">
        {k}
        {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
      </span>
      <span className={cn('font-bold', colorClass ?? 'text-slate-700')}>{v}</span>
    </div>
  );
}
