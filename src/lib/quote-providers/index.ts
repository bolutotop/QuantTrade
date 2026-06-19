// =============================================================================
// Quote Provider —— 行情数据源适配器
//
// 设计：
//   多源可切换。当前默认走 "sina"，可通过 env QUOTE_PROVIDER=tencent 切换。
//   每个 provider 实现 QuoteProvider 接口；上层调用 fetchQuotes()/fetchRanking()
//   不需关心数据来源。
//
// 新增源步骤：
//   1. 在本目录新建 xxx.ts，实现 QuoteProvider；
//   2. 在 PROVIDERS 注册；
//   3. 设 env 即可启用，前端零感知。
//
// 每个源之间字段口径已在 LiveQuote 中归一化：
//   - 价格 / 涨跌额 / 涨跌幅
//   - 高 / 低 / 开 / 昨收
//   - 成交量（股）/ 成交额（元）
//   - time（HH:mm:ss）
// =============================================================================

import type { LiveQuote, QuoteProvider } from './types';
import { sinaProvider } from './sina';
import { tencentProvider } from './tencent';

const PROVIDERS: Record<string, QuoteProvider> = {
  sina: sinaProvider,
  tencent: tencentProvider,
};

function pickProvider(): QuoteProvider {
  const name = (process.env.QUOTE_PROVIDER || 'sina').toLowerCase();
  return PROVIDERS[name] ?? sinaProvider;
}

/**
 * 批量取实时行情。symbols 必须是项目内部格式（sh600519 / hk00700 / ...）。
 * 不支持的 symbol 会被忽略，不会抛错。
 */
export async function fetchQuotes(symbols: string[]): Promise<LiveQuote[]> {
  const list = Array.from(new Set(symbols.filter(Boolean)));
  if (list.length === 0) return [];
  const p = pickProvider();
  return p.fetchQuotes(list);
}

export async function fetchPriceMap(symbols: string[]): Promise<Record<string, number>> {
  const rows = await fetchQuotes(symbols);
  const m: Record<string, number> = {};
  for (const r of rows) m[r.symbol] = r.price;
  return m;
}

export type { LiveQuote, QuoteProvider } from './types';
