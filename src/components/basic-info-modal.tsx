'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, ExternalLink, Building2, Newspaper, Wallet, ChartCandlestick, Zap } from 'lucide-react';
import { cn, fmt, pnlColor, toSinaSymbol } from '@/lib/utils';
import type { Quote } from './market-view';
import SentimentPanel from './sentiment-panel';
import PortfolioTabPanel from './portfolio-tab-panel';
import KLineChartView from './kline-chart-view';
import AnalysisPanel from './analysis-panel';

// =============================================================================
// BasicInfoModal —— 个股公司基本面弹窗
// =============================================================================

type BasicInfo = {
  code: string;
  market?: 'SH' | 'SZ' | 'BJ' | 'HK' | 'US';
  _source?: string;
  // 通用字段
  companyName?: string;
  shortName?: string;
  englishName?: string;
  industry?: string;
  mainBusiness?: string;
  businessScope?: string;
  profile?: string;
  ipoDate?: string;
  ipoPrice?: string;
  exchange?: string;
  foundDate?: string;
  registerCapital?: string;
  orgType?: string;
  orgForm?: string;
  secretary?: string;
  registerAddress?: string;
  officeAddress?: string;
  website?: string;
  phone?: string;
  fax?: string;
  email?: string;
  zipCode?: string;
  discloseUrl?: string;
  underwriter?: string;
  recommender?: string;
  // 港股专属
  isinCode?: string;
  hkShares?: string;
  registerPlace?: string;
  chairman?: string;
  accountFirm?: string;
  legalAdviser?: string;
  mainBank?: string;
  sharesRegAddress?: string;
  yearSettleDay?: string;
  empNum?: string;
  currency?: string;
  tradeUnit?: string;
  error?: string;
};

export type BasicInfoModalProps = {
  detail: Quote | null;
  onClose: () => void;
};

type ModalTab = 'kline' | 'analysis' | 'basic' | 'sentiment' | 'trade';

export default function BasicInfoModal({ detail, onClose }: BasicInfoModalProps) {
  const [basic, setBasic] = useState<BasicInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ModalTab>('sentiment'); // 默认进入舆情

  // ESC 关闭
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, onClose]);

  // 切换股票时重置 tab 到 sentiment（用户主诉是看资讯）
  useEffect(() => {
    if (detail) setTab('sentiment');
  }, [detail?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  // 拉取基本面：用 symbol（带 sh/sz/bj/hk 前缀），让后端识别市场
  const fetchBasic = useCallback(async (sym: string) => {
    setLoading(true);
    setBasic(null);
    setError(null);
    try {
      const res = await fetch(`/api/basic?symbol=${encodeURIComponent(sym)}`, { cache: 'no-store' });
      const json: BasicInfo = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || `HTTP ${res.status}`);
      } else {
        setBasic(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!detail) return;
    fetchBasic(detail.symbol || detail.code);
  }, [detail, fetchBasic]);

  if (!detail) return null;

  // 底部"查看原页"链接：A 股 -> 新浪 vCI_CorpInfo；港股 -> 东财 F10；其它 -> 不展示
  const isHK = /^hk/i.test(detail.symbol || '');
  const sourcePage = isHK
    ? `https://emweb.securities.eastmoney.com/PC_HKF10/CompanyProfile/Index?type=web&code=${detail.code}`
    : `http://vip.stock.finance.sina.com.cn/corp/go.php/vCI_CorpInfo/stockid/${toSinaSymbol(detail.code)}.phtml`;
  const sourceLabel = basic?._source || (isHK ? '东方财富 港股 F10' : '新浪财经 公司概况');
  const colorClass = pnlColor(detail.change);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-3xl max-h-[90vh] sm:max-h-[85vh] overflow-hidden flex flex-col qt-modal-anim"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-slate-200/70 flex items-start justify-between gap-4 flex-wrap bg-gradient-to-b from-slate-50 to-white">
          <div className="min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="text-xl font-black tracking-tight text-slate-800">{detail.name}</h2>
              <span className="font-mono text-sm text-slate-400">{detail.code}</span>
              {detail.price > 0 && (
                <span className={cn('font-mono font-bold', colorClass)}>
                  {fmt(detail.price)} {detail.changePct > 0 ? '+' : ''}{fmt(detail.changePct)}%
                </span>
              )}
            </div>
            {(basic?.industry || basic?.ipoDate) && (
              <p className="text-xs text-slate-500 mt-1">
                {basic?.industry && (
                  <>所属行业：<span className="text-slate-700 font-bold">{basic.industry}</span></>
                )}
                {basic?.ipoDate && (
                  <span className="ml-3">上市于 <span className="font-mono">{basic.ipoDate}</span></span>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors rounded-md p-1 -mr-1 -mt-1"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 主 Tab：资讯 / 交易 / 基本面 */}
        <div className="px-5 pt-2 border-b border-slate-200/70 flex items-center gap-1 bg-white">
          {[
            { key: 'analysis' as ModalTab, label: '涨跌分析', icon: Zap },
            { key: 'sentiment' as ModalTab, label: '资讯·舆情', icon: Newspaper },
            { key: 'kline' as ModalTab, label: 'K 线图', icon: ChartCandlestick },
            { key: 'trade' as ModalTab, label: '交易·持仓', icon: Wallet },
            { key: 'basic' as ModalTab, label: '公司基本面', icon: Building2 },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 -mb-px transition-colors',
                  active
                    ? 'text-blue-600 border-blue-600'
                    : 'text-slate-500 border-transparent hover:text-slate-800',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* 内容 */}
        <div className={cn(
          'text-sm text-slate-700 leading-relaxed flex-1',
          // K 线 tab 不要 overflow-y-auto！否则滚动条出现/消失会动态改变容器宽度，
          // 引起 KLineChart 的 visibleBarCount 在 init 瞬间被算成 0。
          tab === 'kline' ? 'px-3 py-2 overflow-hidden' : 'px-5 py-4 overflow-y-auto',
        )}>
          {tab === 'sentiment' && (
            <SentimentPanel code={detail.code} name={detail.name} />
          )}
          {tab === 'analysis' && (
            <AnalysisPanel symbol={detail.symbol} code={detail.code} name={detail.name} />
          )}
          {tab === 'kline' && (
            <KLineChartView symbol={detail.symbol} height={460} />
          )}
          {tab === 'trade' && (
            <PortfolioTabPanel
              symbol={detail.symbol}
              code={detail.code}
              name={detail.name}
              livePrice={detail.price > 0 ? detail.price : undefined}
            />
          )}
          {tab === 'basic' && loading && (
            <div className="py-8 text-center text-slate-400">正在加载公司基本面…</div>
          )}
          {tab === 'basic' && error && (
            <div className="py-3 px-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs">
              ❌ {error}
            </div>
          )}
          {tab === 'basic' && !loading && !error && basic && (
            <div className="space-y-5">
              {basic.mainBusiness && (
                <Section title="主营业务">
                  <p className="whitespace-pre-wrap">{basic.mainBusiness}</p>
                </Section>
              )}
              {basic.profile && (
                <Section title="公司简介">
                  <p className="whitespace-pre-wrap">{basic.profile}</p>
                </Section>
              )}
              {basic.businessScope && (
                <Section title="经营范围">
                  <p className="whitespace-pre-wrap text-[13px] text-slate-600">{basic.businessScope}</p>
                </Section>
              )}

              <Section title="公司信息">
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
                  <Row label="公司全称" value={basic.companyName} />
                  <Row label="英文名称" value={basic.englishName} />
                  <Row label="股票简称" value={basic.shortName} />
                  <Row label="所属行业" value={basic.industry} />
                  <Row label="上市市场" value={basic.exchange} />
                  <Row label="上市日期" value={basic.ipoDate} />
                  <Row label="发行价格" value={basic.ipoPrice} />
                  <Row label="主承销商" value={basic.underwriter} />
                  <Row label="成立日期" value={basic.foundDate} />
                  <Row label="注册资本" value={basic.registerCapital} />
                  <Row label="注册地" value={basic.registerPlace} />
                  <Row label="机构类型" value={basic.orgType} />
                  <Row label="组织形式" value={basic.orgForm} />
                  <Row label="董事长" value={basic.chairman} />
                  <Row label="董事会秘书" value={basic.secretary} />
                  <Row label="会计师事务所" value={basic.accountFirm} />
                  <Row label="法律顾问" value={basic.legalAdviser} />
                  <Row label="主要往来银行" value={basic.mainBank} />
                  <Row label="股份过户处" value={basic.sharesRegAddress} />
                  <Row label="员工人数" value={basic.empNum} />
                  <Row label="发行总股数" value={basic.hkShares} />
                  <Row label="ISIN 代码" value={basic.isinCode} />
                  <Row label="计价货币" value={basic.currency} />
                  <Row label="每手股数" value={basic.tradeUnit} />
                  <Row label="财年截止日" value={basic.yearSettleDay} />
                  <Row label="公司电话" value={basic.phone} />
                  <Row label="公司传真" value={basic.fax} />
                  <Row label="电子邮箱" value={basic.email} />
                  <Row label="邮政编码" value={basic.zipCode} />
                  <Row label="注册地址" value={basic.registerAddress} />
                  <Row label="办公地址" value={basic.officeAddress} />
                  <Row
                    label="公司网址"
                    value={
                      basic.website ? (
                        <a
                          href={basic.website.startsWith('http') ? basic.website : `http://${basic.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline break-all"
                        >
                          {basic.website}
                        </a>
                      ) : undefined
                    }
                  />
                  <Row
                    label="信披网址"
                    value={
                      basic.discloseUrl ? (
                        <a
                          href={basic.discloseUrl.startsWith('http') ? basic.discloseUrl : `http://${basic.discloseUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline break-all"
                        >
                          {basic.discloseUrl}
                        </a>
                      ) : undefined
                    }
                  />
                </dl>
              </Section>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 bg-slate-50/40">
          <span>数据：{sourceLabel}</span>
          <a
            href={sourcePage}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-500 hover:underline font-bold"
          >
            查看原页 <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-black tracking-widest text-slate-400 uppercase mb-2">{title}</h3>
      <div className="text-slate-700">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <dt className="text-slate-400 shrink-0 w-[5.5rem]">{label}</dt>
      <dd className="text-slate-700 font-medium truncate" title={typeof value === 'string' ? value : undefined}>{value}</dd>
    </div>
  );
}
