// 通用类型
export type LiveQuote = {
  symbol: string;        // 项目内部 symbol（sh600519 / hk00700 / ...）
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;        // 成交量（股；港股是股，A 股本身就是股）
  amount: number;        // 成交额（元 / 港币）
  time: string;          // HH:mm:ss
  date?: string;         // yyyy-MM-dd
  market: 'SH' | 'SZ' | 'BJ' | 'HK' | 'US';
  /** 原始字段，仅调试 */
  raw?: unknown;
};

export interface QuoteProvider {
  name: string;
  fetchQuotes(symbols: string[]): Promise<LiveQuote[]>;
}
