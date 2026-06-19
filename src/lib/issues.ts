// =============================================================================
// 问题反馈 业务层
//
// 移植自 PriceOCR 项目，做了三处改造以适配 QuantTrade：
//   1. Prisma → node:sqlite（与 portfolio 共用 .data/portfolio.db）
//   2. Server Action → 普通函数，由 API 路由调用
//   3. revalidatePath → 不需要，前端是 client component 自己拉
//
// 图片存储：项目根 .data/issue-uploads/<issueId>/<file>
//   - 不放 public/，避免 Next 静态托管的运行时新增问题
//   - 通过 /api/issue-images/<issueId>/<name> 路由对外
// =============================================================================

import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { prep } from './db';

export type IssueStatus = 'OPEN' | 'RESOLVED';

export type IssueDTO = {
  id: string;
  description: string;
  images: string[];
  status: IssueStatus;
  reporter: string | null;
  resolution: string | null;
  createdAt: string;             // ISO
  resolvedAt: string | null;
};

export const UPLOAD_ROOT = process.env.ISSUE_UPLOAD_DIR
  ? path.resolve(process.env.ISSUE_UPLOAD_DIR)
  : path.resolve(process.cwd(), '.data', 'issue-uploads');
export const IMAGE_URL_PREFIX = '/api/issue-images';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_COUNT = 5;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function genId(): string {
  return 'iss_' + randomBytes(4).toString('hex');
}

function safeParseImages(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

type Row = {
  id: string;
  description: string;
  images_json: string;
  status: string;
  reporter: string | null;
  resolution: string | null;
  created_at: number;
  resolved_at: number | null;
};

function toDTO(r: Row): IssueDTO {
  return {
    id: r.id,
    description: r.description,
    images: safeParseImages(r.images_json),
    status: r.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
    reporter: r.reporter,
    resolution: r.resolution,
    createdAt: new Date(r.created_at).toISOString(),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
  };
}

// ---------------------------- 创建 ----------------------------

export type CreateInput = {
  description: string;
  reporter?: string | null;
  files: File[];
};

export async function createIssue(input: CreateInput): Promise<{ id: string } | { error: string }> {
  const description = (input.description || '').trim();
  if (!description) return { error: '描述不能为空' };
  if (description.length > 2000) return { error: '描述过长（>2000）' };

  const files = (input.files ?? []).filter((f) => f instanceof File && f.size > 0);
  if (files.length > MAX_IMAGE_COUNT) return { error: `最多上传 ${MAX_IMAGE_COUNT} 张图片` };
  for (const f of files) {
    if (f.size > MAX_IMAGE_SIZE) return { error: `图片 ${f.name} 超过 5MB` };
    if (!ALLOWED_MIME.has(f.type)) return { error: `不支持的图片格式：${f.type || '未知'}` };
  }

  const id = genId();
  const now = Date.now();

  // 先建行，再写文件，最后回填 images_json
  prep(
    `INSERT INTO issues (id, description, images_json, status, reporter, created_at) VALUES (?, ?, '[]', 'OPEN', ?, ?)`
  ).run(id, description, input.reporter ?? null, now);

  if (files.length > 0) {
    const dir = path.join(UPLOAD_ROOT, id);
    await fs.mkdir(dir, { recursive: true });
    const urls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = (() => {
        const m = (f.name || '').match(/\.[a-zA-Z0-9]+$/);
        if (m) return m[0].toLowerCase();
        if (f.type === 'image/png') return '.png';
        if (f.type === 'image/webp') return '.webp';
        if (f.type === 'image/gif') return '.gif';
        return '.jpg';
      })();
      const filename = `${now}_${i}${ext}`;
      const filePath = path.join(dir, filename);
      const buf = Buffer.from(await f.arrayBuffer());
      await fs.writeFile(filePath, buf);
      urls.push(`${IMAGE_URL_PREFIX}/${id}/${filename}`);
    }
    prep(`UPDATE issues SET images_json=? WHERE id=?`).run(JSON.stringify(urls), id);
  }

  return { id };
}

// ---------------------------- 查询 ----------------------------

export function listIssues(): IssueDTO[] {
  // OPEN 在前；同状态按创建时间倒序
  const rows = prep(
    `SELECT * FROM issues
      ORDER BY CASE status WHEN 'OPEN' THEN 0 ELSE 1 END ASC,
               created_at DESC`
  ).all() as Row[];
  return rows.map(toDTO);
}

export function getIssue(id: string): IssueDTO | null {
  const r = prep(`SELECT * FROM issues WHERE id=?`).get(id) as Row | undefined;
  return r ? toDTO(r) : null;
}

// ---------------------------- 状态变更 ----------------------------

export function resolveIssue(id: string, resolution?: string): { ok: boolean; error?: string } {
  const trimmed = (resolution ?? '').trim() || null;
  const cur = prep(`SELECT id FROM issues WHERE id=?`).get(id);
  if (!cur) return { ok: false, error: '问题不存在' };
  prep(`UPDATE issues SET status='RESOLVED', resolved_at=?, resolution=? WHERE id=?`)
    .run(Date.now(), trimmed, id);
  return { ok: true };
}

export function reopenIssue(id: string): { ok: boolean; error?: string } {
  const cur = prep(`SELECT id FROM issues WHERE id=?`).get(id);
  if (!cur) return { ok: false, error: '问题不存在' };
  prep(`UPDATE issues SET status='OPEN', resolved_at=NULL WHERE id=?`).run(id);
  return { ok: true };
}

// ---------------------------- 删除（确认完成） ----------------------------

export async function confirmIssueDone(id: string): Promise<{ ok: boolean; error?: string }> {
  const r = prep(`SELECT status FROM issues WHERE id=?`).get(id) as { status: string } | undefined;
  if (!r) return { ok: false, error: '问题不存在' };
  if (r.status !== 'RESOLVED') return { ok: false, error: '只有已修复的问题才能确认完成' };

  prep(`DELETE FROM issues WHERE id=?`).run(id);

  const dir = path.join(UPLOAD_ROOT, id);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

  return { ok: true };
}
