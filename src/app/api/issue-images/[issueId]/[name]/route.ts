import { NextRequest } from 'next/server';
import path from 'node:path';
import fs from 'node:fs/promises';
import { UPLOAD_ROOT } from '@/lib/issues';

// =============================================================================
// 反馈截图图片服务
//   GET /api/issue-images/<issueId>/<name>
// 数据存放于：.data/issue-uploads/<issueId>/<name>
// 不放在 public/，避免 Next 静态托管对运行时新增文件的兼容问题。
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function isSafe(s: string): boolean {
  return !!s && !s.includes('..') && SAFE_SEGMENT.test(s);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ issueId: string; name: string }> },
) {
  const { issueId, name } = await params;
  if (!isSafe(issueId) || !isSafe(name)) {
    return new Response('Bad Request', { status: 400 });
  }
  const ext = path.extname(name).toLowerCase();
  const mime = ALLOWED_EXT[ext];
  if (!mime) return new Response('Unsupported Media Type', { status: 415 });

  const filePath = path.join(UPLOAD_ROOT, issueId, name);
  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(buf.length),
      'Cache-Control': 'private, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
