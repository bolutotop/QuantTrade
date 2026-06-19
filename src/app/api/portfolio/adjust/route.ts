import { NextRequest } from 'next/server';
import { adjustPosition } from '@/lib/portfolio';

// =============================================================================
// /api/portfolio/adjust
//   POST → 手动调整某只股票的持仓与成本价（典型场景：从其它软件同步过来）
//
// 请求体：
//   {
//     symbol: 'sh600519', code: '600519', name: '贵州茅台',
//     targetShares: 200,        // 目标股数（≥ 0；0 = 清仓）
//     targetCostPrice: 1700.5,  // 目标成本价（targetShares > 0 时必填）
//     syncCash?: false,         // 是否同步扣/补现金（默认 false）
//     note?: string
//   }
//
// 返回：写入的 adjust 流水（含 before 快照，便于撤销）
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  symbol: string;
  code: string;
  name: string;
  targetShares: number;
  targetCostPrice: number;
  syncCash?: boolean;
  note?: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || !body.symbol || !body.code || !body.name) {
    return Response.json({ error: 'symbol/code/name required' }, { status: 400 });
  }
  try {
    const trade = adjustPosition({
      symbol: body.symbol,
      code: body.code,
      name: body.name,
      targetShares: Number(body.targetShares),
      targetCostPrice: Number(body.targetCostPrice),
      syncCash: !!body.syncCash,
      note: body.note,
    });
    return Response.json({ trade });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
