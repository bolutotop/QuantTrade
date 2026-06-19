import { NextRequest } from 'next/server';
import { placeTrade, type TradeSide } from '@/lib/portfolio';
import { fetchLivePrices } from '@/lib/live-price';

// =============================================================================
// /api/portfolio/trade
//   POST → 下单（buy / sell）
//
// 请求体：
//   {
//     side: 'buy'|'sell',
//     symbol: 'sh600519', code: '600519', name: '贵州茅台',
//     shares: 100,
//     // 二选一：
//     price: 1700.50,       // 手动指定成交价
//     useLivePrice: true,   // 由服务器取实时价撮合
//     note?: string
//   }
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  side: TradeSide;
  symbol: string;
  code: string;
  name: string;
  shares: number;
  price?: number;
  useLivePrice?: boolean;
  note?: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body || (body.side !== 'buy' && body.side !== 'sell')) {
    return Response.json({ error: 'side must be buy/sell' }, { status: 400 });
  }
  if (!body.symbol || !body.code || !body.name) {
    return Response.json({ error: 'symbol/code/name required' }, { status: 400 });
  }

  let price = Number(body.price);
  let usedLive = false;

  if (!Number.isFinite(price) || price <= 0 || body.useLivePrice) {
    const live = await fetchLivePrices([body.symbol]);
    const found = live.find((x) => x.symbol === body.symbol);
    if (!found || found.price <= 0) {
      return Response.json({ error: `获取 ${body.symbol} 实时价失败，请改为手动指定` }, { status: 502 });
    }
    price = found.price;
    usedLive = true;
  }

  try {
    const trade = placeTrade({
      side: body.side,
      symbol: body.symbol,
      code: body.code,
      name: body.name,
      shares: Math.floor(Number(body.shares)),
      price,
      note: body.note,
    });
    return Response.json({ trade, usedLivePrice: usedLive });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
