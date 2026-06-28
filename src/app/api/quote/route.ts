import { NextRequest } from 'next/server';
import { fetchQuotes } from '@/lib/quote-providers';
import { toUpstreamError } from '@/lib/upstream';

// =============================================================================
// /api/quote?code=sh000001,sh600519,hk00700,...
//
// 实时行情代理：透明走 quote-providers（默认 sina，可 env 切换）。
//
// 注意：返回字段名为兼容老前端（watchlist-view）：
//   - code         (其实是带前缀的 symbol，老命名沿用)
//   - name, open, prevClose, price, high, low, volume, amount,
//     date, time, change, changePct
//
// 现在新增支持港股：?code=hk00700 / ?code=00700（自动识别）
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { parseSymbol } from '@/lib/markets';

export async function GET(req: NextRequest) {
  const codeParam = req.nextUrl.searchParams.get('code') ?? '';
  const inputs = codeParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (inputs.length === 0) {
    return Response.json({ error: 'code is required, e.g. ?code=sh000001,sh600519,hk00700' }, { status: 400 });
  }
  if (inputs.length > 80) {
    return Response.json({ error: 'too many codes (max 80 per call)' }, { status: 400 });
  }

  // 把任意输入归一化为内部 symbol
  const symbols = inputs
    .map((c) => parseSymbol(c)?.symbol)
    .filter((s): s is string => !!s);

  try {
    const rows = await fetchQuotes(symbols);
    // 兼容老字段命名
    const out = rows.map((r) => ({
      code: r.symbol,
      name: r.name,
      open: r.open,
      prevClose: r.prevClose,
      price: r.price,
      high: r.high,
      low: r.low,
      bidPrice: 0,
      askPrice: 0,
      volume: r.volume,
      amount: r.amount,
      date: r.date ?? '',
      time: r.time,
      change: r.change,
      changePct: r.changePct,
      market: r.market,
    }));
    return new Response(JSON.stringify(out), {
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
