// =============================================================================
// 腾讯财经行情适配器（备用源）
//
// 接口：https://qt.gtimg.cn/q=sh600519,r_hk00700,usAAPL.OQ
// 编码：GBK
// 字段：返回行形如 v_sh600519="51~贵州茅台~600519~1700.00~...";
//
// 当前不是默认 provider，仅作为容灾/对照实现。
// 若需切换：在 .env.local 设置 QUOTE_PROVIDER=tencent
// =============================================================================

import { safeFetch } from '@/lib/upstream';
import { parseSymbol } from '@/lib/markets';
import type { LiveQuote, QuoteProvider } from './types';

function toUpstreamKey(symbol: string): string | null {
  const s = symbol.toLowerCase();
  if (s.startsWith('sh') || s.startsWith('sz') || s.startsWith('bj')) return s;
  if (s.startsWith('hk')) return 'r_' + s;          // r_hk00700
  if (s.startsWith('us.')) return 'us' + s.slice(3).toUpperCase();
  return null;
}
function fromUpstreamKey(k: string): string {
  if (k.startsWith('r_hk')) return k.slice(2);
  if (k.startsWith('us')) return 'us.' + k.slice(2).toUpperCase();
  return k;
}

const num = (s?: string) => {
  if (s == null || s === '') return 0;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};

/**
 * 腾讯股票字段（部分）：
 *   0  未知
 *   1  名称
 *   2  代码
 *   3  当前价
 *   4  昨收
 *   5  开盘
 *   6  成交量（手 / 股，因市场而异）
 *   ...
 *   30 时间 yyyymmddHHMMSS
 *   31 涨跌额
 *   32 涨跌幅%
 *   33 最高
 *   34 最低
 */
function parseRow(symbol: string, body: string): LiveQuote | null {
  const f = body.split('~');
  if (f.length < 10) return null;
  const info = parseSymbol(symbol);
  if (!info) return null;
  const price = num(f[3]);
  const prevClose = num(f[4]);
  if (price <= 0) return null;
  const change = num(f[31]) || (prevClose ? +(price - prevClose).toFixed(3) : 0);
  const changePct = num(f[32]) || (prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0);
  const ts = f[30] ?? '';
  let date = '';
  let time = '';
  if (/^\d{14}$/.test(ts)) {
    date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    time = `${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}`;
  }
  return {
    symbol,
    name: f[1] || symbol,
    open: num(f[5]),
    prevClose,
    price,
    high: num(f[33]),
    low: num(f[34]),
    volume: num(f[6]),
    amount: num(f[37]) * 10000,    // 腾讯成交额单位是万元
    change,
    changePct,
    date,
    time,
    market: info.market,
  };
}

async function fetchQuotes(symbols: string[]): Promise<LiveQuote[]> {
  const out: LiveQuote[] = [];
  for (let i = 0; i < symbols.length; i += 80) {
    const batch = symbols.slice(i, i + 80);
    const keys: string[] = [];
    const keyToSym = new Map<string, string>();
    for (const s of batch) {
      const k = toUpstreamKey(s);
      if (!k) continue;
      keys.push(k);
      keyToSym.set(k, s);
    }
    if (keys.length === 0) continue;

    const url = `https://qt.gtimg.cn/q=${keys.join(',')}`;
    try {
      const r = await safeFetch(url, {
        headers: { Referer: 'https://stockapp.finance.qq.com/', 'User-Agent': 'Mozilla/5.0 QuantTrade/0.1' },
      }, 5000);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const text = new TextDecoder('gbk').decode(buf);
      const re = /v_([A-Za-z0-9_.]+)\s*=\s*"([^"]*)"/g;
      for (const m of text.matchAll(re)) {
        const key = m[1];
        const body = m[2];
        if (!body) continue;
        const symbol = keyToSym.get(key) ?? fromUpstreamKey(key);
        const q = parseRow(symbol, body);
        if (q) out.push(q);
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

export const tencentProvider: QuoteProvider = {
  name: 'tencent',
  fetchQuotes,
};
