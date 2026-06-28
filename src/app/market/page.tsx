'use client';

import MarketDashboard from '@/components/market-dashboard';

export default function MarketPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-xl font-black tracking-tight text-slate-800 flex items-center gap-2 mb-4">
          📊 大盘资金流
        </h1>
        <MarketDashboard />
      </div>
    </main>
  );
}
