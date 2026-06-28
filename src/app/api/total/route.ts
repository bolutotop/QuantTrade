import { NextRequest } from 'next/server';
import { safeFetch, toUpstreamError } from '@/lib/upstream';
import { fetchHKRanking, type HKNode } from '@/lib/hk-ranking';
import { VALID_NODE_SET as VALID_NODES, HK_NODE_SET as HK_NODES } from '@/lib/types';

// /api/total?node=hs_a -> { total: 5527 }
// A 股：新浪 Market_Center.getHQNodeStockCount
// 港股：东方财富 clist 同接口拿 total

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const node = req.nextUrl.searchParams.get('node') ?? 'hs_a';
  if (!VALID_NODES.has(node)) {
    return Response.json({ error: 'invalid node' }, { status: 400 });
  }

  if (HK_NODES.has(node)) {
    try {
      const { total } = await fetchHKRanking({ node: node as HKNode, page: 1, pageSize: 1 });
      return Response.json({ node, total });
    } catch (e) {
      const { error, status } = toUpstreamError(e);
      return Response.json({ error }, { status });
    }
  }

  try {
    const r = await safeFetch(
      `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=${node}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 QuantTrade/0.1',
          'Referer': 'https://finance.sina.com.cn/',
        },
      },
      4000,
    );
    if (!r.ok) return Response.json({ error: `upstream ${r.status}` }, { status: 502 });
    const buf = Buffer.from(await r.arrayBuffer());
    const text = new TextDecoder('gbk').decode(buf).replace(/^["']|["']$/g, '').trim();
    const total = parseInt(text, 10);
    return Response.json({ node, total: Number.isFinite(total) ? total : 0 });
  } catch (e) {
    const { error, status } = toUpstreamError(e);
    return Response.json({ error }, { status });
  }
}
