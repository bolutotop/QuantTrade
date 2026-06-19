'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Star, LineChart, Search, Wallet, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWatchlist } from '@/lib/use-watchlist';
import MarketView, { type Quote } from '@/components/market-view';
import WatchlistView from '@/components/watchlist-view';
import BasicInfoModal from '@/components/basic-info-modal';

// =============================================================================
// QuantTrade 主壳
//
// 布局参考 PriceOCR：
//   - PC ≥ lg：左侧 56 宽 sidebar
//   - 移动 < lg：底部 60 高 tabbar
// =============================================================================

type ViewKey = 'watch' | 'market';

const NAV_ITEMS: Array<{ id: ViewKey; label: string; icon: typeof Star }> = [
  { id: 'watch', label: '自选', icon: Star },
  { id: 'market', label: '行情', icon: LineChart },
];

export default function HomePage() {
  const [view, setView] = useState<ViewKey>('watch');
  const [searchTerm, setSearchTerm] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [detail, setDetail] = useState<Quote | null>(null);

  const { list } = useWatchlist();

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50/50 pb-[60px] lg:pb-0">
      {/* PC 侧边栏 */}
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-slate-200/60 h-screen sticky top-0 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.05)] z-10">
        <div className="pt-8 pb-6 px-5 border-b border-slate-100">
          <h1 className="text-xl font-black text-slate-800 tracking-tight">QuantTrade</h1>
          <p className="text-xs text-slate-500 mt-1.5 font-medium">A 股全市场实时行情</p>
        </div>
        <nav className="p-3 space-y-1 flex-1">
          {NAV_ITEMS.map((nav) => {
            const Icon = nav.icon;
            const active = view === nav.id;
            const badge = nav.id === 'watch' && list.length > 0 ? list.length : 0;
            return (
              <button
                key={nav.id}
                onClick={() => setView(nav.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-bold transition-all ease-out duration-200 rounded-md',
                  active
                    ? 'bg-slate-800 text-white translate-x-1 shadow-md'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <Icon className="w-4 h-4 opacity-80" strokeWidth={2.5} />
                <span className="flex-1 text-left">{nav.label}</span>
                {badge > 0 && (
                  <span
                    className={cn(
                      'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] rounded-full font-mono',
                      active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700',
                    )}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
          {/* 持仓走独立路由 */}
          <Link
            href="/portfolio"
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-bold rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <Wallet className="w-4 h-4 opacity-80" strokeWidth={2.5} />
            <span className="flex-1 text-left">持仓</span>
            <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700 font-bold">模拟</span>
          </Link>
          <Link
            href="/issues"
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-bold rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <MessageSquare className="w-4 h-4 opacity-80" strokeWidth={2.5} />
            <span className="flex-1 text-left">问题看板</span>
          </Link>
        </nav>
        <div className="p-3 border-t border-slate-100 text-[10px] text-slate-400 leading-relaxed">
          <p>数据：新浪财经</p>
          <p className="mt-0.5">每 10s 自动刷新</p>
        </div>
      </aside>

      {/* 移动端底部 tabbar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-[99] flex justify-around items-center h-[60px] pb-safe shadow-[0_-4px_24px_-12px_rgba(0,0,0,0.1)]">
        {NAV_ITEMS.map((nav) => {
          const Icon = nav.icon;
          const active = view === nav.id;
          const badge = nav.id === 'watch' && list.length > 0 ? list.length : 0;
          return (
            <button
              key={nav.id}
              onClick={() => setView(nav.id)}
              className="flex flex-col items-center justify-center flex-1 h-full pt-1 relative"
            >
              <div className={cn('p-1 rounded-full transition-colors relative', active ? 'text-blue-600' : 'text-slate-400')}>
                <Icon className="w-[22px] h-[22px]" strokeWidth={active ? 2.5 : 2} />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] rounded-full bg-red-500 text-white font-mono leading-none">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'text-[10px] sm:text-xs mt-0.5',
                  active ? 'font-black text-blue-600' : 'font-medium text-slate-500',
                )}
              >
                {nav.label}
              </span>
            </button>
          );
        })}
        <Link
          href="/portfolio"
          className="flex flex-col items-center justify-center flex-1 h-full pt-1"
        >
          <div className="p-1 rounded-full text-slate-400">
            <Wallet className="w-[22px] h-[22px]" strokeWidth={2} />
          </div>
          <span className="text-[10px] sm:text-xs mt-0.5 font-medium text-slate-500">持仓</span>
        </Link>
      </nav>

      {/* 主区 */}
      <main className="flex-1 flex flex-col min-h-[100dvh]">
        <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40">
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <h1 className="lg:hidden font-black text-slate-800 tracking-tight text-lg whitespace-nowrap">
              {view === 'watch' ? '自选' : '行情'}
            </h1>

            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={view === 'watch' ? '搜索自选...' : '搜索代码/名称...'}
                  className="w-full pl-9 pr-3 h-9 text-sm bg-slate-100/60 rounded-md border border-transparent focus:border-slate-300 focus:bg-white focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500 whitespace-nowrap">
              {updatedAt && (
                <span className="font-mono">更新 {updatedAt}</span>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 p-3 sm:p-4 lg:p-6">
          {view === 'watch' ? (
            <WatchlistView
              searchTerm={searchTerm}
              onOpenDetail={setDetail}
              onJumpMarket={() => setView('market')}
            />
          ) : (
            <MarketView
              searchTerm={searchTerm}
              onOpenDetail={setDetail}
              onUpdatedAtChange={setUpdatedAt}
            />
          )}
        </div>

        <footer className="px-4 sm:px-6 py-4 text-[11px] text-slate-400 leading-relaxed">
          <p>⚠ 数据来源：新浪财经 vip.stock.finance.sina.com.cn · 涨跌按 A 股习惯：红涨绿跌；非交易时段为最新一笔。</p>
        </footer>
      </main>

      <BasicInfoModal detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
