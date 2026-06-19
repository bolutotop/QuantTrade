'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, MessageSquare, Send, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// =============================================================================
// FeedbackFab —— 浮动「问题反馈」按钮 + 弹窗
//
// 移植自 PriceOCR，使用原生 Tailwind（不依赖 shadcn）：
//   - 右下角圆角胶囊；移动端在 tabbar 上方（bottom-20），PC 在 bottom-6
//   - 点击弹窗：文字描述 + 1~5 张截图（每张 ≤ 5MB）
//   - 提交成功后跳转到 /issues 看板
// =============================================================================

const REPORTER_KEY = 'quanttrade_issue_reporter';

function getOrCreateReporter(): string {
  if (typeof window === 'undefined') return '';
  let v = localStorage.getItem(REPORTER_KEY);
  if (!v) {
    v = 'u_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(REPORTER_KEY, v);
  }
  return v;
}

export default function FeedbackFab() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 预览 blob URL
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    if (list.length === 0) return;
    const merged = [...files, ...list].slice(0, 5);
    const oversize = list.find((f) => f.size > 5 * 1024 * 1024);
    if (oversize) {
      setErrMsg(`图片 ${oversize.name} 超过 5MB`);
      return;
    }
    setErrMsg(null);
    setFiles(merged);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const reset = () => {
    setDescription('');
    setFiles([]);
    setErrMsg(null);
  };

  const submit = async () => {
    if (!description.trim()) { setErrMsg('请先描述一下问题'); return; }
    setSubmitting(true);
    setErrMsg(null);
    try {
      const fd = new FormData();
      fd.append('description', description.trim());
      fd.append('reporter', getOrCreateReporter());
      for (const f of files) fd.append('images', f);
      const res = await fetch('/api/issues', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      reset();
      setOpen(false);
      if (typeof window !== 'undefined') window.location.href = '/issues';
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : '提交异常');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* 浮动按钮 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'fixed z-[60] bottom-20 right-4 lg:bottom-6 lg:right-6',
          'inline-flex items-center gap-1.5 px-3 py-2.5 rounded-full',
          'bg-slate-900 text-white shadow-[0_8px_24px_-8px_rgba(15,23,42,0.6)]',
          'hover:bg-slate-800 transition-all border border-slate-700',
        )}
        title="提交问题反馈"
      >
        <MessageSquare className="w-4 h-4" strokeWidth={2.5} />
        <span className="text-xs font-black tracking-wider hidden sm:inline">反馈</span>
      </button>

      {/* 弹窗 */}
      {open && (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => { setOpen(false); reset(); }}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md overflow-hidden flex flex-col qt-modal-anim max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/40">
              <h3 className="text-base font-black text-slate-800 inline-flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-600" />
                提交问题反馈
              </h3>
              <button
                onClick={() => { setOpen(false); reset(); }}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto">
              <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider">问题描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="请尽量详细地描述：在哪个页面、做了什么操作、看到什么、期望什么"
                className="w-full min-h-[120px] border border-slate-200 rounded-md p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-y"
                maxLength={2000}
              />

              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider">
                  截图（最多 5 张，单张 ≤ 5MB）
                </label>
                <span className="text-[10px] font-mono font-bold text-slate-400">{files.length}/5</span>
              </div>

              {previews.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {previews.map((url, idx) => (
                    <div key={idx} className="relative group border border-slate-200 rounded-md overflow-hidden bg-slate-50 aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`截图${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        className="absolute top-1 right-1 p-0.5 bg-slate-900/80 hover:bg-red-600 text-white rounded transition-colors"
                        title="移除"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {files.length < 5 && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={onPickFiles}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-20 border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 rounded-md flex flex-col items-center justify-center text-slate-500 hover:text-blue-600 transition-colors"
                  >
                    <Upload className="w-5 h-5 mb-1" />
                    <span className="text-xs font-bold">点击添加截图</span>
                  </button>
                </>
              )}

              {errMsg && (
                <div className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {errMsg}
                </div>
              )}

              <div className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-100 pt-2">
                想看大家的反馈？<Link href="/issues" className="text-blue-600 hover:underline font-bold">查看问题看板 →</Link>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 bg-slate-50/40">
              <button
                onClick={() => { setOpen(false); reset(); }}
                disabled={submitting}
                className="flex-1 px-3 h-10 rounded-md border border-slate-200 text-slate-600 hover:bg-white font-bold text-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-[2] inline-flex items-center justify-center gap-1.5 px-3 h-10 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                提交
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
