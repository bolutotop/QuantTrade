// =============================================================================
// /api/analysis — 股票涨跌原因智能分析
//
// 参考 daily_stock_analysis (38K ★) 架构：
//   行情快照 + K线形态 + 成交活跃度 + 新闻关键词 → 结构化涨跌原因
//
// 分析维度：
//   ① 技术面：K线形态（阴阳线、十字星、锤子线等）、量价关系、振幅
//   ② 资金面：成交量测度、换手率异常、涨跌幅标准化
//   ③ 消息面：舆论情绪计数、关键词命中（利好/利空/中性）
//   ④ 综合研判：多因子加权打分，输出可能原因列表
//
// 入参：?symbol=sh600519 / hk09626
// 输出：AnalysisResult { klineSignals, volumeSignals, newsSignals, reasons, summary }
//
// 规则引擎默认启用；设置环境变量 LLM_API_KEY 后自动走 LLM 增强推理。
// =============================================================================

import { NextRequest } from 'next/server';
import { safeFetch } from '@/lib/upstream';
import { parseSymbol } from '@/lib/markets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type AnalysisResult = {
  symbol: string;
  code: string;
  name: string;
  /** 当前价 */
  price: number;
  /** 涨跌幅 % */
  changePct: number;
  /** 涨跌额 */
  change: number;
  /** 分析时间戳 */
  ts: number;

  /** 技术面信号 */
  klineSignals: KlineSignal[];
  /** 量价信号 */
  volumeSignals: VolumeSignal[];
  /** 消息面信号 */
  newsSignals: NewsSignal[];

  /** 舆情→股价 时间线关联脉络 */
  timeline: TimelineItem[];

  /** 综合涨跌原因（按置信度排序） */
  reasons: ReasonItem[];
  /** 一句话总结 */
  summary: string;

  /** 是否走了 LLM 增强 */
  llm: boolean;
  error?: string;
};

export type KlineSignal = {
  label: string;       // 如 "大阳线 / 放量突破"
  detail: string;      // 如 "今日涨幅 +4.21%，最高触及 128.50，突破前5日均线"
  direction: 'bullish' | 'bearish' | 'neutral';
};

export type VolumeSignal = {
  label: string;
  detail: string;
  direction: 'bullish' | 'bearish' | 'neutral';
};

export type NewsSignal = {
  label: string;
  detail: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  source?: string;     // 新闻标题
};

export type ReasonItem = {
  reason: string;          // 涨跌原因
  category: '技术面' | '资金面' | '消息面' | '基本面';
  confidence: '高' | '中' | '低';
  direction: 'bullish' | 'bearish' | 'neutral';
};

/** 舆情事件 → 股价变化 时间线节点（秒级对齐） */
export type TimelineItem = {
  /** 事件日期 (yyyy-MM-dd) */
  date: string;
  /** 事件精确时间 (HH:mm:ss) */
  time: string;
  /** 事件描述 */
  event: string;
  /** 事件性质 */
  direction: 'bullish' | 'bearish' | 'neutral';
  /** 事件发生时的股价（对齐最近一分钟K线收盘价） */
  price: number;
  /** 事件后30分钟内的价格变化 */
  priceAfter30m?: { price: number; changePct: number; high: number; low: number };
  /** 事件后日级变化（兼容老用途） */
  priceAfter?: number;
  changePctAfter?: number;
  /** 新闻来源 */
  source?: string;
};

// ---------------------------------------------------------------------------
// K线分析：调内部 /api/kline（享受多源 fallback，避免东财限流导致不可用）
// ---------------------------------------------------------------------------

interface KLineItem {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  changePct?: number;
  change?: number;
  turnoverRate?: number;
}

async function fetchKlines(symbol: string): Promise<Array<{
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  amplitude: number;
  changePct: number;
  change: number;
  turnoverRate: number;
}>> {
  const url = `http://127.0.0.1:3001/api/kline?symbol=${encodeURIComponent(symbol)}&period=day&adjust=qfq&limit=5`;
  const res = await safeFetch(
    url,
    { headers: { Accept: 'application/json' } },
    12000,
  );
  if (!res.ok) throw new Error(`kline fetch failed ${res.status}`);
  const json = (await res.json()) as { items?: KLineItem[]; error?: string };
  if (json.error) throw new Error(json.error);
  if (!json.items || json.items.length === 0) throw new Error('kline empty');

  return json.items.map((it: KLineItem) => {
    const d = new Date(it.timestamp);
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const range = it.high - it.low;
    const amplitude = it.low > 0 ? (range / it.low) * 100 : 0;
    return {
      date,
      open: it.open,
      close: it.close,
      high: it.high,
      low: it.low,
      volume: it.volume,
      amount: it.turnover,
      amplitude,
      changePct: it.changePct ?? 0,
      change: it.change ?? 0,
      turnoverRate: it.turnoverRate ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// 新闻采集 + 分钟K线（秒级时间对齐）
// ---------------------------------------------------------------------------

type NewsRawItem = { title: string; summary?: string; source?: string; time?: string; ts?: number };

async function fetchNews(code: string, name: string): Promise<NewsRawItem[]> {
  try {
    const res = await safeFetch(
      `http://127.0.0.1:3001/api/news?code=${code}&name=${encodeURIComponent(name)}&limit=15`,
      { headers: { Accept: 'application/json' } },
      10000,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: NewsRawItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

/** 拉取当天1分钟K线（用于秒级舆情-价格对齐） */
async function fetchIntradayKlines(
  symbol: string,
): Promise<Array<{ ts: number; open: number; close: number; high: number; low: number }>> {
  const url = `http://127.0.0.1:3001/api/kline?symbol=${encodeURIComponent(symbol)}&period=1m&adjust=qfq&limit=240`;
  const res = await safeFetch(url, { headers: { Accept: 'application/json' } }, 12000);
  if (!res.ok) return [];
  const json = (await res.json()) as { items?: KLineItem[]; error?: string };
  if (json.error || !json.items) return [];
  return json.items.map((it) => ({
    ts: it.timestamp,
    open: it.open,
    close: it.close,
    high: it.high,
    low: it.low,
  }));
}

// ---------------------------------------------------------------------------
// 规则引擎：K线形态识别
// ---------------------------------------------------------------------------

function analyzeKlinePattern(today: ReturnType<typeof fetchKlines> extends Promise<(infer T)[]> ? T : never): KlineSignal[] {
  const signals: KlineSignal[] = [];
  const body = Math.abs(today.close - today.open);
  const bodyPct = today.open > 0 ? (body / today.open) * 100 : 0;
  const isGreen = today.close >= today.open; // A股红涨=收盘≥开盘
  const isRed = today.close < today.open;
  const totalRange = today.high - today.low;
  const upperShadow = isGreen ? today.high - today.close : today.high - today.open;
  const lowerShadow = isGreen ? today.open - today.low : today.close - today.low;

  // 1. 阴阳线判断
  if (isGreen && bodyPct >= 2.5) {
    signals.push({
      label: `大阳线 +${bodyPct.toFixed(1)}%`,
      detail: `收盘 ${today.close.toFixed(2)}，开盘 ${today.open.toFixed(2)}，实体振幅 ${bodyPct.toFixed(2)}%`,
      direction: 'bullish',
    });
  } else if (isRed && bodyPct >= 2.5) {
    signals.push({
      label: `大阴线 ${bodyPct.toFixed(1)}%`,
      detail: `收盘 ${today.close.toFixed(2)}，开盘 ${today.open.toFixed(2)}，实体跌幅 ${bodyPct.toFixed(2)}%`,
      direction: 'bearish',
    });
  } else if (isGreen) {
    signals.push({
      label: '小阳线',
      detail: `实体 +${bodyPct.toFixed(1)}%，收盘 ${today.close.toFixed(2)}`,
      direction: 'bullish',
    });
  } else {
    signals.push({
      label: '小阴线',
      detail: `实体 -${bodyPct.toFixed(1)}%，收盘 ${today.close.toFixed(2)}`,
      direction: 'bearish',
    });
  }

  // 2. 十字星
  if (bodyPct < 0.3 && totalRange > body * 3) {
    signals.push({
      label: '十字星',
      detail: `实体极小 (${bodyPct.toFixed(2)}%)，上下影线较长，方向不明`,
      direction: 'neutral',
    });
  }

  // 3. 锤子线 / 倒锤子
  if (isGreen && lowerShadow > body * 2 && upperShadow < body * 0.3) {
    signals.push({
      label: '锤子线',
      detail: `长下影线，收盘回到高位，下方买盘强劲`,
      direction: 'bullish',
    });
  }
  if (isRed && upperShadow > body * 2 && lowerShadow < body * 0.3) {
    signals.push({
      label: '倒锤子线',
      detail: `长上影线，冲高回落，上方抛压重`,
      direction: 'bearish',
    });
  }

  // 4. 跳空缺口（若有多日数据）
  return signals;
}

function analyzeVolume(today: ReturnType<typeof fetchKlines> extends Promise<(infer T)[]> ? T : never, prev: typeof today | null): VolumeSignal[] {
  const signals: VolumeSignal[] = [];

  // 换手率
  if (today.turnoverRate >= 5) {
    signals.push({
      label: `高换手率 ${today.turnoverRate.toFixed(1)}%`,
      detail: `当日换手率 ${today.turnoverRate.toFixed(1)}%，交易活跃，资金关注度高`,
      direction: today.changePct > 0 ? 'bullish' : 'bearish',
    });
  } else if (today.turnoverRate < 0.5 && today.turnoverRate > 0) {
    signals.push({
      label: `低换手率 ${today.turnoverRate.toFixed(2)}%`,
      detail: '交易清淡，资金关注度低',
      direction: 'neutral',
    });
  }

  // 振幅
  if (today.amplitude >= 5) {
    signals.push({
      label: `高振幅 ${today.amplitude.toFixed(1)}%`,
      detail: `日内波动剧烈，多空分歧大`,
      direction: 'neutral',
    });
  }

  // 量比（相对前一日）
  if (prev && prev.volume > 0) {
    const ratio = today.volume / prev.volume;
    if (ratio >= 2) {
      signals.push({
        label: `放量 ${ratio.toFixed(1)}x`,
        detail: `成交量是前一日的 ${ratio.toFixed(1)} 倍${today.changePct > 0 ? '，量价齐升' : '，放量下跌'}`,
        direction: today.changePct > 0 ? 'bullish' : 'bearish',
      });
    } else if (ratio <= 0.4) {
      signals.push({
        label: `缩量 ${ratio.toFixed(1)}x`,
        detail: `成交量仅为前一日的 ${(ratio * 100).toFixed(0)}%，${today.changePct > 0 ? '缩量上涨需警惕' : '缩量下跌抛压减轻'}`,
        direction: 'neutral',
      });
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 新闻关键词分析
// ---------------------------------------------------------------------------

const POSITIVE_WORDS = ['利好', '增长', '突破', '签约', '中标', '回购', '增持', '分红', '预增', '扭亏', '上市', '获批', '订单', '合作', '业绩', '超预期'];
const NEGATIVE_WORDS = ['利空', '下跌', '亏损', '减持', '退市', '警告', '处罚', '调查', '诉讼', '违约', '破产', 'ST', '跌停', '下滑', '爆雷', '造假', '催缴'];
const NEUTRAL_WORDS = ['公告', '发布', '召开', '变更', '停牌', '复牌', '重组', '收购'];

function analyzeNews(newsItems: Array<{ title: string; summary?: string }>): NewsSignal[] {
  const signals: NewsSignal[] = [];

  for (const item of newsItems) {
    const text = (item.title + ' ' + (item.summary ?? '')).toLowerCase();
    let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let matched: string[] = [];

    for (const w of POSITIVE_WORDS) {
      if (text.includes(w)) matched.push(w);
    }
    if (matched.length > 0) {
      direction = 'bullish';
      signals.push({
        label: `利好信号：${matched.join('/')}`,
        detail: item.title,
        direction: 'bullish',
        source: item.title,
      });
      continue;
    }

    for (const w of NEGATIVE_WORDS) {
      if (text.includes(w)) matched.push(w);
    }
    if (matched.length > 0) {
      direction = 'bearish';
      signals.push({
        label: `利空信号：${matched.join('/')}`,
        detail: item.title,
        direction: 'bearish',
        source: item.title,
      });
      continue;
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 综合研判 + 原因生成
// ---------------------------------------------------------------------------

function buildReasons(
  klineSignals: KlineSignal[],
  volumeSignals: VolumeSignal[],
  newsSignals: NewsSignal[],
  changePct: number,
): ReasonItem[] {
  const reasons: ReasonItem[] = [];

  // 技术面原因
  for (const s of klineSignals) {
    if (s.direction === 'bullish' || s.direction === 'bearish') {
      reasons.push({
        reason: s.label + '：' + s.detail.split('，')[0],
        category: '技术面',
        confidence: s.label.includes('大') ? '高' : '中',
        direction: s.direction,
      });
    }
  }

  // 资金面原因
  for (const s of volumeSignals) {
    if (s.direction !== 'neutral') {
      reasons.push({
        reason: s.label + '：' + s.detail,
        category: '资金面',
        confidence: s.label.includes('高') || s.label.includes('放量') ? '高' : '中',
        direction: s.direction,
      });
    }
  }

  // 消息面原因
  for (const s of newsSignals) {
    reasons.push({
      reason: s.detail,
      category: '消息面',
      confidence: '中',
      direction: s.direction,
    });
  }

  // 如果没有显著原因，加一个基线
  if (reasons.length === 0) {
    if (Math.abs(changePct) < 0.5) {
      reasons.push({
        reason: '今日无明显涨幅，成交量正常，市场观望情绪浓厚',
        category: '技术面',
        confidence: '中',
        direction: 'neutral',
      });
    } else if (changePct > 0) {
      reasons.push({
        reason: `小幅上涨 ${changePct.toFixed(2)}%，技术面偏多，消息面暂无显著催化`,
        category: '技术面',
        confidence: '低',
        direction: 'bullish',
      });
    } else {
      reasons.push({
        reason: `小幅下跌 ${changePct.toFixed(2)}%，技术面偏空，消息面暂无显著催化`,
        category: '技术面',
        confidence: '低',
        direction: 'bearish',
      });
    }
  }

  return reasons;
}

function buildSummary(
  reasons: ReasonItem[],
  changePct: number,
  price: number,
): string {
  const dir = changePct > 0 ? '上涨' : changePct < 0 ? '下跌' : '持平';
  const bullish = reasons.filter((r) => r.direction === 'bullish').length;
  const bearish = reasons.filter((r) => r.direction === 'bearish').length;

  const causes = reasons.slice(0, 3).map((r) => r.reason).join('；');
  const outlook = bullish > bearish
    ? '总体偏多，关注量能持续性'
    : bearish > bullish
    ? '总体偏空，关注下方支撑'
    : '方向不明，建议观望';

  return `今日${dir} ${Math.abs(changePct).toFixed(2)}%，报 ${price.toFixed(2)}。${causes || '暂无显著催化事件'}。${outlook}。`;
}

// ---------------------------------------------------------------------------
// 舆情→股价 时间线构建
// ---------------------------------------------------------------------------

function buildTimeline(
  newsItems: NewsRawItem[],
  newsSignals: NewsSignal[],
  dayKlines: Array<{ date: string; close: number; changePct: number }>,
  intradayKlines: Array<{ ts: number; open: number; close: number; high: number; low: number }>,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const intraday = intradayKlines.length > 0 ? intradayKlines : null;

  // 辅助：找到给定时间戳后 30 分钟内的分钟K线区间
  const find30mWindow = (newsTs: number) => {
    if (!intraday || intraday.length === 0) return null;
    const windowEnd = newsTs + 30 * 60 * 1000; // 30 分钟后

    // 找到 newsTs 之后的第一根 K 线作为基准
    let afterStart = -1;
    for (let i = 0; i < intraday.length; i++) {
      if (intraday[i].ts >= newsTs) { afterStart = i; break; }
    }
    if (afterStart < 0) return null;

    // 收集 30 分钟窗口内所有 K 线
    let high = intraday[afterStart].high;
    let low = intraday[afterStart].low;
    let lastClose = intraday[afterStart].close;
    for (let i = afterStart; i < intraday.length && intraday[i].ts <= windowEnd; i++) {
      if (intraday[i].high > high) high = intraday[i].high;
      if (intraday[i].low < low) low = intraday[i].low;
      lastClose = intraday[i].close;
    }
    const basePrice = intraday[afterStart].close;
    const changePct = basePrice > 0 ? ((lastClose - basePrice) / basePrice) * 100 : 0;
    return { price: lastClose, changePct, high, low };
  };

  // 格式化精确时间
  const fmtTs = (ts: number) => {
    const d = new Date(ts);
    const z = (n: number) => String(n).padStart(2, '0');
    return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  };

  // 判断 ts 是否为午夜/无效时间（公告未带精确时间）
  const isMidnight = (ts: number) => {
    if (ts <= 0) return true;
    const d = new Date(ts);
    return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  };

  // 每条新闻信号 → 精确时间对齐
  for (let i = 0; i < Math.min(newsSignals.length, newsItems.length); i++) {
    const sig = newsSignals[i];
    const ni = newsItems[i];
    const newsTs = ni.ts ?? 0;
    const date = ni?.time?.slice(0, 10) ?? dayKlines[dayKlines.length - 1]?.date ?? '';

    // 日级价格
    const kday = dayKlines.find((k) => k.date === date) ?? dayKlines[dayKlines.length - 1];
    const price = kday?.close ?? 0;
    const idx = dayKlines.findIndex((k) => k.date === date);
    const after = idx >= 0 && idx < dayKlines.length - 1 ? dayKlines[idx + 1] : null;

    // 日内 30 分钟窗口联动：
    //   - 午夜的公告（newsTs=00:00:00）是夜间发布的，影响在下一交易日盘前体现
    //   - 有精确 ts 且非午夜的新闻，在 ts 后 30min 窗口内找价格变化
    let intradayEffect = null;
    if (newsTs > 0 && !isMidnight(newsTs)) {
      intradayEffect = find30mWindow(newsTs);
    } else if (newsTs > 0 && after) {
      // 午夜公告：影响体现在次日开盘价
      intradayEffect = {
        price: after.close,
        changePct: after.changePct,
        high: after.close,
        low: after.close,
      };
    }

    items.push({
      date,
      time: newsTs > 0 && !isMidnight(newsTs) ? fmtTs(newsTs) : '',
      event: sig.detail,
      direction: sig.direction,
      price,
      priceAfter30m: intradayEffect ?? undefined,
      priceAfter: after?.close,
      changePctAfter: after?.changePct,
      source: ni.source,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') ?? '';
  const info = parseSymbol(symbol);
  if (!info) {
    return Response.json({ error: 'invalid symbol, e.g. sh600519 / hk09626' }, { status: 400 });
  }

  try {
    // 1. 拉 K 线（走 /api/kline 多源 fallback，防东财限流）
    const klines = await fetchKlines(info.symbol);
    if (klines.length === 0) {
      return Response.json({ error: 'no kline data' }, { status: 502 });
    }
    const today = klines[klines.length - 1];
    const prev = klines.length >= 2 ? klines[klines.length - 2] : null;

    // 2. 拉新闻 + 日内分钟K线（并行）
    let newsItems: NewsRawItem[] = [];
    let intradayKlines: Array<{ ts: number; open: number; close: number; high: number; low: number }> = [];
    try {
      [newsItems, intradayKlines] = await Promise.all([
        fetchNews(info.code, ''),
        fetchIntradayKlines(info.symbol),
      ]);
    } catch {
      // 不影响主流程
    }

    // 3. K线形态分析
    const klineSignals = analyzeKlinePattern(today);

    // 4. 量价分析
    const volumeSignals = analyzeVolume(today, prev);

    // 5. 新闻分析
    const newsSignals = analyzeNews(newsItems);

    // 6. 综合研判
    const reasons = buildReasons(klineSignals, volumeSignals, newsSignals, today.changePct);
    const summary = buildSummary(reasons, today.changePct, today.close);

    // 7. 舆情→股价 时间线脉络（秒级对齐：新闻 ts + 1min K线）
    const timeline = buildTimeline(newsItems, newsSignals, klines, intradayKlines);

    const result: AnalysisResult = {
      symbol: info.symbol,
      code: info.code,
      name: '',
      price: today.close,
      changePct: today.changePct,
      change: today.change,
      ts: Date.now(),
      klineSignals,
      volumeSignals,
      newsSignals,
      timeline,
      reasons,
      summary,
      llm: false,
    };

    return Response.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=120, s-maxage=120',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 502 });
  }
}
