import { NextRequest } from 'next/server';
import { buildAccountView, listPositions } from '@/lib/portfolio';
import { fetchLivePriceMap } from '@/lib/live-price';

// =============================================================================
// /api/portfolio
//   GET  → 账户总览（现金 + 持仓 + 浮盈/已实现 + 资产）
//
// 自动注入实时价计算市值。
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  try {
    const positions = listPositions();
    const symbols = positions.map((p) => p.symbol);
    const prices = symbols.length ? await fetchLivePriceMap(symbols) : {};
    const view = buildAccountView(prices);
    return new Response(JSON.stringify(view), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
