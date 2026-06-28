'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  BarChart3 as BarChartIcon,
  Newspaper,
  Target,
  Loader2,
  Activity as ActivityIcon,
} from 'lucide-react';
import { cn, pnlColor } from '@/lib/utils';

// =============================================================================
// AnalysisPanel — 股票涨跌原因分析面板
//
// 参考:
//   stock-sentiment (Naman123935)   → 情绪-价格双轴叠加时间线
//   stock-analysis-team (wudengyao) → 事件驱动+多Agent协作
//   daily_stock_analysis (ZhuLinsen)→ 决策仪表盘
//
// 模块：① 一句话总结  ② 技术面  ③ 资金面  ④ 消息面
//       ⑤ 舆情→股价脉络图  ⑥ 综合原因清单
// =============================================================================

type TimelineItem = {
  date: string;
  time?: string;
  event: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  price: number;
  priceAfter30m?: { price: number; changePct: number; high: number; low: number };
  priceAfter?: number;
  changePctAfter?: number;
  source?: string;
};

type AnalysisData = {
  symbol: string;
  code: string;
  name: string;
  price: number;
  changePct: number;
  change: number;
  ts: number;
  klineSignals: Array<{ label: string; detail: string; direction: 'bullish' | 'bearish' | 'neutral' }>;
  volumeSignals: Array<{ label: string; detail: string; direction: 'bullish' | 'bearish' | 'neutral' }>;
  newsSignals: Array<{ label: string; detail: string; direction: 'bullish' | 'bearish' | 'neutral'; source?: string }>;
  timeline: TimelineItem[];
  reasons: Array<{ reason: string; category: '技术面' | '资金面' | '消息面' | '基本面'; confidence: '高' | '中' | '低'; direction: 'bullish' | 'bearish' | 'neutral' }>;
  summary: string;
  llm: boolean;
  error?: string;
};

export type AnalysisPanelProps = {
  symbol: string;
  code: string;
  name: string;
};

const DirectionIcon = ({ dir }: { dir: string }) => {
  if (dir === 'bullish') return <TrendingUp className="w-3.5 h-3.5 text-red-500" />;
  if (dir === 'bearish') return <TrendingDown className="w-3.5 h-3.5 text-green-500" />;
  return <Minus className="w-3.5 h-3.5 text-slate-400" />;
};

const ConfidenceBadge = ({ level }: { level: '高' | '中' | '低' }) => (
  <span className={cn(
    'text-[10px] px-1.5 py-0.5 rounded font-bold',
    level === '高' ? 'bg-red-50 text-red-600' : level === '中' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500',
  )}>
    {level}
  </span>
);

export default function AnalysisPanel({ symbol, code, name }: AnalysisPanelProps) {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analysis?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
      const json: AnalysisData = await res.json();
      if (!res.ok || (json as { error?: string }).error) {
        throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
      }
      setData({ ...json, name: json.name || name });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, name]);

  useEffect(() => {
    if (symbol) fetchAnalysis();
  }, [fetchAnalysis]);

  // --- 加载态 ---
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-slate-400 text-sm justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        正在分析{name || code}今日涨跌原因...
      </div>
    );
  }

  // --- 错误态 ---
  if (error) {
    return (
      <div className="py-4 px-3 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
       分析失败：{error}
        <button
          onClick={fetchAnalysis}
          className="ml-2 underline text-red-600 hover:text-red-800"
        >
          重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { klineSignals, volumeSignals, newsSignals, timeline, reasons, summary } = data;

  // --- 总结卡片 ---
  return (
    <div className="space-y-3">
      {/* 一句话总结 */}
      <div className={cn(
        'rounded-lg border p-3',
        data.changePct > 0 ? 'bg-red-50/60 border-red-200' :
        data.changePct < 0 ? 'bg-green-50/60 border-green-200' :
        'bg-slate-50 border-slate-200',
      )}>
        <div className="flex items-start gap-2">
          <Zap className={cn(
            'w-4 h-4 mt-0.5 shrink-0',
            pnlColor(data.changePct),
          )} />
          <div>
            <div className="text-xs font-bold text-slate-800 leading-relaxed">
              {summary}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              数据：技术分析 + 市场舆情 · {new Date(data.ts).toLocaleTimeString('zh-CN', { hour12: false })}
              {data.llm && ' · LLM 增强'}
            </div>
          </div>
        </div>
      </div>

      {/* 舆情→股价 脉络图（参考 stock-sentiment 双轴叠加设计） */}
      {timeline.length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 border-b border-indigo-100">
            <ActivityIcon className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[11px] font-bold text-indigo-700">舆情 → 股价 脉络图</span>
            <span className="text-[10px] text-indigo-400 ml-auto">
              参考 stock-sentiment 双轴叠加设计
            </span>
          </div>
          <div className="px-3 py-2">
            <div className="relative">
              {timeline.map((item, idx) => (
                <div key={idx} className="flex items-stretch gap-2 group">
                  {/* 左侧：时间 */}
                  <div className="w-[100px] shrink-0 text-right py-1.5 pr-2 border-r-2 border-slate-200 relative">
                    <div className="text-[10px] font-mono font-bold text-slate-500">{item.time || item.date.slice(5)}</div>
                    {item.time && (
                      <div className="text-[9px] text-slate-400">{item.date.slice(5)}</div>
                    )}
                    <div className={cn(
                      'absolute right-[-5px] top-2 w-2.5 h-2.5 rounded-full border-2 border-white',
                      item.direction === 'bullish' ? 'bg-red-500' :
                      item.direction === 'bearish' ? 'bg-green-500' : 'bg-slate-300',
                    )} />
                  </div>

                  {/* 中间：事件 + 30min 联动 */}
                  <div className="flex-1 py-1.5 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <DirectionIcon dir={item.direction} />
                      <span className="text-[10px] text-slate-700 leading-relaxed line-clamp-2">
                        {item.event}
                      </span>
                    </div>
                    {item.priceAfter30m && (
                      <div className="ml-5 mt-1 flex items-center gap-2">
                        <svg className="w-3 h-3 text-indigo-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                        </svg>
                        <span className="text-[9px] text-slate-500">
                          {item.time ? '30min窗口' : '盘前公告→次日'}:
                        </span>
                        <span className={cn(
                          'text-[9px] font-bold',
                          item.priceAfter30m.changePct > 0 ? 'text-red-500' :
                          item.priceAfter30m.changePct < 0 ? 'text-green-500' : 'text-slate-400',
                        )}>
                          {item.priceAfter30m.changePct > 0 ? '+' : ''}{item.priceAfter30m.changePct.toFixed(2)}%
                        </span>
                        {item.time && (
                          <span className="text-[8px] text-slate-400 font-mono">
                            H:{item.priceAfter30m.high.toFixed(1)} L:{item.priceAfter30m.low.toFixed(1)}
                          </span>
                        )}
                      </div>
                    )}
                    {item.source && (
                      <div className="text-[9px] text-slate-400 ml-5 mt-0.5 font-mono">{item.source}</div>
                    )}
                  </div>

                  {/* 右侧：股价 */}
                  <div className="w-[80px] shrink-0 py-1.5 text-right">
                    <div className="text-[10px] font-mono font-bold text-slate-700">
                      {item.price > 0 ? item.price.toFixed(2) : '—'}
                    </div>
                    {item.changePctAfter != null && (
                      <div className={cn(
                        'text-[9px] font-bold mt-0.5',
                        (item.changePctAfter ?? 0) > 0 ? 'text-red-500' :
                        (item.changePctAfter ?? 0) < 0 ? 'text-green-500' : 'text-slate-400',
                      )}>
                        次日{'>'} {(item.changePctAfter ?? 0) > 0 ? '+' : ''}{item.changePctAfter!.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 技术面 */}
      {klineSignals.length > 0 && (
        <SignalSection
          title="技术面 · K线形态"
          icon={<BarChartIcon className="w-3.5 h-3.5" />}
          signals={klineSignals}
        />
      )}

      {/* 资金面 */}
      {volumeSignals.length > 0 && (
        <SignalSection
          title="资金面 · 量价关系"
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          signals={volumeSignals}
        />
      )}

      {/* 消息面 */}
      {newsSignals.length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border-b border-slate-100">
            <Newspaper className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] font-bold text-slate-600">消息面 · 新闻关键词</span>
          </div>
          <div className="divide-y divide-slate-100">
            {newsSignals.map((s, i) => (
              <div key={i} className="px-3 py-2 flex items-start gap-2">
                <DirectionIcon dir={s.direction} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-slate-800 leading-relaxed">{s.label}</div>
                  <div className="text-[10px] text-slate-500 truncate mt-0.5">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 综合原因清单 */}
      {reasons.length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border-b border-slate-100">
            <Target className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] font-bold text-slate-600">综合判断 · 可能原因</span>
          </div>
          <div className="divide-y divide-slate-50">
            {reasons.map((r, i) => (
              <div key={i} className="px-3 py-1.5 flex items-center gap-2">
                <DirectionIcon dir={r.direction} />
                <span className="text-[10px] text-slate-500 w-9 shrink-0">{r.category}</span>
                <span className="flex-1 text-[11px] text-slate-800 leading-relaxed">{r.reason}</span>
                <ConfidenceBadge level={r.confidence} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 通用信号区块 */
function SignalSection({
  title,
  icon,
  signals,
}: {
  title: string;
  icon: React.ReactNode;
  signals: Array<{ label: string; detail: string; direction: 'bullish' | 'bearish' | 'neutral' }>;
}) {
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border-b border-slate-100">
        {icon}
        <span className="text-[11px] font-bold text-slate-600">{title}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {signals.map((s, i) => (
          <div key={i} className="px-3 py-1.5 flex items-start gap-2">
            <DirectionIcon dir={s.direction} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold text-slate-800">{s.label}</div>
              <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{s.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
