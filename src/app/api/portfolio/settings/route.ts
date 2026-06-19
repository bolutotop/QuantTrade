import { NextRequest } from 'next/server';
import { getSettings, updateSettings, type Settings } from '@/lib/portfolio';

// =============================================================================
// /api/portfolio/settings
//   GET   → 当前费率/规则配置
//   PATCH → 部分更新（字段同 Settings）
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return Response.json(getSettings());
}

export async function PATCH(req: NextRequest) {
  let body: Partial<Settings>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  try {
    const next = updateSettings(body ?? {});
    return Response.json(next);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
