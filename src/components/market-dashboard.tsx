'use client';

import { useEffect, useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, Activity, Zap, BarChart3, Globe, Banknote, Loader2 } from 'lucide-react';
import { cn, fmt, pnlColor } from '@/lib/utils';

// =============================================================================
// MarketDashboard — 大盘资金流仪表盘
//
// 三视图：
//   1) 核心指数条（上证/深证/创业板/科创50/沪深300/恒生）
//   2) 资金流入/流出板块（通过代表 ETF 涨跌幅排行）
//   3) 成交最活跃板块
//
// 颜色约定：红涨绿跌，红色=资金流入，绿色=资金流出
//   涨跌幅为正值 → 红色底，代表资金净流入
//   涨跌幅为负值 → 绿色底，代表资金净流出
// =============================================================================

type IndexItem = {
  code: string; label: string; price: number; change: number; changePct: number; volume: number; turnover: number;
};

type SectorItem = {
  sym: string; label: string; bucket: string; price: number; changePct: number; volume: number; turnover: number;
};

type OverviewResp = {
  updatedAt: number;
  indices: IndexItem[];
  hkIndices: { hsi: IndexItem | null; hscei: IndexItem | null; hstech: IndexItem | null };
  moneyIn: SectorItem[];
  moneyOut: SectorItem[];
  mostActive: SectorItem[];
  error?: string;
};

export default function MarketDashboard() {
  const [data, setData] = useState<OverviewResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/market/overview', { cache: 'no-store' })
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
  }, []);

  return (
    <div className="space-y-4">
      {loading && (
        <div className="py-12 text-center text-slate-400">
          <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
          <p className="text-xs">加载大盘数据…</p>
        </div>
      )}
      {err && (
        <div className="py-3 px-3 rounded bg-red-50 border border-red-200 text-red-700 text-xs">❌ {err}</div>
      )}
      {data && (
        <div className="space-y-3">
          {/* ===== 1) 核心指数条 ===== */}
          <IndexRibbon indices={data.indices} hk={data.hkIndices} />

          {/* ===== 2) 资金流三列 ===== */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FlowColumn
              icon={TrendingUp}
              title="资金流入 Top"
              color="text-red-600"
              bg="bg-red-50/50"
              items={data.moneyIn}
            />
            <FlowColumn
              icon={TrendingDown}
              title="资金流出 Top"
              color="text-emerald-600"
              bg="bg-emerald-50/50"
              items={data.moneyOut}
            />
            <FlowColumn
              icon={Activity}
              title="成交最活跃"
              color="text-amber-600"
              bg="bg-amber-50/50"
              items={data.mostActive}
              valueKey="turnover"
            />
          </div>

          {/* 底部更新时间 */}
          <div className="text-[9px] text-slate-400 text-right">
            更新于 {new Date(data.updatedAt).toLocaleTimeString('zh-CN')} · 数据来源：新浪财经 + 东方财富
            <span className="ml-2">红=资金流入 绿=资金流出</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 指数条
// ---------------------------------------------------------------------------
function IndexRibbon({ indices, hk }: { indices: IndexItem[]; hk: OverviewResp['hkIndices'] }) {
  const all = [...indices];
  if (hk?.hsi) all.push({ ...hk.hsi, code: 'hkHSI', label: '恒生指数', volume: 0, turnover: 0 });
  if (hk?.hscei) all.push({ ...hk.hscei, code: 'hkHSCEI', label: '国企指数', volume: 0, turnover: 0 });
  if (hk?.hstech) all.push({ ...hk.hstech, code: 'hkHSTECH', label: '恒生科技', volume: 0, turnover: 0 });

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-1" />
      {all.map((idx) => {
        const up = idx.changePct > 0;
        return (
          <div
            key={idx.code}
            className={cn(
              'shrink-0 px-2.5 py-1.5 rounded-md border text-[11px] font-mono',
              up
                ? 'bg-red-50/60 border-red-200 text-red-700'
                : idx.changePct < 0
                  ? 'bg-emerald-50/60 border-emerald-200 text-emerald-700'
                  : 'bg-slate-50 border-slate-200 text-slate-600',
            )}
          >
            <div className="text-[9px] text-slate-500 font-sans">{idx.label}</div>
            <div className="font-bold">{idx.price > 0 ? idx.price.toFixed(2) : '—'}</div>
            <div className={cn('text-[10px]', up ? 'text-red-600' : 'text-emerald-600')}>
              {idx.changePct > 0 ? '+' : ''}{idx.changePct.toFixed(2)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 资金流列
// ---------------------------------------------------------------------------
function FlowColumn({
  icon: Icon, title, color, bg, items, valueKey,
}: {
  icon: React.FC<{ className?: string }>;
  title: string;
  color: string;
  bg: string;
  items: SectorItem[];
  valueKey?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-slate-200/70 p-2.5', bg)}>
      <div className={cn('flex items-center gap-1.5 text-[10px] font-black tracking-wider uppercase mb-2', color)}>
        <Icon className="w-3 h-3" /> {title}
      </div>
      {items.length === 0 ? (
        <div className="py-6 text-center text-slate-400 text-[10px]">暂无数据</div>
      ) : (
        <div className="space-y-1">
          {items.map((s, idx) => (
            <div key={s.sym} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/80 text-[11px]">
              <span className="text-slate-400 font-mono w-4 text-[10px]">{idx + 1}</span>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                s.changePct > 0 ? 'bg-red-500' : s.changePct < 0 ? 'bg-emerald-500' : 'bg-slate-300',
              )} />
              <span className="font-bold text-slate-700 truncate flex-1">{s.label}</span>
              <span className={cn(
                'font-mono font-bold shrink-0',
                pnlColor(valueKey ? s.turnover : s.changePct),
              )}>
                {valueKey
                  ? `${(s.turnover / 1e8).toFixed(1)}亿`
                  : `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
