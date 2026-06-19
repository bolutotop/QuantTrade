import { NextRequest } from 'next/server';
import { adjustCash, listCashFlows } from '@/lib/portfolio';

// =============================================================================
// /api/portfolio/cash
//   GET  → 资金流水
//   POST → 入金 / 出金 / 重置
//          { type: 'deposit'|'withdraw'|'reset', amount: number, note?: string }
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ items: listCashFlows(200) });
}

export async function POST(req: NextRequest) {
  let body: { type: 'deposit' | 'withdraw' | 'reset'; amount?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || !['deposit', 'withdraw', 'reset'].includes(body.type)) {
    return Response.json({ error: 'type must be deposit/withdraw/reset' }, { status: 400 });
  }
  try {
    const ret = adjustCash(body.type, Number(body.amount ?? 0), body.note ?? null);
    return Response.json(ret);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
