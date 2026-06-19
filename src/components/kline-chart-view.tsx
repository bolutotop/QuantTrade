'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  init,
  dispose,
  registerLocale,
  TooltipShowRule,
  TooltipShowType,
  type Chart,
  type KLineData,
} from 'klinecharts';
import { cn } from '@/lib/utils';
import {
  Loader2,
  BarChart3,
  Activity,
  RefreshCw,
  Maximize2,
  Minimize2,
} from 'lucide-react';

// =============================================================================
// KLineChartView —— 专业级 K 线图（基于 klinecharts v9）
//
// 设计原则（吸取 5 次失败教训）：
//   ① 官方文档明确 "init 调用时需要等待容器准备完成之后"。所以容器尺寸为 0
//      时绝不 init，而是 ResizeObserver 等到非零尺寸再 init。
//   ② "Chart Ready" 用 state 而非 ref 触发 load —— ref 改不会触发 effect 重跑。
//   ③ applyNewData 自带 clearData，不要重复调 clearData（v9 文档明示）。
//   ④ applyNewData 之后用 rAF 调 setBarSpace + scrollToTimestamp，强制激活
//      v9 内部 dataspace（v9 在容器从 0 到非 0 过渡后这个 cache 不会自动恢复）。
//   ⑤ 用单一 useState 把 init 和 load 串成确定性的路径，避免 effect 间 race。
// =============================================================================

let LOCALE_REGISTERED = false;
function ensureLocale() {
  if (LOCALE_REGISTERED) return;
  registerLocale('zh-CN', {
    time: '时间',
    open: '开',
    high: '高',
    low: '低',
    close: '收',
    volume: '成交量',
    change: '涨跌额',
    turnover: '成交额',
  });
  LOCALE_REGISTERED = true;
}

type Period = '1m' | '5m' | '15m' | '30m' | '60m' | 'day' | 'week' | 'month';
type Adjust = 'none' | 'qfq' | 'hfq';

const PERIODS: { key: Period; label: string }[] = [
  { key: '1m', label: '1分' },
  { key: '5m', label: '5分' },
  { key: '15m', label: '15分' },
  { key: '30m', label: '30分' },
  { key: '60m', label: '60分' },
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
];

const ADJUSTS: { key: Adjust; label: string }[] = [
  { key: 'qfq', label: '前复权' },
  { key: 'hfq', label: '后复权' },
  { key: 'none', label: '不复权' },
];

const SUB_INDICATORS = ['VOL', 'MACD', 'KDJ', 'RSI', 'BOLL', 'WR', 'OBV'] as const;
type SubIndicator = (typeof SUB_INDICATORS)[number];

const MAIN_INDICATORS = ['MA', 'EMA', 'BOLL', 'SAR'] as const;
type MainIndicator = (typeof MAIN_INDICATORS)[number];

const CANDLE_PANE_ID = 'candle_pane';

const CHART_STYLES = {
  grid: {
    horizontal: { color: '#E5E7EB' },
    vertical: { color: '#E5E7EB' },
  },
  candle: {
    bar: {
      upColor: '#DC2626',
      downColor: '#059669',
      upBorderColor: '#DC2626',
      downBorderColor: '#059669',
      upWickColor: '#DC2626',
      downWickColor: '#059669',
    },
    tooltip: {
      showRule: TooltipShowRule.Always,
      showType: TooltipShowType.Standard,
    },
    priceMark: {
      high: { color: '#DC2626' },
      low: { color: '#059669' },
      last: {
        upColor: '#DC2626',
        downColor: '#059669',
      },
    },
  },
  indicator: {
    bars: [{ upColor: '#DC2626', downColor: '#059669' }],
  },
  crosshair: {
    horizontal: {
      line: { color: '#94A3B8' },
      text: { backgroundColor: '#475569' },
    },
    vertical: {
      line: { color: '#94A3B8' },
      text: { backgroundColor: '#475569' },
    },
  },
  xAxis: { axisLine: { color: '#CBD5E1' }, tickText: { color: '#64748B' } },
  yAxis: { axisLine: { color: '#CBD5E1' }, tickText: { color: '#64748B' } },
};

export type KLineChartViewProps = {
  symbol: string;
  height?: number;
};

type ApiResp = {
  symbol: string;
  market: string;
  name: string;
  period: string;
  adjust: string;
  source?: string;
  count: number;
  items: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    turnover: number;
  }>;
  error?: string;
};

export default function KLineChartView({ symbol, height = 460 }: KLineChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const subPaneIdRef = useRef<string | null>(null);
  const mainSetRef = useRef<Set<MainIndicator>>(new Set(['MA']));
  // 兜底 resize 计时器集合，组件卸载时统一清理
  const pendingTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [period, setPeriod] = useState<Period>('day');
  const [adjust, setAdjust] = useState<Adjust>('qfq');
  const [subIndicator, setSubIndicator] = useState<SubIndicator>('VOL');
  const [mainSet, setMainSet] = useState<Set<MainIndicator>>(new Set(['MA']));
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [source, setSource] = useState<string>('');
  const [fullscreen, setFullscreen] = useState(false);
  // chartReady=true 触发 load effect。用 state 而非 ref 是关键。
  const [chartReady, setChartReady] = useState(false);

  // -----------------------------------------------------------------
  // 初始化：等容器有真实尺寸再 init
  //   官方文档：「init 调用时，需要等待容器准备完成之后」
  //   v9 在 0×0 容器初始化后即使后续 resize 也无法恢复 dataspace cache
  // -----------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    ensureLocale();

    let chart: Chart | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let cancelled = false;

    const doInit = () => {
      if (cancelled || chart) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;

      chart = init(el, { locale: 'zh-CN', styles: CHART_STYLES });
      if (!chart) return;
      chartRef.current = chart;

      // 默认主图叠加 MA
      chart.createIndicator('MA', false, { id: CANDLE_PANE_ID });
      // 默认副图 VOL
      subPaneIdRef.current = chart.createIndicator('VOL', false) ?? null;

      // 通知 load effect 可以拉数据了
      setChartReady(true);
    };

    // 等到下一帧再 init，让 layout / 滚动条出现等动作先收敛。
    // 这是规避 modal `overflow-y-auto` 滚动条出现导致容器宽度变化的关键。
    const rafId = requestAnimationFrame(() => {
      doInit();
    });

    // 用 ResizeObserver 监听：① 等待容器从 0×0 变成有尺寸 ② 后续容器尺寸变化时 resize 重绘
    resizeObserver = new ResizeObserver(() => {
      if (!chart) {
        doInit();
      } else {
        chart.resize();
      }
    });
    resizeObserver.observe(el);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      pendingTimeoutsRef.current.forEach((t) => clearTimeout(t));
      pendingTimeoutsRef.current = [];
      resizeObserver?.disconnect();
      if (containerRef.current && chart) {
        dispose(containerRef.current);
      }
      chartRef.current = null;
      chart = null;
      setChartReady(false);
    };
  }, []);

  // -----------------------------------------------------------------
  // 拉数据（chartReady=true 之后才执行；symbol/period/adjust 任一变更都重拉）
  // -----------------------------------------------------------------
  const load = useCallback(async () => {
    const chart = chartRef.current;
    if (!chart) return;

    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/kline?symbol=${encodeURIComponent(symbol)}&period=${period}&adjust=${adjust}&limit=500`,
        { cache: 'no-store' },
      );
      const json = (await res.json()) as ApiResp;
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const data: KLineData[] = json.items.map((it) => ({
        timestamp: it.timestamp,
        open: it.open,
        high: it.high,
        low: it.low,
        close: it.close,
        volume: it.volume,
        turnover: it.turnover,
      }));

      // 喂数据前 resize（拿到当前真实尺寸）
      chart.resize();
      // applyNewData 自带 clearData，不需要重复调用
      chart.applyNewData(data);

      setCount(data.length);
      setSource(json.source ?? '');

      // 多次 resize + scrollToTimestamp 兜底，覆盖：
      //   - 浏览器 layout pass 滞后（rAF）
      //   - modal overflow-y-auto 滚动条出现/消失的二次 reflow（50ms / 200ms）
      //   - 浏览器极端慢 layout（500ms）
      // KLineChart v9 的 visibleBarCount = totalBarSpace / barSpace，
      // 如果 totalBarSpace 在 applyNewData 时是 0，candle 就完全不画。
      // 多次 resize 强制 v9 重新 measurePaneWidth，触发 setTotalBarSpace
      // 进而调 adjustVisibleRange()，从根上修复 visible range。
      const lastTs = data.length > 0 ? data[data.length - 1].timestamp : 0;
      const recover = () => {
        const c = chartRef.current;
        if (!c) return;
        c.resize();
        c.setBarSpace(8);
        c.setOffsetRightDistance(60);
        if (lastTs > 0) {
          c.scrollToTimestamp(lastTs);
        }
      };
      requestAnimationFrame(() => {
        recover();
        requestAnimationFrame(recover);
      });
      const t1 = setTimeout(recover, 50);
      const t2 = setTimeout(recover, 200);
      const t3 = setTimeout(recover, 500);
      // 把 timeout id 挂到 ref 上以便 unmount 时清掉（这里用闭包简单实现）
      pendingTimeoutsRef.current.push(t1, t2, t3);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, period, adjust]);

  useEffect(() => {
    if (!chartReady) return;
    load();
  }, [chartReady, load]);

  // -----------------------------------------------------------------
  // 切换副图技术指标
  // -----------------------------------------------------------------
  const switchSub = useCallback((next: SubIndicator) => {
    if (!chartRef.current) return;
    if (subPaneIdRef.current) {
      chartRef.current.removeIndicator(subPaneIdRef.current);
    }
    const id = chartRef.current.createIndicator(next, false);
    subPaneIdRef.current = id ?? null;
    setSubIndicator(next);
  }, []);

  // -----------------------------------------------------------------
  // 主图叠加切换
  // -----------------------------------------------------------------
  const toggleMain = useCallback((name: MainIndicator) => {
    if (!chartRef.current) return;
    const set = new Set(mainSetRef.current);
    if (set.has(name)) {
      chartRef.current.removeIndicator(CANDLE_PANE_ID, name);
      set.delete(name);
    } else {
      chartRef.current.createIndicator(name, false, { id: CANDLE_PANE_ID });
      set.add(name);
    }
    mainSetRef.current = set;
    setMainSet(new Set(set));
  }, []);

  // -----------------------------------------------------------------
  // 全屏 / Esc 退出
  // -----------------------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => chartRef.current?.resize(), 80);
    return () => clearTimeout(t);
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const wrapperCls = fullscreen
    ? 'fixed inset-0 z-[60] bg-white flex flex-col'
    : 'flex flex-col';

  return (
    <div className={wrapperCls}>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 flex-wrap px-1 pb-2 border-b border-slate-100">
        <div className="inline-flex rounded-md overflow-hidden border border-slate-200 text-[11px] font-bold">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'px-2 py-1 transition-colors',
                period === p.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-md overflow-hidden border border-slate-200 text-[11px] font-bold">
          {ADJUSTS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAdjust(a.key)}
              className={cn(
                'px-2 py-1 transition-colors',
                adjust === a.key ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-1">
          <BarChart3 className="w-3 h-3 text-slate-400" />
          {MAIN_INDICATORS.map((n) => (
            <button
              key={n}
              onClick={() => toggleMain(n)}
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border transition-colors',
                mainSet.has(n)
                  ? 'bg-blue-50 text-blue-700 border-blue-300'
                  : 'text-slate-500 border-slate-200 hover:bg-slate-50',
              )}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-1 ml-1">
          <Activity className="w-3 h-3 text-slate-400" />
          {SUB_INDICATORS.map((n) => (
            <button
              key={n}
              onClick={() => switchSub(n)}
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border transition-colors',
                subIndicator === n
                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                  : 'text-slate-500 border-slate-200 hover:bg-slate-50',
              )}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-slate-400 font-mono">
            {loading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                加载中
              </span>
            ) : (
              <>共 {count} 根{source ? ` · ${source}` : ''}</>
            )}
          </span>
          <button
            onClick={() => load()}
            disabled={loading}
            className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setFullscreen((v) => !v)}
            className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100"
            title={fullscreen ? '退出全屏 (Esc)' : '全屏'}
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {err && (
        <div className="m-1 py-2 px-3 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
          ❌ {err}
        </div>
      )}

      {/* 图表容器：必须有显式 height，让 ResizeObserver 能尽快侦测到非零尺寸 */}
      <div
        ref={containerRef}
        className="w-full"
        style={{
          height: fullscreen ? 'calc(100vh - 80px)' : height,
          minHeight: 320,
        }}
      />

      <div className="px-1 pt-1 text-[10px] text-slate-400 flex items-center justify-between">
        <span>红涨绿跌（A 股惯例）· 多源自动 fallback（东财 → 新浪/腾讯）</span>
        {fullscreen && <span>按 Esc 退出全屏</span>}
      </div>
    </div>
  );
}
