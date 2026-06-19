import { NextRequest } from 'next/server';
import { createIssue, listIssues } from '@/lib/issues';

// =============================================================================
// /api/issues
//   GET  → 列表
//   POST → 创建（multipart/form-data：description, reporter, images[]）
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ items: listIssues() });
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'expect multipart/form-data' }, { status: 400 });
  }
  const description = (form.get('description') as string) ?? '';
  const reporter = (form.get('reporter') as string) ?? null;
  const files = form.getAll('images').filter((v): v is File => v instanceof File);

  const ret = await createIssue({ description, reporter, files });
  if ('error' in ret) return Response.json({ error: ret.error }, { status: 400 });
  return Response.json({ id: ret.id });
}
