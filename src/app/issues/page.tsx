'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, CheckCircle2, RotateCcw, Wrench, Image as ImageIcon,
  Calendar, User, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// =============================================================================
// /issues —— 问题看板
//
// 移植自 PriceOCR：左右两列「待修复 / 已修复」，移动端 Tab 切换。
// 走 /api/issues 系列接口（GET / PATCH / DELETE）。
// =============================================================================

type IssueStatus = 'OPEN' | 'RESOLVED';

type IssueDTO = {
  id: string;
  description: string;
  images: string[];
  status: IssueStatus;
  reporter: string | null;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export default function IssueBoardPage() {
  const [items, setItems] = useState<IssueDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolutionDraft, setResolutionDraft] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'open' | 'resolved'>('open');

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/issues', { cache: 'no-store' });
      const j: { items: IssueDTO[] } = await r.json();
      setItems(j.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openList = items.filter((i) => i.status === 'OPEN');
  const resolvedList = items.filter((i) => i.status === 'RESOLVED');

  const handleResolve = async (id: string) => {
    const note = (resolutionDraft[id] || '').trim();
    setBusyId(id);
    try {
      const r = await fetch(`/api/issues/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', resolution: note }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      await refresh();
    } catch (e) {
      alert('标记失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusyId(null);
    }
  };

  const handleReopen = async (id: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/issues/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reopen' }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      await refresh();
    } catch (e) {
      alert('重开失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirm = async (id: string) => {
    if (!confirm('确认这个问题已经修复完成吗？\n确认后该问题及上传的所有截图将被永久删除。')) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/issues/${id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      await refresh();
    } catch (e) {
      alert('删除失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusyId(null);
    }
  };

  const total = items.length;

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20">
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40 px-3 sm:px-5 flex items-center h-[60px] shadow-sm">
        <Link
          href="/"
          className="inline-flex items-center gap-1 -ml-2 px-2 py-2 rounded text-slate-600 hover:bg-slate-100 font-bold text-sm"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.5]" /> 返回
        </Link>
        <h1 className="text-base sm:text-lg font-black text-slate-800 tracking-tight ml-2">问题看板</h1>
        <p className="hidden sm:block ml-3 text-xs text-slate-500 font-medium border-l border-slate-300 pl-3 uppercase tracking-widest">
          ISSUE TRACKER
        </p>
        <button
          onClick={() => { setLoading(true); void refresh(); }}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-xs font-bold"
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} /> 刷新
        </button>
      </header>

      <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4">
        {/* 顶部统计 */}
        <div className="flex items-center gap-3">
          <Stat label="总数" value={total} colorClass="text-slate-800" border="border-slate-200" />
          <Stat label="待修复" value={openList.length} colorClass="text-amber-700" border="border-amber-200" tagClass="text-amber-500" />
          <Stat label="已修复" value={resolvedList.length} colorClass="text-emerald-700" border="border-emerald-200" tagClass="text-emerald-500" />
        </div>

        {/* 移动端 tab */}
        <div className="md:hidden flex p-1 bg-slate-200/60 rounded-lg">
          <button
            onClick={() => setActiveTab('open')}
            className={cn(
              'flex-1 py-2 text-sm font-bold rounded-md transition-all flex items-center justify-center gap-1.5',
              activeTab === 'open' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500',
            )}
          >
            待修复 <Pill n={openList.length} variant="amber" />
          </button>
          <button
            onClick={() => setActiveTab('resolved')}
            className={cn(
              'flex-1 py-2 text-sm font-bold rounded-md transition-all flex items-center justify-center gap-1.5',
              activeTab === 'resolved' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500',
            )}
          >
            已修复 <Pill n={resolvedList.length} variant="emerald" />
          </button>
        </div>

        {loading && items.length === 0 ? (
          <div className="text-center text-slate-400 py-12 text-sm">加载中…</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <section className={cn('space-y-3', activeTab === 'open' ? '' : 'hidden md:block')}>
              <div className="flex items-center justify-between border-b border-amber-200 pb-2">
                <h2 className="font-black text-amber-700 uppercase tracking-widest text-sm">待修复</h2>
                <span className="text-xs font-bold text-amber-500">{openList.length}</span>
              </div>
              {openList.length === 0
                ? <EmptyHint text="暂无待修复问题" />
                : openList.map((it) => (
                    <IssueCard
                      key={it.id}
                      issue={it}
                      busy={busyId === it.id}
                      resolutionDraft={resolutionDraft[it.id] || ''}
                      onResolutionChange={(v) => setResolutionDraft((p) => ({ ...p, [it.id]: v }))}
                      onResolve={() => handleResolve(it.id)}
                    />
                  ))}
            </section>

            <section className={cn('space-y-3', activeTab === 'resolved' ? '' : 'hidden md:block')}>
              <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
                <h2 className="font-black text-emerald-700 uppercase tracking-widest text-sm">已修复</h2>
                <span className="text-xs font-bold text-emerald-500">{resolvedList.length}</span>
              </div>
              {resolvedList.length === 0
                ? <EmptyHint text="暂无已修复问题" />
                : resolvedList.map((it) => (
                    <IssueCard
                      key={it.id}
                      issue={it}
                      busy={busyId === it.id}
                      onReopen={() => handleReopen(it.id)}
                      onConfirm={() => handleConfirm(it.id)}
                    />
                  ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------- 子组件 --------------------

function Stat({ label, value, colorClass, border, tagClass }: {
  label: string;
  value: number;
  colorClass: string;
  border: string;
  tagClass?: string;
}) {
  return (
    <div className={cn('bg-white rounded-md px-3 py-2 shadow-sm border', border)}>
      <div className={cn('text-[10px] uppercase tracking-widest font-bold', tagClass ?? 'text-slate-400')}>{label}</div>
      <div className={cn('text-xl font-black', colorClass)}>{value}</div>
    </div>
  );
}

function Pill({ n, variant }: { n: number; variant: 'amber' | 'emerald' }) {
  return (
    <span className={cn(
      'text-[10px] px-1.5 py-0.5 rounded-full font-black',
      variant === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700',
    )}>{n}</span>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="border-2 border-dashed border-slate-200 bg-white rounded-md p-8 text-center text-slate-400 text-xs font-bold tracking-widest uppercase">
      {text}
    </div>
  );
}

function IssueCard({
  issue, busy, resolutionDraft, onResolutionChange, onResolve, onReopen, onConfirm,
}: {
  issue: IssueDTO;
  busy: boolean;
  resolutionDraft?: string;
  onResolutionChange?: (v: string) => void;
  onResolve?: () => void;
  onReopen?: () => void;
  onConfirm?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = issue.status === 'OPEN';
  const created = new Date(issue.createdAt).toLocaleString('zh-CN', { hour12: false });
  const resolvedAt = issue.resolvedAt ? new Date(issue.resolvedAt).toLocaleString('zh-CN', { hour12: false }) : '';

  return (
    <article className={cn(
      'bg-white border rounded-md shadow-sm overflow-hidden',
      isOpen ? 'border-amber-200' : 'border-emerald-200',
    )}>
      <header className={cn(
        'px-3 py-2 flex items-center gap-2 text-xs',
        isOpen ? 'bg-amber-50/70' : 'bg-emerald-50/70',
      )}>
        <span className={cn(
          'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black tracking-widest uppercase',
          isOpen ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white',
        )}>
          {isOpen ? 'OPEN' : 'FIXED'}
        </span>
        <span className="font-mono text-[10px] text-slate-400">#{issue.id.slice(-6)}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-slate-500">
          <Calendar className="w-3 h-3" /> {created}
        </span>
      </header>

      <div className="p-3 space-y-3">
        <p className="text-sm text-slate-800 whitespace-pre-wrap font-medium leading-relaxed break-words">
          {issue.description}
        </p>

        {issue.reporter && (
          <div className="text-[10px] text-slate-400 inline-flex items-center gap-1">
            <User className="w-3 h-3" /> reporter: {issue.reporter}
          </div>
        )}

        {issue.images.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              截图 {issue.images.length} 张
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {expanded && (
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                {issue.images.map((url, idx) => (
                  <a
                    key={idx}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block border border-slate-200 rounded overflow-hidden bg-slate-50 hover:border-blue-400"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`截图${idx + 1}`} className="w-full h-24 object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {!isOpen && issue.resolution && (
          <div className="bg-emerald-50/70 border border-emerald-200 rounded p-2 text-xs text-emerald-800">
            <div className="font-black uppercase tracking-widest text-[10px] text-emerald-600 mb-1">修复说明</div>
            <p className="whitespace-pre-wrap">{issue.resolution}</p>
            {resolvedAt && <div className="text-[10px] text-emerald-500 mt-1.5">修复时间：{resolvedAt}</div>}
          </div>
        )}
      </div>

      <footer className={cn(
        'border-t px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2',
        isOpen ? 'border-amber-100 bg-amber-50/30' : 'border-emerald-100 bg-emerald-50/30',
      )}>
        {isOpen ? (
          <>
            <input
              value={resolutionDraft}
              onChange={(e) => onResolutionChange?.(e.target.value)}
              placeholder="可选：填写修复说明"
              className="h-8 text-xs flex-1 px-2 rounded border border-slate-200 focus:outline-none focus:border-blue-400"
            />
            <button
              onClick={onResolve}
              disabled={busy}
              className="h-8 px-3 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs disabled:opacity-50 inline-flex items-center"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Wrench className="w-3.5 h-3.5 mr-1" />}
              标记已修复
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onReopen}
              disabled={busy}
              className="h-8 px-3 rounded border border-slate-200 hover:bg-white text-xs font-bold text-slate-600 disabled:opacity-50 inline-flex items-center"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
              还有问题
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="h-8 px-3 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs ml-auto inline-flex items-center disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              确认完成 (清理)
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
