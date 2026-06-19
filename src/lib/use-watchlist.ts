'use client';

import { useEffect, useState, useCallback } from 'react';

// =============================================================================
// useWatchlist —— 自选股 hook
//
// 持久化在 localStorage，跨标签页同步（storage 事件），
// 所有 set 操作都不可变（保证 React 重渲染）。
//
// 数据结构：
//   { symbol: 'sh600519', code: '600519', name: '贵州茅台', addedAt: 1718...}
//
// symbol = 带前缀的新浪标识符（sh600519 / sz000001 / bj920000），
// 便于 /api/quote 直接批量拉报价。
// =============================================================================

export type WatchlistItem = {
  symbol: string;   // sh600519
  code: string;     // 600519
  name: string;     // 贵州茅台
  addedAt: number;  // ts
};

const STORAGE_KEY = 'quanttrade.watchlist.v1';
const MAX_ITEMS = 200;

function readStorage(): WatchlistItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (it: unknown): it is WatchlistItem =>
        !!it &&
        typeof it === 'object' &&
        typeof (it as WatchlistItem).symbol === 'string' &&
        typeof (it as WatchlistItem).code === 'string' &&
        typeof (it as WatchlistItem).name === 'string',
    );
  } catch {
    return [];
  }
}

function writeStorage(list: WatchlistItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota / safari private mode 等失败静默忽略 */
  }
}

export function useWatchlist() {
  // 注意：SSR 一致性 —— 第一次渲染必须返回空列表，挂载后再加载，避免 hydration mismatch
  const [list, setList] = useState<WatchlistItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setList(readStorage());
    setHydrated(true);
  }, []);

  // 跨标签页同步
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setList(readStorage());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const has = useCallback(
    (symbol: string) => list.some((i) => i.symbol === symbol),
    [list],
  );

  const add = useCallback((item: Omit<WatchlistItem, 'addedAt'>) => {
    setList((prev) => {
      if (prev.some((i) => i.symbol === item.symbol)) return prev;
      const next = [{ ...item, addedAt: Date.now() }, ...prev].slice(0, MAX_ITEMS);
      writeStorage(next);
      return next;
    });
  }, []);

  const remove = useCallback((symbol: string) => {
    setList((prev) => {
      const next = prev.filter((i) => i.symbol !== symbol);
      writeStorage(next);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (item: Omit<WatchlistItem, 'addedAt'>) => {
      setList((prev) => {
        const exists = prev.some((i) => i.symbol === item.symbol);
        const next = exists
          ? prev.filter((i) => i.symbol !== item.symbol)
          : [{ ...item, addedAt: Date.now() }, ...prev].slice(0, MAX_ITEMS);
        writeStorage(next);
        return next;
      });
    },
    [],
  );

  const clear = useCallback(() => {
    setList([]);
    writeStorage([]);
  }, []);

  return { list, hydrated, has, add, remove, toggle, clear };
}
