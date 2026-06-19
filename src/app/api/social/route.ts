import { NextRequest } from 'next/server';

// =============================================================================
// /api/social — 反代到 sentiment-service (Python+MediaCrawler) 的舆情数据
//
// 数据流：
//   Browser -> /api/social?code=xxx
//             -> http://${SENTIMENT_SERVICE_URL}/api/posts?code=xxx
//
// 这是一个独立部署的 Python 服务（见仓库 /sentiment-service 子目录），
// 它内部跑 MediaCrawler 抓 B站 / 小红书 / 抖音 / 微博，并做关键词→股票映射。
//
// 当 SENTIMENT_SERVICE_URL 未配置或不可达时，返回空列表 + 提示，
// 前端会优雅降级显示"舆情服务未启动"，但不影响其他 Tab。
//
// 环境变量：SENTIMENT_SERVICE_URL  (默认 http://127.0.0.1:8787)
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CODE_RE = /^[0-9]{4,6}$/;

export type SocialPost = {
  id: string;
  platform: 'bilibili' | 'xhs' | 'douyin' | 'weibo' | 'kuaishou' | 'zhihu';
  type: 'video' | 'note' | 'comment' | 'post';
  title: string;
  content?: string;
  author?: string;
  url: string;
  time: string;
  ts: number;
  likes?: number;
  comments?: number;
  views?: number;
  sentiment?: -1 | 0 | 1;   // -1 负面 / 0 中性 / 1 正面
  sentimentScore?: number;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = (sp.get('code') ?? '').trim();
  const name = (sp.get('name') ?? '').trim();
  const limit = Math.max(1, Math.min(200, Number(sp.get('limit') ?? 40)));
  const platforms = sp.get('platforms')?.trim() || 'bilibili,xhs,weibo';

  if (!code) return Response.json({ error: 'code is required' }, { status: 400 });
  if (!CODE_RE.test(code)) return Response.json({ error: 'invalid code' }, { status: 400 });

  const base = process.env.SENTIMENT_SERVICE_URL || 'http://127.0.0.1:8787';
  const url = `${base.replace(/\/$/, '')}/api/posts?code=${code}&name=${encodeURIComponent(name)}&limit=${limit}&platforms=${platforms}`;

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      throw new Error(`upstream ${res.status}`);
    }
    const json = await res.json();
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    // 服务不可达 → 优雅降级
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({
      code,
      name,
      items: [] as SocialPost[],
      serviceAvailable: false,
      hint: `舆情服务未启动 (${base})。请按 sentiment-service/README.md 部署后再试。`,
      detail: msg,
    }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
