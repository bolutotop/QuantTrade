import { NextRequest } from 'next/server';
import { safeFetch, fetchGbkText, toUpstreamError } from '@/lib/upstream';

// =============================================================================
// /api/news — 个股财经资讯聚合（合规公开源）
//
// 聚合多源新闻 / 公告 / 讨论，并做一次合并去重 + 时间倒序：
//   - sina       新浪个股新闻      (vip.stock.finance.sina.com.cn)
//   - eastmoney  东方财富个股新闻+公告 (np-anotice-stock.eastmoney.com)
//   - xueqiu     雪球个股 status   (xueqiu.com/statuses/stock_timeline.json)
//   - cninfo     巨潮资讯公告       (www.cninfo.com.cn/new/hisAnnouncement)
//   - hot        舆情热度          (新浪热度 / 微博话题 / 百度指数代理)
//
// 用法：
//   GET /api/news?code=600519
//   GET /api/news?code=600519&sources=sina,xueqiu&limit=50
//
// 响应：
//   {
//     code: '600519',
//     name: '贵州茅台',
//     items: [{ id, source, type, title, summary?, url, time, ts, author? }],
//     hot:   { sinaHotRank?, weiboCount?, baiduIndex? },
//     errors: { sina?: '...' }    // 部分失败时的子源错误
//   }
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type NewsType = 'news' | 'announce' | 'discuss';
type SourceKey = 'sina' | 'eastmoney' | 'xueqiu' | 'cninfo' | 'akshare';

export type NewsItem = {
  id: string;
  source: SourceKey;
  type: NewsType;
  title: string;
  summary?: string;
  url: string;
  time: string;       // 展示用 yyyy-MM-dd HH:mm
  ts: number;         // 排序用 epoch ms
  author?: string;
};

const CODE_RE = /^[0-9]{4,6}$/;
const HK_RE = /^hk[0-9]{1,5}$/i;

function pad(s: string, n = 6): string {
  return s.length >= n ? s : ('0'.repeat(n - s.length) + s);
}

function resolveSinaSymbol(code: string): string {
  const c = code.replace(/[^0-9]/g, '');
  if (c.startsWith('6') || c.startsWith('9')) return 'sh' + c;
  if (c.startsWith('8') || c.startsWith('4')) return 'bj' + c;
  return 'sz' + c;
}

// 东方财富 secid 前缀：1=沪市/科创/北交沪；0=深市/创业；
// 实际 6 开头 = 1.xxxxxx，0/3 开头 = 0.xxxxxx，4/8 北交所 = 0.xxxxxx
function resolveEmSecid(code: string): string {
  const c = code.replace(/[^0-9]/g, '');
  if (c.startsWith('6') || c.startsWith('9')) return `1.${c}`;
  return `0.${c}`;
}

function fmtTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

function parseTime(s: string): number {
  if (!s) return 0;
  // 兼容 "2026-06-19 15:34:01" / "2026-06-19T15:34:01+08:00" / 13 位 ts
  if (/^\d{13}$/.test(s)) return Number(s);
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, '')
    .trim();
}

// -------------------- 新浪财经：个股新闻 --------------------
// 接口（GBK，HTML/JSON 混合）：
//   https://vip.stock.finance.sina.com.cn/corp/view/vCB_AllNewsStock.php?symbol=sh600519&Page=1
// 该页是一个 <div class="datelist"> 里整齐排列的 <a href><b>标题</b></a>(yyyy-mm-dd hh:mm)
async function fetchSinaNews(code: string, limit: number): Promise<NewsItem[]> {
  const symbol = resolveSinaSymbol(code);
  const url = `https://vip.stock.finance.sina.com.cn/corp/view/vCB_AllNewsStock.php?symbol=${symbol}&Page=1`;
  const html = await fetchGbkText(url, undefined, 6000);
  const out: NewsItem[] = [];
  // 提取 datelist 区块
  const m = html.match(/<div[^>]*class="datelist"[\s\S]*?<\/div>/i);
  if (!m) return out;
  const block = m[0];
  // 形如：(2026-06-19 09:31) <a target=_blank href="https://...">标题</a><br>
  const re = /\((\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\)\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(block)) !== null && out.length < limit) {
    const time = mm[1];
    const link = mm[2];
    const title = stripHtml(mm[3]);
    if (!title) continue;
    const ts = parseTime(time);
    out.push({
      id: 'sina:' + link,
      source: 'sina',
      type: 'news',
      title,
      url: link,
      time: fmtTime(ts) || time,
      ts,
    });
  }
  return out;
}

// -------------------- 东方财富：个股新闻 + 公告 --------------------
// 公告：
//   https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=20&page_index=1&ann_type=A&client_source=web&stock_list={code}
// 新闻：
//   https://search-api-web.eastmoney.com/search/jsonp?param=...
// 走更稳定的：
//   https://np-listapi.eastmoney.com/comm/wap/getListInfo?cb=&client=wap&type=2&mTypeAndCode={secid}&pageSize=20&pageIndex=1
type EmAnnouncement = {
  art_code: string;
  title: string;
  notice_date: string;
  eiTime?: string;
  columns?: { column_code: string; column_name: string }[];
};
async function fetchEastmoney(code: string, limit: number): Promise<NewsItem[]> {
  const out: NewsItem[] = [];

  // 公告
  try {
    const annUrl = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=${Math.min(50, limit)}&page_index=1&ann_type=A&client_source=web&stock_list=${pad(code, 6)}`;
    const r = await safeFetch(annUrl, {
      headers: { Referer: 'https://data.eastmoney.com/' },
    }, 6000);
    if (r.ok) {
      const j: { data?: { list?: EmAnnouncement[] } } = await r.json();
      const list = j?.data?.list ?? [];
      for (const it of list) {
        const ts = parseTime(it.notice_date);
        out.push({
          id: 'em:ann:' + it.art_code,
          source: 'eastmoney',
          type: 'announce',
          title: it.title,
          summary: it.columns?.map((c) => c.column_name).join(' · '),
          url: `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${it.art_code}&client_source=web&page_index=1`,
          time: fmtTime(ts),
          ts,
        });
      }
    }
  } catch {
    /* 子源失败不影响整体 */
  }

  // 新闻：东财搜索 jsonp（兜底）
  try {
    const secid = resolveEmSecid(code);
    const newsUrl = `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(
      JSON.stringify({
        uid: '',
        keyword: pad(code, 6),
        type: ['cmsArticleWebOld'],
        client: 'web',
        clientType: 'web',
        clientVersion: 'curr',
        param: { cmsArticleWebOld: { searchScope: 'default', sort: 'time', pageIndex: 1, pageSize: Math.min(20, limit), preTag: '', postTag: '' } },
      })
    )}&_=${Date.now()}`;
    const r = await safeFetch(newsUrl, { headers: { Referer: 'https://so.eastmoney.com/' } }, 6000);
    if (r.ok) {
      const text = await r.text();
      const m = text.match(/^\s*[\w$]+\s*\((.*)\)\s*;?\s*$/s);
      if (m) {
        const j = JSON.parse(m[1]);
        const list: Array<{ url: string; title: string; date: string; mediaName?: string; content?: string; code?: string }>
          = j?.result?.cmsArticleWebOld ?? [];
        for (const it of list) {
          const ts = parseTime(it.date);
          out.push({
            id: 'em:news:' + it.url,
            source: 'eastmoney',
            type: 'news',
            title: stripHtml(it.title),
            summary: it.content ? stripHtml(it.content).slice(0, 120) : undefined,
            url: it.url,
            time: fmtTime(ts),
            ts,
            author: it.mediaName,
          });
        }
      }
    }
    void secid; // 保留扩展位
  } catch {
    /* ignore */
  }

  return out.slice(0, limit);
}

// -------------------- 雪球：个股 status（讨论） --------------------
// 接口（需要先访问首页拿 cookie，否则 400）
//   https://xueqiu.com/statuses/stock_timeline.json?symbol_id=SH600519&count=20&source=自选股
// 雪球 symbol：A 股大写 SH/SZ/BJ + code
type XueqiuStatus = {
  id: number;
  text?: string;
  description?: string;
  title?: string;
  user?: { screen_name?: string };
  created_at: number;
  target?: string;     // 跳转链接
  source?: string;
};
async function fetchXueqiu(code: string, limit: number): Promise<NewsItem[]> {
  // 支持 A 股 (sh/sz/bj+6) 和港股 (hk+5)
  let symbolId: string;
  if (/^hk/i.test(code)) {
    const c = code.replace(/[^0-9]/g, '').padStart(5, '0');
    symbolId = `HK${c}`;
  } else {
    const c = code.replace(/[^0-9]/g, '');
    let prefix = 'SZ';
    if (c.startsWith('6') || c.startsWith('9')) prefix = 'SH';
    else if (c.startsWith('8') || c.startsWith('4')) prefix = 'BJ';
    symbolId = `${prefix}${pad(c, 6)}`;
  }

  // 先 GET 首页取 cookie
  let cookie = '';
  try {
    const r0 = await safeFetch('https://xueqiu.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
        'Accept': 'text/html',
      },
    }, 5000);
    const setCookie = r0.headers.get('set-cookie') ?? '';
    cookie = setCookie.split(/,(?=[^ ])/).map((c) => c.split(';')[0]).join('; ');
  } catch {
    /* ignore */
  }

  const url = `https://xueqiu.com/statuses/stock_timeline.json?symbol_id=${symbolId}&count=${Math.min(50, limit)}&source=%E8%87%AA%E9%80%89%E8%82%A1`;
  const r = await safeFetch(url, {
    headers: {
      Referer: `https://xueqiu.com/S/${symbolId}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
      Cookie: cookie,
    },
  }, 6000);
  if (!r.ok) return [];
  const text = await r.text();
  // 雪球 WAF 反爬时返回 HTML（含 <textarea id="renderData">），直接降级为空
  if (!text.startsWith('{') && !text.startsWith('[')) return [];
  let j: { list?: XueqiuStatus[] };
  try {
    j = JSON.parse(text);
  } catch {
    return [];
  }
  const list = j?.list ?? [];
  return list.slice(0, limit).map((it) => {
    const text = stripHtml(it.text ?? it.description ?? '');
    const title = it.title?.trim() || text.slice(0, 50) || '雪球讨论';
    const ts = it.created_at ?? 0;
    const target = it.target?.startsWith('http') ? it.target : `https://xueqiu.com${it.target ?? ''}`;
    return {
      id: 'xq:' + it.id,
      source: 'xueqiu' as const,
      type: 'discuss' as const,
      title,
      summary: text && text !== title ? text.slice(0, 200) : undefined,
      url: target,
      time: fmtTime(ts),
      ts,
      author: it.user?.screen_name,
    };
  });
}

// -------------------- 巨潮资讯 cninfo：公告 --------------------
// 接口：POST https://www.cninfo.com.cn/new/hisAnnouncement/query
// stock 字段：{code},{orgId}  orgId 较麻烦；用 plate 检索更通用
type CninfoItem = {
  announcementId: string;
  announcementTitle: string;
  announcementTime: number;
  adjunctUrl: string;
  secCode: string;
  secName: string;
};
async function fetchCninfo(code: string, limit: number): Promise<NewsItem[]> {
  const c = pad(code.replace(/[^0-9]/g, ''), 6);
  const isSH = c.startsWith('6') || c.startsWith('9');
  const isBJ = c.startsWith('8') || c.startsWith('4');
  const plate = isSH ? 'sse' : isBJ ? 'bj' : 'szse';
  const column = isSH ? 'sse' : isBJ ? 'bj' : 'szse';
  const body = new URLSearchParams({
    stock: c,
    tabName: 'fulltext',
    pageSize: String(Math.min(30, limit)),
    pageNum: '1',
    column,
    plate,
    isHLtitle: 'true',
  });
  const r = await safeFetch('https://www.cninfo.com.cn/new/hisAnnouncement/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
    },
    body,
  }, 6000);
  if (!r.ok) throw new Error(`cninfo http ${r.status}`);
  const j: { announcements?: CninfoItem[] } = await r.json();
  const list = j?.announcements ?? [];
  return list.slice(0, limit).map((it) => ({
    id: 'cninfo:' + it.announcementId,
    source: 'cninfo' as const,
    type: 'announce' as const,
    title: stripHtml(it.announcementTitle),
    url: 'https://static.cninfo.com.cn/' + it.adjunctUrl,
    time: fmtTime(it.announcementTime),
    ts: it.announcementTime,
  }));
}

// -------------------- 舆情热度（轻量） --------------------
// 用百度热搜 + 雪球热度近似，没有完美的官方"按代码查热度"接口；
// 这里返回雪球评论数 + 微博话题搜索条数，前端展示参考即可。
type Hot = {
  weiboHits?: number;     // 近似：微博 s? 入口的"相关微博数"
  baiduRelated?: number;  // 百度搜索 result count（近似关注度）
};
async function fetchHot(code: string, name?: string): Promise<Hot> {
  const out: Hot = {};
  const kw = name?.trim() || code;

  // 微博：移动版搜索 type=1 综合，count_str 在 cards 里
  try {
    const url = `https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D1%26q%3D${encodeURIComponent(kw)}`;
    const r = await safeFetch(url, {
      headers: {
        Referer: 'https://m.weibo.cn/',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    }, 5000);
    if (r.ok) {
      const j: { data?: { cards?: Array<{ card_group?: Array<{ desc?: string }> }> } } = await r.json();
      const cards = j?.data?.cards ?? [];
      let count = 0;
      for (const c of cards) {
        for (const g of c.card_group ?? []) {
          if (g.desc) count++;
        }
      }
      out.weiboHits = count;
    }
  } catch {
    /* ignore */
  }

  return out;
}

// -------------------- 东财搜索（按关键词；港股复用） --------------------
async function fetchEastmoneyByKeyword(keyword: string, limit: number): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  if (!keyword) return out;
  try {
    const newsUrl = `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(
      JSON.stringify({
        uid: '',
        keyword,
        type: ['cmsArticleWebOld'],
        client: 'web',
        clientType: 'web',
        clientVersion: 'curr',
        param: { cmsArticleWebOld: { searchScope: 'default', sort: 'time', pageIndex: 1, pageSize: Math.min(20, limit), preTag: '', postTag: '' } },
      })
    )}&_=${Date.now()}`;
    const r = await safeFetch(newsUrl, { headers: { Referer: 'https://so.eastmoney.com/' } }, 6000);
    if (!r.ok) return out;
    const text = await r.text();
    const m = text.match(/^\s*[\w$]+\s*\((.*)\)\s*;?\s*$/s);
    if (!m) return out;
    const j = JSON.parse(m[1]);
    const list: Array<{ url: string; title: string; date: string; mediaName?: string; content?: string }>
      = j?.result?.cmsArticleWebOld ?? [];
    for (const it of list) {
      const ts = parseTime(it.date);
      out.push({
        id: 'em:news:' + it.url,
        source: 'eastmoney',
        type: 'news',
        title: stripHtml(it.title),
        summary: it.content ? stripHtml(it.content).slice(0, 120) : undefined,
        url: it.url,
        time: fmtTime(ts),
        ts,
        author: it.mediaName,
      });
    }
  } catch {
    /* ignore */
  }
  return out.slice(0, limit);
}

// -------------------- AKShare 子服务（可选；覆盖最广的开源新闻源） --------------------
//
// AKShare 是 GitHub 22k★ 的开源财经数据库，覆盖 A 股/港股/美股新闻、公告、研报、F10。
// 我们让它和 sentiment-service 一样独立部署（Python + FastAPI 网关），
// 这边只是反代客户端：env AKSHARE_SERVICE_URL 没设或不可达时返回空数组。
//
// 子服务最小契约：
//   GET ${base}/api/news?code=hk09626&name=哔哩哔哩&limit=20
//   返回 { items: NewsItem[] }
//
// 部署文档：见仓库 akshare-service/README.md（与 sentiment-service 同款骨架）
async function fetchAkshare(code: string, name: string | undefined, limit: number): Promise<NewsItem[]> {
  const base = process.env.AKSHARE_SERVICE_URL || '';
  if (!base) return [];
  try {
    const url = `${base.replace(/\/$/, '')}/api/news?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name ?? '')}&limit=${limit}`;
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!r.ok) return [];
    const j = await r.json() as { items?: NewsItem[] };
    return Array.isArray(j?.items) ? j.items.map((it) => ({ ...it, source: 'akshare' as SourceKey })) : [];
  } catch {
    return [];
  }
}

// -------------------- 主入口 --------------------
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = (sp.get('code') ?? '').trim();
  const name = sp.get('name')?.trim() || undefined;
  const limit = Math.max(1, Math.min(100, Number(sp.get('limit') ?? 40)));
  const sourcesParam = sp.get('sources')?.trim();
  const wantSocial = sp.get('social') !== '0';

  if (!code) return Response.json({ error: 'code is required' }, { status: 400 });

  // 港股分支：跑专属流水线
  if (HK_RE.test(code)) {
    // 关键词组合：① "09626.HK" 命中港股代码精准报道；② 股票名称兜底
    const hkCode = code.replace(/^hk/i, '').padStart(5, '0');
    const kwCode = `${hkCode}.HK`;
    const tasks: Array<Promise<{ key: SourceKey; items?: NewsItem[]; error?: string }>> = [
      fetchXueqiu(code, limit)
        .then((items) => ({ key: 'xueqiu' as SourceKey, items }))
        .catch((e: unknown) => ({ key: 'xueqiu' as SourceKey, error: e instanceof Error ? e.message : String(e) })),
      fetchEastmoneyByKeyword(kwCode, limit)
        .then((items) => ({ key: 'eastmoney' as SourceKey, items }))
        .catch((e: unknown) => ({ key: 'eastmoney' as SourceKey, error: e instanceof Error ? e.message : String(e) })),
      // 名称兜底：通常和 code.HK 部分重叠，最后会按 url 去重
      ...(name
        ? [fetchEastmoneyByKeyword(name, Math.min(20, limit))
            .then((items) => ({ key: 'eastmoney' as SourceKey, items }))
            .catch(() => ({ key: 'eastmoney' as SourceKey, items: [] as NewsItem[] }))]
        : []),
      // AKShare 子服务（可选，未配置则直接返回空，不影响）
      fetchAkshare(code, name, limit)
        .then((items) => ({ key: 'akshare' as SourceKey, items }))
        .catch(() => ({ key: 'akshare' as SourceKey, items: [] as NewsItem[] })),
    ];
    const hotTask = wantSocial ? fetchHot(code, name).catch(() => ({} as Hot)) : Promise.resolve({} as Hot);
    try {
      const [results, hot] = await Promise.all([Promise.all(tasks), hotTask]);
      const merged: NewsItem[] = [];
      const errors: Record<string, string> = {};
      for (const r of results) {
        if (r.error) errors[r.key] = r.error;
        if (r.items) merged.push(...r.items);
      }
      const seen = new Set<string>();
      const dedup = merged.filter((it) => {
        const k = it.url || it.id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      dedup.sort((a, b) => b.ts - a.ts);
      return new Response(JSON.stringify({
        code,
        name: name ?? '',
        items: dedup.slice(0, limit),
        hot,
        errors: Object.keys(errors).length ? errors : undefined,
        hint: dedup.length === 0 ? '港股资讯目前来自雪球讨论 + 东方财富搜索；如均为空可能是关键词冷门或上游限流。公告/巨潮源仅适配 A 股，已自动跳过。' : undefined,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      const { error, status } = toUpstreamError(e);
      return Response.json({ error, code }, { status });
    }
  }

  if (!CODE_RE.test(code)) return Response.json({ error: 'invalid code' }, { status: 400 });

  const sources: SourceKey[] = sourcesParam
    ? (sourcesParam.split(',').filter((s) => ['sina', 'eastmoney', 'xueqiu', 'cninfo'].includes(s)) as SourceKey[])
    : ['sina', 'eastmoney', 'xueqiu', 'cninfo'];

  const tasks: Array<Promise<{ key: SourceKey; items?: NewsItem[]; error?: string }>> = sources.map((key) => {
    const fn =
      key === 'sina' ? fetchSinaNews :
      key === 'eastmoney' ? fetchEastmoney :
      key === 'xueqiu' ? fetchXueqiu :
      fetchCninfo;
    return fn(code, limit)
      .then((items) => ({ key, items }))
      .catch((e: unknown) => ({ key, error: e instanceof Error ? e.message : String(e) }));
  });

  const hotTask = wantSocial ? fetchHot(code, name).catch(() => ({} as Hot)) : Promise.resolve({} as Hot);

  try {
    const [results, hot] = await Promise.all([Promise.all(tasks), hotTask]);
    const merged: NewsItem[] = [];
    const errors: Record<string, string> = {};
    for (const r of results) {
      if (r.error) errors[r.key] = r.error;
      if (r.items) merged.push(...r.items);
    }
    // 去重：按 url
    const seen = new Set<string>();
    const dedup = merged.filter((it) => {
      const k = it.url || it.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    dedup.sort((a, b) => b.ts - a.ts);

    return new Response(JSON.stringify({
      code,
      name: name ?? '',
      items: dedup.slice(0, limit),
      hot,
      errors: Object.keys(errors).length ? errors : undefined,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const { error, status } = toUpstreamError(e);
    return Response.json({ error, code }, { status });
  }
}
