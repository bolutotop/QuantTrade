'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ExternalLink, RefreshCw, MessageSquare, FileText, Megaphone, Flame, Sparkles, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// =============================================================================
// SentimentPanel —— 个股资讯 / 舆情面板
//
// Tab 结构：
//   [资讯]    新浪 + 东财 (type=news)
//   [公告]    东财公告 + 巨潮公告 (type=announce)
//   [雪球]    雪球讨论 (source=xueqiu)
//   [社媒]    B站 / 小红书 / 微博 (来自 /api/social → sentiment-service)
//   [热度]    雪球热度 / 微博话题
//
// 数据：
//   /api/news?code=600519&name=贵州茅台
//   /api/social?code=600519&name=贵州茅台
//
// 30s 自动轮询，仅在 Modal 打开时进行；切换 code 立即刷新。
// =============================================================================

const REFRESH_MS = 30_000;

type SourceKey = 'sina' | 'eastmoney' | 'xueqiu' | 'cninfo';
type NewsType = 'news' | 'announce' | 'discuss';

type NewsItem = {
  id: string;
  source: SourceKey;
  type: NewsType;
  title: string;
  summary?: string;
  url: string;
  time: string;
  ts: number;
  author?: string;
};

type Hot = {
  weiboHits?: number;
  baiduRelated?: number;
};

type NewsResp = {
  code: string;
  name: string;
  items: NewsItem[];
  hot?: Hot;
  errors?: Record<string, string>;
  error?: string;
  hint?: string;          // 数据源不支持时的友好提示（如港股资讯）
};

type SocialPlatform = 'bilibili' | 'xhs' | 'douyin' | 'weibo' | 'kuaishou' | 'zhihu';

type SocialPost = {
  id: string;
  platform: SocialPlatform;
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
  sentiment?: -1 | 0 | 1;
  sentimentScore?: number;
};

type SocialResp = {
  code: string;
  name?: string;
  items: SocialPost[];
  serviceAvailable?: boolean;
  hint?: string;
};

type TabKey = 'news' | 'announce' | 'xueqiu' | 'social' | 'hot';

const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: 'news', label: '资讯', icon: FileText },
  { key: 'announce', label: '公告', icon: Megaphone },
  { key: 'xueqiu', label: '雪球', icon: MessageSquare },
  { key: 'social', label: '社媒', icon: Sparkles },
  { key: 'hot', label: '热度', icon: Flame },
];

const SOURCE_LABEL: Record<SourceKey, string> = {
  sina: '新浪',
  eastmoney: '东财',
  xueqiu: '雪球',
  cninfo: '巨潮',
};

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  bilibili: 'B站',
  xhs: '小红书',
  douyin: '抖音',
  weibo: '微博',
  kuaishou: '快手',
  zhihu: '知乎',
};

const PLATFORM_COLOR: Record<SocialPlatform, string> = {
  bilibili: 'bg-pink-100 text-pink-700',
  xhs: 'bg-red-100 text-red-700',
  douyin: 'bg-slate-900 text-white',
  weibo: 'bg-orange-100 text-orange-700',
  kuaishou: 'bg-amber-100 text-amber-700',
  zhihu: 'bg-blue-100 text-blue-700',
};

export type SentimentPanelProps = {
  code: string;
  name: string;
};

export default function SentimentPanel({ code, name }: SentimentPanelProps) {
  const [tab, setTab] = useState<TabKey>('news');
  const [news, setNews] = useState<NewsResp | null>(null);
  const [social, setSocial] = useState<SocialResp | null>(null);
  const [loadingNews, setLoadingNews] = useState(false);
  const [loadingSocial, setLoadingSocial] = useState(false);
  const [errorNews, setErrorNews] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');

  const fetchNews = useCallback(async () => {
    setLoadingNews(true);
    try {
      const r = await fetch(
        `/api/news?code=${code}&name=${encodeURIComponent(name)}&limit=60`,
        { cache: 'no-store' }
      );
      const j: NewsResp = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setNews(j);
      setErrorNews(null);
      setUpdatedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (e) {
      setErrorNews(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingNews(false);
    }
  }, [code, name]);

  const fetchSocial = useCallback(async () => {
    setLoadingSocial(true);
    try {
      const r = await fetch(
        `/api/social?code=${code}&name=${encodeURIComponent(name)}&limit=40`,
        { cache: 'no-store' }
      );
      const j: SocialResp = await r.json();
      setSocial(j);
    } catch {
      setSocial({ code, items: [], serviceAvailable: false, hint: '舆情服务连接失败' });
    } finally {
      setLoadingSocial(false);
    }
  }, [code, name]);

  // 轮询：tab 在 social 上时同时拉两份；否则只拉新闻够用
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchNews();
      void fetchSocial();
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [code, fetchNews, fetchSocial]);

  // 按 tab 过滤
  const filtered = useMemo(() => {
    const items = news?.items ?? [];
    if (tab === 'news') return items.filter((i) => i.type === 'news');
    if (tab === 'announce') return items.filter((i) => i.type === 'announce');
    if (tab === 'xueqiu') return items.filter((i) => i.source === 'xueqiu');
    return items;
  }, [news, tab]);

  const counts = useMemo(() => {
    const items = news?.items ?? [];
    return {
      news: items.filter((i) => i.type === 'news').length,
      announce: items.filter((i) => i.type === 'announce').length,
      xueqiu: items.filter((i) => i.source === 'xueqiu').length,
      social: social?.items?.length ?? 0,
    };
  }, [news, social]);

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200/70 -mx-1 px-1 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          const cnt =
            t.key === 'news' ? counts.news :
            t.key === 'announce' ? counts.announce :
            t.key === 'xueqiu' ? counts.xueqiu :
            t.key === 'social' ? counts.social :
            0;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 -mb-px transition-colors',
                active
                  ? 'text-blue-600 border-blue-600'
                  : 'text-slate-500 border-transparent hover:text-slate-800',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {cnt > 0 && (
                <span
                  className={cn(
                    'inline-flex items-center justify-center min-w-[18px] h-4 px-1 text-[10px] rounded-full font-mono',
                    active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-400 pr-1">
          {updatedAt && <span className="font-mono">更新 {updatedAt}</span>}
          <button
            onClick={() => { void fetchNews(); void fetchSocial(); }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-100 font-bold"
            title="立即刷新"
          >
            <RefreshCw className={cn('w-3 h-3', (loadingNews || loadingSocial) && 'animate-spin')} />
          </button>
        </span>
      </div>

      {/* 子源错误提示 */}
      {news?.errors && Object.keys(news.errors).length > 0 && tab !== 'social' && tab !== 'hot' && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
          ⚠ 部分源失败：{Object.entries(news.errors).map(([k, v]) => `${SOURCE_LABEL[k as SourceKey] ?? k}(${v})`).join(' · ')}
        </div>
      )}
      {errorNews && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-2">
          ❌ {errorNews}
        </div>
      )}

      {/* 列表区域 */}
      {tab === 'social' ? (
        <SocialList loading={loadingSocial} data={social} />
      ) : tab === 'hot' ? (
        <HotPanel hot={news?.hot} hint={news?.hint} />
      ) : (
        <NewsList
          loading={loadingNews && !news}
          items={filtered}
          hint={news?.hint && filtered.length === 0 ? news.hint : undefined}
        />
      )}
    </div>
  );
}

// -------------------------- 子组件 --------------------------

function NewsList({ items, loading, hint }: { items: NewsItem[]; loading: boolean; hint?: string }) {
  if (loading) {
    return <div className="py-8 text-center text-slate-400 text-sm">加载中…</div>;
  }
  if (!items.length) {
    if (hint) {
      return (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-4 space-y-1.5">
          <div className="text-sm font-bold text-amber-800 inline-flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            该数据源暂不支持当前股票
          </div>
          <p className="text-xs text-amber-700 leading-relaxed">{hint}</p>
        </div>
      );
    }
    return <div className="py-8 text-center text-slate-400 text-sm">暂无数据</div>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((it) => (
        <li key={it.id} className="py-2.5 group">
          <a
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block hover:bg-slate-50/60 -mx-2 px-2 py-1 rounded-md transition-colors"
          >
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'inline-flex items-center justify-center shrink-0 mt-0.5 px-1.5 h-5 text-[10px] font-bold rounded',
                  it.type === 'announce'
                    ? 'bg-amber-100 text-amber-700'
                    : it.source === 'xueqiu'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-600',
                )}
              >
                {SOURCE_LABEL[it.source]}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-800 group-hover:text-blue-600 leading-snug">
                  {it.title}
                  <ExternalLink className="inline w-3 h-3 ml-1 -mt-0.5 text-slate-300 group-hover:text-blue-400" />
                </div>
                {it.summary && (
                  <p className="text-[12px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">{it.summary}</p>
                )}
                <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1 font-mono">
                  <span>{it.time}</span>
                  {it.author && <span>· {it.author}</span>}
                </div>
              </div>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}

function SocialList({ data, loading }: { data: SocialResp | null; loading: boolean }) {
  if (loading && !data) {
    return <div className="py-8 text-center text-slate-400 text-sm">加载中…</div>;
  }
  if (!data) return null;

  // 服务未启动
  if (data.serviceAvailable === false) {
    return (
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-bold text-amber-800">
          <AlertCircle className="w-4 h-4" />
          舆情服务（B站 / 小红书 / 微博）未启动
        </div>
        <p className="text-xs text-amber-700 leading-relaxed">{data.hint}</p>
        <p className="text-[11px] text-amber-600 leading-relaxed">
          这是一个独立部署的 Python 服务（基于开源项目 MediaCrawler 25k★），用于抓取
          视频/笔记/评论区。仓库根目录 <code className="font-mono px-1 py-0.5 bg-amber-100 rounded">sentiment-service/</code>
          已提供完整骨架与 README，按文档启动即可自动接入。
        </p>
      </div>
    );
  }

  if (!data.items?.length) {
    return <div className="py-8 text-center text-slate-400 text-sm">暂无社媒数据</div>;
  }

  return (
    <ul className="space-y-2">
      {(data.items ?? []).map((it) => (
        <li key={it.id}>
          <a
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block border border-slate-200/70 rounded-lg p-2.5 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
          >
            <div className="flex items-center gap-1.5 flex-wrap mb-1">
              <span className={cn('px-1.5 h-5 inline-flex items-center text-[10px] font-bold rounded', PLATFORM_COLOR[it.platform])}>
                {PLATFORM_LABEL[it.platform]}
              </span>
              <span className="text-[10px] uppercase tracking-wider px-1.5 h-5 inline-flex items-center rounded bg-slate-100 text-slate-500 font-mono">
                {it.type}
              </span>
              {typeof it.sentiment === 'number' && (
                <span
                  className={cn(
                    'px-1.5 h-5 inline-flex items-center text-[10px] font-bold rounded',
                    it.sentiment > 0
                      ? 'bg-red-100 text-red-700'
                      : it.sentiment < 0
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-600',
                  )}
                >
                  {it.sentiment > 0 ? '正面' : it.sentiment < 0 ? '负面' : '中性'}
                </span>
              )}
              <span className="ml-auto text-[11px] text-slate-400 font-mono">{it.time}</span>
            </div>
            <div className="text-sm font-bold text-slate-800 leading-snug">{it.title}</div>
            {it.content && <p className="text-[12px] text-slate-500 mt-1 line-clamp-2">{it.content}</p>}
            <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1.5 font-mono">
              {it.author && <span>@{it.author}</span>}
              {typeof it.likes === 'number' && <span>❤ {it.likes}</span>}
              {typeof it.comments === 'number' && <span>💬 {it.comments}</span>}
              {typeof it.views === 'number' && <span>👁 {it.views}</span>}
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}

function HotPanel({ hot, hint }: { hot?: Hot; hint?: string }) {
  if (!hot || (!hot.weiboHits && !hot.baiduRelated)) {
    if (hint) {
      return (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-4 space-y-1.5">
          <div className="text-sm font-bold text-amber-800 inline-flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            该数据源暂不支持当前股票
          </div>
          <p className="text-xs text-amber-700 leading-relaxed">{hint}</p>
        </div>
      );
    }
    return <div className="py-8 text-center text-slate-400 text-sm">暂无热度数据</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Stat label="微博相关" value={hot.weiboHits ?? 0} unit="条" />
      <Stat label="百度相关" value={hot.baiduRelated ?? 0} unit="条" />
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="border border-slate-200/70 rounded-lg p-3">
      <div className="text-[11px] text-slate-400 font-bold tracking-wider uppercase">{label}</div>
      <div className="mt-1 font-mono">
        <span className="text-2xl font-black text-slate-800">{value.toLocaleString()}</span>
        <span className="text-xs text-slate-400 ml-1">{unit}</span>
      </div>
    </div>
  );
}
