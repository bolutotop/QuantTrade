// =============================================================================
// 港股 ranking
//
// 实现：基于预置港股清单（HK_LIST）批量调 quote-providers 拿报价 → 内存排序分页
//
// 选这条路而不是直接用东财 push2 的原因：
//   - 东财 push2 在某些网络环境下连接被 RST（schannel: server closed abruptly）
//   - 我们需要"测试可用 + 不依赖网络运气"
//
// 代价：清单是静态的（约 200 只），不是全量。要全量需要更稳的 ranking 源。
// 后续可：把清单做成可前端编辑、或周期性从某个稳定 API 同步。
// =============================================================================

import { fetchQuotes } from '@/lib/quote-providers';
import type { LiveQuote } from '@/lib/quote-providers/types';
import { HK_LIST_UNIQUE, type HKEntry } from './hk-list';

export type HKNode = 'hk_all' | 'hk_main' | 'hk_gem' | 'hk_blue' | 'hk_red' | 'hk_h';

// 简单 bucket 映射；列表里没分 main/gem/blue/red/h，所以这里都先返回全集，
// 由 fs/category 字段做软筛选。后续要严格分类可以扩 HK_LIST 的 bucket。
function nodeFilter(_node: HKNode): (e: HKEntry) => boolean {
  return () => true;
}

const SORT_KEY: Record<string, keyof LiveQuote> = {
  changepercent: 'changePct',
  trade: 'price',
  amount: 'amount',
  volume: 'volume',
  // 我们没有现成的 turnover/mktcap，先用 amount 兜底
  turnoverratio: 'amount',
  mktcap: 'amount',
};

export type HKRankingItem = LiveQuote & {
  marketCap: number;
  turnover: number;
  code: string;
};

// 简单内存缓存：5s 内同样查询走缓存，避免快速翻页打爆上游
type CacheEntry = { ts: number; quotes: LiveQuote[] };
let _cache: CacheEntry | null = null;
const CACHE_MS = 5_000;

async function getAllQuotes(): Promise<LiveQuote[]> {
  if (_cache && Date.now() - _cache.ts < CACHE_MS) return _cache.quotes;
  const symbols = HK_LIST_UNIQUE.map((e) => 'hk' + e.code);
  const quotes = await fetchQuotes(symbols);
  _cache = { ts: Date.now(), quotes };
  return quotes;
}

export async function fetchHKRanking(opts: {
  node?: HKNode;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}): Promise<{ items: HKRankingItem[]; total: number }> {
  const node = opts.node ?? 'hk_all';
  const sort = opts.sort ?? 'changepercent';
  const order = opts.order ?? 'desc';
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));

  const all = await getAllQuotes();

  // 用 list 中的 entry 做过滤（确保只返回我们清单内的）
  const allowSet = new Set(
    HK_LIST_UNIQUE.filter(nodeFilter(node)).map((e) => 'hk' + e.code),
  );
  const filtered = all.filter((q) => allowSet.has(q.symbol) && q.price > 0);

  const sortKey = SORT_KEY[sort] ?? 'changePct';
  filtered.sort((a, b) => {
    const av = (a[sortKey] as number) ?? 0;
    const bv = (b[sortKey] as number) ?? 0;
    return order === 'asc' ? av - bv : bv - av;
  });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  const items: HKRankingItem[] = slice.map((q) => ({
    ...q,
    code: q.symbol,
    marketCap: 0,    // 新浪个股报价没直接给市值；后续可从基本面接口补
    turnover: 0,
  }));

  return { items, total };
}
