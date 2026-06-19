import { NextRequest } from 'next/server';
import { revertTrade } from '@/lib/portfolio';

// =============================================================================
// /api/portfolio/trades/revert
//   POST { id } → 撤销一条 adjust 流水
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: { id?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const id = Number(body?.id);
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ error: 'id required' }, { status: 400 });
  }
  try {
    const ret = revertTrade(id);
    return Response.json(ret);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
