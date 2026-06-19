// =============================================================================
// 共享样式工具
// =============================================================================
import { type ClassValue, clsx } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * 涨跌色（A 股惯例：红涨绿跌）
 */
export function pnlColor(diff: number): string {
  if (diff > 0) return 'text-red-600';
  if (diff < 0) return 'text-emerald-600';
  return 'text-slate-500';
}

/**
 * 数字格式化：保留 N 位小数，0 / NaN 显示 —
 */
export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 大数格式化：万亿 / 亿 / 万
 */
export function fmtBig(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' 万亿';
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
  return n.toFixed(0);
}

/**
 * 把 6 位代码（不带前缀）转成新浪带前缀 symbol
 *   600/900 -> sh
 *   0/3     -> sz
 *   8/4     -> bj
 */
export function toSinaSymbol(code: string): string {
  const c = code.replace(/[^0-9]/g, '');
  if (!c) return code;
  if (c.startsWith('6') || c.startsWith('9')) return 'sh' + c;
  if (c.startsWith('8') || c.startsWith('4')) return 'bj' + c;
  return 'sz' + c;
}
