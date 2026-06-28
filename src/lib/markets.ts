// =============================================================================
// 市场识别 / 代码归一化（项目统一约定）
//
// QuantTrade 内部 symbol 一律采用「小写市场前缀 + 数字代码」格式：
//
//   sh600519   沪市 A     (上证 6 / 9 开头)
//   sz000001   深市 A     (0 / 3 开头)
//   bj920000   北交所     (8 / 4 开头)
//   hk00700    港股       (5 位代码，前导补 0)
//   us.AAPL    美股       (字母代码，加 us. 前缀；未来扩展位)
//
// 这样规则简单、和新浪 hq_str_xxx 自带的 key 保持一致，存 SQLite 也是字符串
// 主键，未来加新市场只需要扩展前缀映射。
// =============================================================================

export type Market = 'SH' | 'SZ' | 'BJ' | 'HK' | 'US';

export type MarketInfo = {
  market: Market;
  /** 内部 symbol（带前缀） */
  symbol: string;
  /** 纯代码（不带前缀，港股 5 位、A 股 6 位、美股原样） */
  code: string;
  /** A 股惯例的"沪深北"判断（用于费率） */
  isCN: boolean;
};

const HK_RE = /^(hk)?\d{1,5}$/i;
const A_RE = /^[0-9]{6}$/;

/** 输入可以是：sh600519 / 600519 / hk00700 / 700 / 00700 */
export function parseSymbol(input: string): MarketInfo | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();

  // 已带前缀
  if (s.startsWith('sh')) return mk('SH', s, s.slice(2));
  if (s.startsWith('sz')) return mk('SZ', s, s.slice(2));
  if (s.startsWith('bj')) return mk('BJ', s, s.slice(2));
  if (s.startsWith('hk')) {
    const code = padHk(s.slice(2));
    return mk('HK', 'hk' + code, code);
  }
  if (s.startsWith('us.')) return mk('US', s, s.slice(3).toUpperCase());

  // 无前缀：按规则推断
  if (A_RE.test(s)) {
    if (s.startsWith('6') || s.startsWith('9')) return mk('SH', 'sh' + s, s);
    if (s.startsWith('8') || s.startsWith('4')) return mk('BJ', 'bj' + s, s);
    return mk('SZ', 'sz' + s, s);
  }
  if (HK_RE.test(s)) {
    const code = padHk(s);
    return mk('HK', 'hk' + code, code);
  }
  // 美股：纯字母
  if (/^[a-z][a-z0-9.\-]{0,9}$/.test(s)) {
    const code = s.toUpperCase();
    return mk('US', 'us.' + code, code);
  }
  return null;
}

function padHk(c: string): string {
  const d = c.replace(/[^0-9]/g, '');
  return d.padStart(5, '0');
}

function mk(market: Market, symbol: string, code: string): MarketInfo {
  return { market, symbol, code, isCN: market === 'SH' || market === 'SZ' || market === 'BJ' };
}

/** 仅供费率使用：是否沪市（沪市过户费） */
export function isShanghaiSymbol(symbol: string): boolean {
  return /^sh/i.test(symbol);
}

/** 是否港股 symbol */
export function isHKSymbol(symbol: string): boolean {
  return /^hk/i.test(symbol);
}

/** 将内部 code 映射为东方财富 push2 标准 secid */
export function resolveEmSecid(code: string): string {
  const info = parseSymbol(code);
  if (!info) return `1.${code}`; // 兜底
  switch (info.market) {
    case 'SH': return `1.${info.code}`;
    case 'SZ': return `0.${info.code}`;
    case 'BJ': return `0.${info.code}`;
    case 'HK': return `116.${info.code}`;
    case 'US': return `105.${info.code}`;
    default: return `1.${info.code}`;
  }
}

/** 港股一手对应的股数（不同股票不同；这里给一个保守默认 100，前端可让用户自定义） */
export const HK_DEFAULT_LOT = 100;
/** A 股一手 = 100 股 */
export const CN_LOT = 100;

/**
 * 兼容老调用 toSinaSymbol：现在等价于 parseSymbol(code).symbol
 * 但 A 股保留无前缀输入 → 自动加沪深北前缀的能力。
 */
export function toSymbol(code: string): string {
  return parseSymbol(code)?.symbol ?? code;
}
