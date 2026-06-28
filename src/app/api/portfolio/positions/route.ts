import { NextRequest } from 'next/server';
import { listPositions } from '@/lib/portfolio';
import { fetchLivePriceMap } from '@/lib/live-price';
import { toUpstreamError } from '@/lib/upstream';

// =============================================================================
// /api/portfolio/positions
//   GET → 持仓列表（含实时价、浮盈）
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  try {
    const positions = listPositions();
    const symbols = positions.map((p) => p.symbol);
    const prices = symbols.length ? await fetchLivePriceMap(symbols) : {};
    const enriched = positions.map((p) => {
      const lastPrice = prices[p.symbol];
      if (typeof lastPrice === 'number' && lastPrice > 0 && p.shares > 0) {
        const marketValue = +(lastPrice * p.shares).toFixed(2);
        const floatingPnl = +(marketValue - p.cost).toFixed(2);
        const floatingPnlPct = p.cost > 0 ? +((floatingPnl / p.cost) * 100).toFixed(2) : 0;
        return { ...p, lastPrice, marketValue, floatingPnl, floatingPnlPct };
      }
      return p;
    });
    return Response.json({ items: enriched });
  } catch (e) {
    const { error, status } = toUpstreamError(e);
    return Response.json({ error }, { status });
  }
}
