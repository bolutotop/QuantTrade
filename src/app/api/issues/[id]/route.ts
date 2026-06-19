import { NextRequest } from 'next/server';
import { resolveIssue, reopenIssue, confirmIssueDone, getIssue } from '@/lib/issues';

// =============================================================================
// /api/issues/[id]
//   GET    → 单条
//   PATCH  → { action: 'resolve'|'reopen', resolution? }
//   DELETE → 确认完成（仅 RESOLVED 可删，删除时清理图片目录）
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const it = getIssue(id);
  if (!it) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(it);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { action?: string; resolution?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (body.action === 'resolve') {
    const r = resolveIssue(id, body.resolution);
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    return Response.json({ ok: true });
  }
  if (body.action === 'reopen') {
    const r = reopenIssue(id);
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'action must be resolve / reopen' }, { status: 400 });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await confirmIssueDone(id);
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ ok: true });
}
