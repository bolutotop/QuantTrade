import { NextRequest } from 'next/server';
import { safeFetch, toUpstreamError } from '@/lib/upstream';
import { fetchHKRanking, type HKNode } from '@/lib/hk-ranking';

// =============================================================================
// /api/rank — 全市场实时排行榜
//
// A 股：走新浪 Market_Center.getHQNodeData（保持原行为）
// 港股：走东方财富 push2/clist
//
// query：
//   sort     = changepercent | trade | amount | volume | turnoverratio | mktcap
//   order    = desc | asc
//   page     = 1..N
//   pageSize = 1..200
//   node     = hs_a | hs_kcb | hs_cyb | sh_a | sz_a | bj_a | new_cb
//            | hk_all | hk_main | hk_gem | hk_blue | hk_red | hk_h
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface SinaRow {
  symbol: string;       // bj920000 / sh600519 / sz000001
  code: string;         // 600519
  name: string;
  trade: string;        // 现价（字符串）
  pricechange: number;  // 涨跌额
  changepercent: number;// 涨跌幅 %
  buy: string; sell: string;
  settlement: string;   // 昨收
  open: string; high: string; low: string;
  volume: number;       // 成交量（股）
  amount: number;       // 成交额（元）
  ticktime: string;
  mktcap?: number;      // 总市值（万元）
  nmc?: number;         // 流通市值
  turnoverratio?: number;// 换手率
}

interface Quote {
  symbol: string;
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  prevClose: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  marketCap: number;     // 元
  turnover: number;      // 换手率 %
  time: string;
}

const NUM = (s: string | number | undefined) => {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  if (typeof s !== 'string' || s === '') return 0;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
};

function toQuote(r: SinaRow): Quote {
  return {
    symbol: r.symbol,
    code: r.code,
    name: r.name,
    price: NUM(r.trade),
    change: NUM(r.pricechange),
    changePct: NUM(r.changepercent),
    open: NUM(r.open),
    prevClose: NUM(r.settlement),
    high: NUM(r.high),
    low: NUM(r.low),
    volume: NUM(r.volume),
    amount: NUM(r.amount),
    // mktcap 单位是「万元」，乘以 1e4 转成元
    marketCap: NUM(r.mktcap) * 1e4,
    turnover: NUM(r.turnoverratio),
    time: r.ticktime ?? '',
  };
}

const VALID_SORTS = new Set(['changepercent', 'trade', 'amount', 'volume', 'turnoverratio', 'mktcap']);
const VALID_NODES = new Set([
  'hs_a',    // 沪深 A 股
  'hs_kcb',  // 科创板
  'hs_cyb',  // 创业板
  'sh_a',    // 沪市 A 股
  'sz_a',    // 深市 A 股
  'bj_a',    // 北交所
  'new_cb',  // 可转债
  // 港股
  'hk_all', 'hk_main', 'hk_gem', 'hk_blue', 'hk_red', 'hk_h',
]);

const HK_NODES = new Set(['hk_all', 'hk_main', 'hk_gem', 'hk_blue', 'hk_red', 'hk_h']);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sort = sp.get('sort') ?? 'changepercent';
  const order = (sp.get('order') ?? 'desc').toLowerCase() === 'asc' ? '1' : '0';
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50));
  const node = sp.get('node') ?? 'hs_a';

  if (!VALID_SORTS.has(sort)) {
    return Response.json({ error: `sort must be one of: ${Array.from(VALID_SORTS).join(',')}` }, { status: 400 });
  }
  if (!VALID_NODES.has(node)) {
    return Response.json({ error: `node must be one of: ${Array.from(VALID_NODES).join(',')}` }, { status: 400 });
  }

  // ---------------- 港股分支 ----------------
  if (HK_NODES.has(node)) {
    try {
      const { items, total } = await fetchHKRanking({
        node: node as HKNode,
        sort,
        order: order === '1' ? 'asc' : 'desc',
        page,
        pageSize,
      });
      return new Response(JSON.stringify({
        node, sort, order: order === '1' ? 'asc' : 'desc',
        page, pageSize,
        items,
        total,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      const { error, status } = toUpstreamError(e);
      return Response.json({ error }, { status });
    }
  }

  // ---------------- A 股分支（保持原逻辑） ----------------
  const url = new URL('http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData');
  url.searchParams.set('page', String(page));
  url.searchParams.set('num', String(pageSize));
  url.searchParams.set('sort', sort);
  url.searchParams.set('asc', order);
  url.searchParams.set('node', node);
  url.searchParams.set('symbol', '');
  url.searchParams.set('_s_r_a', 'page');

  try {
    const res = await safeFetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 QuantTrade/0.1',
        'Referer': 'https://finance.sina.com.cn/',
      },
    }, 6000);
    if (!res.ok) {
      return Response.json({ error: `upstream ${res.status}` }, { status: 502 });
    }
    // 新浪返回 GBK
    const buf = Buffer.from(await res.arrayBuffer());
    const text = new TextDecoder('gbk').decode(buf);

    let raw: SinaRow[] = [];
    try {
      raw = JSON.parse(text);
      if (!Array.isArray(raw)) raw = [];
    } catch {
      // 有时新浪用 jsonp 返回，去掉外层包装
      const m = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (m) {
        try { raw = JSON.parse(m[0]); } catch { /* ignore */ }
      }
    }

    const items = raw.map(toQuote);

    return new Response(JSON.stringify({
      node, sort, order: order === '1' ? 'asc' : 'desc',
      page, pageSize,
      items,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const { error, status } = toUpstreamError(e);
    return Response.json({ error }, { status });
  }
}
