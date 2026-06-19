import { NextRequest } from 'next/server';
import { safeFetch, toUpstreamError } from '@/lib/upstream';
import { parseSymbol, type Market } from '@/lib/markets';

// =============================================================================
// /api/kline — 统一 K 线数据接口（多源 fallback）
//
// 数据源策略：
//   A 股 / 北交所:  ① 东方财富 push2his  →  ② 新浪 quotes.sina.cn
//   港股:          ① 东方财富 push2his  →  ② 腾讯 web.ifzq.gtimg.cn
//   美股:          ① 东方财富 push2his（暂未做 fallback）
//
// 单源 6s 超时；前一个失败/限流（fetch failed / 502 / 空数据）会自动切下一个。
// 这是因为东财对单 IP 高频请求会触发 schannel renegotiation 风暴 → fetch failed，
// 而新浪/腾讯有独立的限流策略，能在东财挂掉时兜住。
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// -----------------------------------------------------------------------------
// 共用类型 & 工具
// -----------------------------------------------------------------------------

export type KLineItem = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  changePct?: number;
  turnoverRate?: number;
};

type Period = '1m' | '5m' | '15m' | '30m' | '60m' | 'day' | 'week' | 'month';
type Adjust = 'none' | 'qfq' | 'hfq';

function num(s: string | undefined | null): number {
  if (s === undefined || s === null) return 0;
  const n = parseFloat(String(s));
  return Number.isFinite(n) ? n : 0;
}

// 把 "YYYY-MM-DD" / "YYYY-MM-DD HH:mm" / "YYYY-MM-DD HH:mm:ss" 解析成 ms（CST）
function parseDateCST(s: string): number {
  if (!s) return 0;
  let iso: string;
  if (s.includes(':')) {
    // 有时分：可能是 "YYYY-MM-DD HH:mm" 或 "YYYY-MM-DD HH:mm:ss"
    const [d, t] = s.split(/[ T]/);
    if (!d || !t) return 0;
    // 不带秒就补 :00
    const tFull = t.split(':').length === 2 ? `${t}:00` : t;
    iso = `${d}T${tFull}+08:00`;
  } else {
    // 仅日期：用 09:30 作为开盘时刻（确保同一天多条排序稳定）
    iso = `${s}T09:30:00+08:00`;
  }
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

// -----------------------------------------------------------------------------
// 源 1：东方财富 push2his（多市场全周期）
// -----------------------------------------------------------------------------

const EM_KLT: Record<Period, number> = {
  '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60,
  day: 101, week: 102, month: 103,
};
const EM_FQT: Record<Adjust, number> = { none: 0, qfq: 1, hfq: 2 };

function emSecId(market: Market, code: string): string {
  switch (market) {
    case 'SH': return `1.${code}`;
    case 'SZ': return `0.${code}`;
    case 'BJ': return `0.${code}`;
    case 'HK': return `116.${code}`;
    case 'US': return `105.${code}`;
    default:   return `0.${code}`;
  }
}

type EmKlineResp = {
  data?: { name?: string; klines?: string[] } | null;
};

async function fetchFromEastmoney(
  market: Market,
  code: string,
  period: Period,
  adjust: Adjust,
  limit: number,
): Promise<{ name: string; items: KLineItem[] }> {
  const url =
    'https://push2his.eastmoney.com/api/qt/stock/kline/get?' +
    new URLSearchParams({
      secid: emSecId(market, code),
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt: String(EM_KLT[period]),
      fqt: String(EM_FQT[adjust]),
      end: '20991231',
      lmt: String(limit),
    }).toString();

  const res = await safeFetch(
    url,
    {
      headers: {
        Referer: 'https://quote.eastmoney.com/',
        Accept: 'application/json,text/plain,*/*',
      },
    },
    6000, // 短超时，失败快速切源
  );
  if (!res.ok) throw new Error(`eastmoney ${res.status}`);
  const json = (await res.json()) as EmKlineResp;
  const klines = json?.data?.klines;
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error('eastmoney empty');
  }

  const items: KLineItem[] = [];
  for (const line of klines) {
    const p = line.split(',');
    if (p.length < 6) continue;
    const ts = parseDateCST(p[0]);
    if (!ts) continue;
    items.push({
      timestamp: ts,
      open: num(p[1]),
      close: num(p[2]),
      high: num(p[3]),
      low: num(p[4]),
      volume: num(p[5]),
      turnover: num(p[6]),
      changePct: p[8] !== undefined ? num(p[8]) : undefined,
      turnoverRate: p[10] !== undefined ? num(p[10]) : undefined,
    });
  }
  return { name: json.data?.name ?? '', items };
}

// -----------------------------------------------------------------------------
// 源 2a：新浪（A 股 / 北交所）
//   /CN_MarketDataService.getKLineData?symbol=sh688478&scale=240&ma=no&datalen=300
//   scale: 5/15/30/60 分钟，240=日，1200=周，7200=月
// -----------------------------------------------------------------------------

const SINA_SCALE: Record<Period, number | null> = {
  '1m': 5,    // 新浪没有 1 分钟，最小 5 分钟（用 5 分钟代替）
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '60m': 60,
  day: 240,
  week: 1200,
  month: 7200,
};

type SinaRow = {
  day: string;          // "2026-06-19" 或 "2026-06-19 09:35:00"
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

async function fetchFromSina(
  market: Market,
  code: string,
  period: Period,
  limit: number,
): Promise<{ name: string; items: KLineItem[] }> {
  if (market === 'HK' || market === 'US') {
    throw new Error('sina does not support HK/US kline');
  }
  const scale = SINA_SCALE[period];
  if (!scale) throw new Error(`sina period ${period} unsupported`);

  // 新浪 symbol: sh/sz/bj + 6 位代码
  const prefix = market === 'SH' ? 'sh' : market === 'BJ' ? 'bj' : 'sz';
  const sinaSymbol = `${prefix}${code}`;
  const url =
    `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?` +
    `symbol=${sinaSymbol}&scale=${scale}&ma=no&datalen=${Math.min(1023, limit)}`;

  const res = await safeFetch(
    url,
    {
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        Accept: 'application/json,text/plain,*/*',
      },
    },
    6000,
  );
  if (!res.ok) throw new Error(`sina ${res.status}`);
  const text = await res.text();
  // 新浪偶尔返回 `null` 字符串
  if (!text || text.trim() === 'null') throw new Error('sina empty');

  const arr = JSON.parse(text) as SinaRow[];
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('sina empty');

  const items: KLineItem[] = [];
  for (const r of arr) {
    const ts = parseDateCST(r.day);
    if (!ts) continue;
    items.push({
      timestamp: ts,
      open: num(r.open),
      high: num(r.high),
      low: num(r.low),
      close: num(r.close),
      volume: num(r.volume),
      // 新浪不返回 turnover，留 0；前端用不到也无碍
      turnover: 0,
    });
  }
  return { name: '', items };
}

// -----------------------------------------------------------------------------
// 源 2b：腾讯（港股专用）
//   /appstock/app/hkfqkline/get?_var=kline_dayqfq&param=hk09626,day,,,500,qfq
//   返回 JSONP 格式，需要 strip 变量名前缀
// -----------------------------------------------------------------------------

const TX_PERIOD: Record<Period, string | null> = {
  '1m': null, '5m': null, '15m': null, '30m': null, '60m': null,  // 腾讯港股端点不支持分钟
  day: 'day', week: 'week', month: 'month',
};

const TX_FQ: Record<Adjust, string> = { none: '', qfq: 'qfq', hfq: 'hfq' };

async function fetchFromTencentHK(
  code: string,
  period: Period,
  adjust: Adjust,
  limit: number,
): Promise<{ name: string; items: KLineItem[] }> {
  const txPeriod = TX_PERIOD[period];
  if (!txPeriod) throw new Error(`tencent HK period ${period} unsupported`);
  // 腾讯港股不支持 none，统一退化到 qfq（最常见的需求）
  const fq = adjust === 'none' ? 'qfq' : TX_FQ[adjust] || 'qfq';
  const sym = `hk${code}`;
  // 注意：腾讯字段名顺序是 fq + period，不是 period + fq
  // 例如：qfqday / qfqweek / qfqmonth / hfqday
  const fieldName = `${fq}${txPeriod}`;
  const varName = `kline_${txPeriod}${fq}`;
  const url =
    `https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?` +
    `_var=${varName}&param=${sym},${txPeriod},,,${limit},${fq}`;

  const res = await safeFetch(
    url,
    {
      headers: {
        Referer: 'https://gu.qq.com/',
        Accept: 'application/json,text/plain,*/*',
      },
    },
    6000,
  );
  if (!res.ok) throw new Error(`tencent ${res.status}`);
  const text = await res.text();
  const eq = text.indexOf('=');
  if (eq < 0) throw new Error('tencent bad jsonp');
  const json = JSON.parse(text.slice(eq + 1));
  if (json.code !== 0) throw new Error(`tencent ${json.msg || 'err'}`);

  const stockData = json.data?.[sym];
  if (!stockData) throw new Error('tencent no data block');

  // 优先取复权字段（qfqday / hfqday），降级到原始 day
  const rows: unknown[] =
    (Array.isArray(stockData[fieldName]) && stockData[fieldName].length > 0
      ? stockData[fieldName]
      : Array.isArray(stockData[txPeriod]) && stockData[txPeriod].length > 0
      ? stockData[txPeriod]
      : []) as unknown[];
  if (rows.length === 0) throw new Error('tencent empty');

  const items: KLineItem[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    // [date, open, close, high, low, volume, ...]
    const ts = parseDateCST(String(r[0]));
    if (!ts) continue;
    items.push({
      timestamp: ts,
      open: num(String(r[1])),
      close: num(String(r[2])),
      high: num(String(r[3])),
      low: num(String(r[4])),
      volume: num(String(r[5])),
      turnover: 0,
    });
  }
  return { name: stockData.qt?.[sym]?.[1] ?? '', items };
}

// -----------------------------------------------------------------------------
// 入口：多源 fallback
// -----------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const raw = (sp.get('symbol') || sp.get('code') || '').trim();
  const period = ((sp.get('period') || 'day').toLowerCase()) as Period;
  const adjust = ((sp.get('adjust') || 'qfq').toLowerCase()) as Adjust;
  const limitRaw = parseInt(sp.get('limit') || '500', 10);
  const limit = Math.min(1500, Math.max(20, Number.isFinite(limitRaw) ? limitRaw : 500));

  if (!raw) return Response.json({ error: 'symbol is required' }, { status: 400 });

  const info = parseSymbol(raw);
  if (!info) return Response.json({ error: 'invalid symbol' }, { status: 400 });

  if (!(period in EM_KLT)) {
    return Response.json(
      { error: `invalid period "${period}", expect 1m/5m/15m/30m/60m/day/week/month` },
      { status: 400 },
    );
  }
  if (!(adjust in EM_FQT)) {
    return Response.json(
      { error: `invalid adjust "${adjust}", expect none/qfq/hfq` },
      { status: 400 },
    );
  }

  // 按市场决定 provider 列表
  const providers: Array<{
    name: string;
    run: () => Promise<{ name: string; items: KLineItem[] }>;
  }> = [
    {
      name: 'eastmoney',
      run: () => fetchFromEastmoney(info.market, info.code, period, adjust, limit),
    },
  ];
  if (info.market === 'HK') {
    providers.push({
      name: 'tencent',
      run: () => fetchFromTencentHK(info.code, period, adjust, limit),
    });
  } else if (info.market === 'SH' || info.market === 'SZ' || info.market === 'BJ') {
    providers.push({
      name: 'sina',
      run: () => fetchFromSina(info.market, info.code, period, limit),
    });
  }

  const errors: string[] = [];
  for (const p of providers) {
    try {
      const { name, items } = await p.run();
      if (items.length === 0) {
        errors.push(`${p.name}: empty`);
        continue;
      }
      items.sort((a, b) => a.timestamp - b.timestamp);
      // 去重（同一秒可能产生重复，klinecharts 不喜欢）
      const dedup: KLineItem[] = [];
      let lastTs = -1;
      for (const it of items) {
        if (it.timestamp !== lastTs) {
          dedup.push(it);
          lastTs = it.timestamp;
        }
      }

      return new Response(
        JSON.stringify({
          symbol: info.symbol,
          market: info.market,
          name,
          period,
          adjust,
          source: p.name,
          count: dedup.length,
          items: dedup,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': period.endsWith('m')
              ? 'public, max-age=15'
              : 'public, max-age=60',
          },
        },
      );
    } catch (e) {
      errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
      // 继续下一个 provider
    }
  }

  // 全部失败
  const { error, status } = toUpstreamError(new Error(errors.join(' | ')));
  return Response.json(
    {
      error: `all providers failed: ${error}`,
      symbol: info.symbol,
      attempts: errors,
    },
    { status },
  );
}
