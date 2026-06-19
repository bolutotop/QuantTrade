// =============================================================================
// 新浪财经行情适配器
//
// 接口：https://hq.sinajs.cn/list=sh600519,sz000001,rt_hk00700
// 必要 Header：Referer https://finance.sina.com.cn 否则返回空体
// 编码：GBK
//
// 新浪不同市场的 key 前缀：
//   A 股：sh / sz / bj                → 内部 symbol 直接拼
//   港股：rt_hk0xxxx                  → 内部 hk00700 → 上游 rt_hk00700
//   美股：gb_<lowercase ticker>       → 暂未启用
// =============================================================================

import { safeFetch } from '@/lib/upstream';
import { parseSymbol, type Market } from '@/lib/markets';
import type { LiveQuote, QuoteProvider } from './types';

function toUpstreamKey(symbol: string): string | null {
  const s = symbol.toLowerCase();
  if (s.startsWith('sh') || s.startsWith('sz') || s.startsWith('bj')) return s;
  if (s.startsWith('hk')) return 'rt_' + s;        // 港股
  if (s.startsWith('us.')) return 'gb_' + s.slice(3).toLowerCase();
  return null;
}

function fromUpstreamKey(key: string): string {
  const k = key.toLowerCase();
  if (k.startsWith('rt_hk')) return k.slice(3);    // rt_hk00700 → hk00700
  if (k.startsWith('gb_')) return 'us.' + k.slice(3).toUpperCase();
  return k;
}

const num = (s?: string) => {
  if (s == null || s === '') return 0;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};

/** A 股 hq_str 字段（33 字段）：name,open,prevClose,price,high,low,bid,ask,vol,amount,...,date,time */
function parseCN(market: Market, symbol: string, fields: string[]): LiveQuote | null {
  if (fields.length < 6 || !fields[0]) return null;
  const price = num(fields[3]);
  const prevClose = num(fields[2]);
  const date = (fields.find((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)) ?? '').trim();
  const time = (fields.find((s) => /^\d{2}:\d{2}:\d{2}$/.test(s)) ?? '').trim();
  return {
    symbol,
    name: fields[0],
    open: num(fields[1]),
    prevClose,
    price,
    high: num(fields[4]),
    low: num(fields[5]),
    volume: num(fields[8]),
    amount: num(fields[9]),
    change: prevClose ? +(price - prevClose).toFixed(3) : 0,
    changePct: prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0,
    date,
    time,
    market,
  };
}

/**
 * 港股 hq_str_rt_hkXXXXX 实测字段（2026 年）：
 *   0:英文名 1:中文名
 *   2:开盘 3:昨收 4:最高 5:最低 6:现价 7:涨跌额 8:涨跌幅%
 *   9:买一 10:卖一
 *   11:成交额(港币) 12:成交量(股)
 *   13..16: 其它（PE/52周/...）
 *   17:日期(yyyy/mm/dd) 18:时间(HH:mm:ss)
 */
function parseHK(symbol: string, fields: string[]): LiveQuote | null {
  if (fields.length < 9 || (!fields[0] && !fields[1])) return null;
  const name = fields[1] || fields[0];
  const open = num(fields[2]);
  const prevClose = num(fields[3]);
  const high = num(fields[4]);
  const low = num(fields[5]);
  const price = num(fields[6]);
  if (price <= 0) return null;
  const change = num(fields[7]) || (prevClose ? +(price - prevClose).toFixed(3) : 0);
  const changePct = num(fields[8]) || (prevClose ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : 0);
  // 注：11=金额，12=股数；如果新浪未来调整字段会变
  const amount = num(fields[11]);
  const volume = num(fields[12]);

  // 找时间：完整时间戳 "2026/06/18" + "16:08:08"
  let date = '';
  let time = '';
  for (const f of fields) {
    const md = f.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (md && !date) {
      date = `${md[1]}-${md[2].padStart(2, '0')}-${md[3].padStart(2, '0')}`;
      continue;
    }
    const mt = f.match(/^\d{1,2}:\d{2}(?::\d{2})?$/);
    if (mt && !time) time = f.length === 5 ? f + ':00' : f;
  }

  return {
    symbol, name,
    open, prevClose, price, high, low,
    volume, amount,
    change: +change.toFixed(3),
    changePct: +changePct.toFixed(2),
    date, time,
    market: 'HK',
  };
}

async function fetchQuotes(symbols: string[]): Promise<LiveQuote[]> {
  const out: LiveQuote[] = [];
  // 80 一批
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

    const url = `https://hq.sinajs.cn/list=${keys.join(',')}`;
    try {
      const r = await safeFetch(url, {
        headers: {
          Referer: 'https://finance.sina.com.cn',
          'User-Agent': 'Mozilla/5.0 QuantTrade/0.1',
        },
      }, 5000);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const text = new TextDecoder('gbk').decode(buf);

      const re = /var\s+hq_str_([A-Za-z0-9_.]+)\s*=\s*"([^"]*)"/g;
      for (const m of text.matchAll(re)) {
        const key = m[1];
        const body = m[2];
        if (!body) continue;
        const fields = body.split(',');
        const symbol = keyToSym.get(key) ?? fromUpstreamKey(key);
        const info = parseSymbol(symbol);
        if (!info) continue;
        let q: LiveQuote | null = null;
        if (info.market === 'HK') q = parseHK(symbol, fields);
        else if (info.market === 'SH' || info.market === 'SZ' || info.market === 'BJ') {
          q = parseCN(info.market, symbol, fields);
        }
        // US 暂不解析
        if (q) out.push(q);
      }
    } catch {
      /* 单批失败不影响其余 */
    }
  }
  return out;
}

export const sinaProvider: QuoteProvider = {
  name: 'sina',
  fetchQuotes,
};
