// =============================================================================
// 服务端取实时价 —— 透明走 quote-providers
//
// 兼容旧调用：fetchLivePrices / fetchLivePriceMap 现在直接转发给 provider。
// 新代码建议直接 import from '@/lib/quote-providers'。
// =============================================================================

export { fetchQuotes as fetchLivePrices, fetchPriceMap as fetchLivePriceMap } from './quote-providers';
export type { LiveQuote as LivePrice } from './quote-providers';
