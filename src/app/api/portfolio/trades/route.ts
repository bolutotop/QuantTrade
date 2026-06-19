import { NextRequest } from 'next/server';
import { listTrades, calcFees, getSettings, type TradeSide } from '@/lib/portfolio';

// =============================================================================
// /api/portfolio/trades
//   GET  → 交易流水
//        ?symbol=sh600519&limit=50&offset=0
//        ?preview=1&side=buy&symbol=sh600519&shares=100&price=1700
//          → 仅返回费用预估，不落库（下单前展示用）
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // 费用预估
  if (sp.get('preview') === '1') {
    const side = (sp.get('side') ?? '').toLowerCase() as TradeSide;
    const symbol = (sp.get('symbol') ?? '').trim();
    const shares = Number(sp.get('shares'));
    const price = Number(sp.get('price'));
    if ((side !== 'buy' && side !== 'sell') || !symbol || !Number.isFinite(shares) || !Number.isFinite(price)) {
      return Response.json({ error: 'side/symbol/shares/price required' }, { status: 400 });
    }
    try {
      const settings = getSettings();
      const fee = calcFees(side, symbol, shares, price, settings);
      return Response.json({ ...fee, settings });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }

  // 列表
  const symbol = sp.get('symbol')?.trim() || undefined;
  const limit = Number(sp.get('limit') ?? 100);
  const offset = Number(sp.get('offset') ?? 0);
  const items = listTrades({ symbol, limit, offset });
  return Response.json({ items });
}
