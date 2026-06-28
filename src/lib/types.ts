// =============================================================================
// 共享类型定义 —— 全项目唯一来源
//
// 参考: daily_stock_analysis (38K★) 的类型集中管理模式
// 原则: 每个领域类型只定义一次，其他文件 re-export
// =============================================================================

import type { Market } from './markets';

// ---------------------------------------------------------------------------
// 行情快照（列表 / 详情通用）
// ---------------------------------------------------------------------------

export type Quote = {
  symbol: string;      // sh600519 / hk00700 / ...
  code: string;        // 600519 / 00700
  name: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  prevClose: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  marketCap: number;   // 总市值（元）
  turnover: number;    // 换手率 %
  time: string;        // HH:mm:ss
  market?: Market;     // SH / SZ / BJ / HK / US
};

// ---------------------------------------------------------------------------
// K 线数据
// ---------------------------------------------------------------------------

export type KLineItem = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  changePct?: number;
  change?: number;
  turnoverRate?: number;
};

// ---------------------------------------------------------------------------
// 新闻 / 资讯
// ---------------------------------------------------------------------------

export type NewsItem = {
  id: string;
  source: string;
  type: 'news' | 'announce' | 'discuss';
  title: string;
  summary?: string;
  url: string;
  time: string;
  ts: number;
  author?: string;
};

// ---------------------------------------------------------------------------
// 上游 API 基地址（统一管理，方便切换）
// ---------------------------------------------------------------------------

export const UPSTREAM = {
  /** 新浪财经行情 */
  SINA_QUOTE: 'https://hq.sinajs.cn/list=',
  /** 新浪财经公司基本面 */
  SINA_BASIC: 'https://vip.stock.finance.sina.com.cn/corp/go.php/vCI_CorpInfo/stockid/',
  /** 新浪财经排行榜 */
  SINA_RANK: 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/',
  /** 东方财富 push2 K线 / 行情 */
  EASTMONEY_PUSH2: 'https://push2his.eastmoney.com/api/qt/stock/kline/get',
  /** 东方财富搜索 */
  EASTMONEY_SEARCH: 'https://search-api-web.eastmoney.com/search/jsonp',
  /** 东方财富 F10 港股 */
  EASTMONEY_HKF10: 'https://datacenter.eastmoney.com/securities/api/data/v1/get',
  /** 腾讯财经港股 K 线 */
  TENCENT_HK_KLINE: 'https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get',
  /** 东方财富公告列表 */
  EASTMONEY_ANNOUNCE: 'https://np-anotice-stock.eastmoney.com/api/v1/getAnnouncementList',
  /** 新浪个股新闻 */
  SINA_NEWS: 'https://vip.stock.finance.sina.com.cn/corp/view/vCB_AllNewsStock.php',
  /** 巨潮资讯公告 */
  CNINFO: 'https://www.cninfo.com.cn/new/hisAnnouncement/query',
} as const;

/** 东财 push2 默认超时 (ms) */
export const EASTMONEY_TIMEOUT = 8000;
/** 新浪行情默认超时 (ms) */
export const SINA_TIMEOUT = 6000;

// ---------------------------------------------------------------------------
// 板块节点常量（全市场统一）
// ---------------------------------------------------------------------------

export const VALID_NODES = [
  'hs_a', 'hs_kcb', 'hs_cyb', 'sh_a', 'sz_a', 'bj_a', 'new_cb',
  'hk_all', 'hk_main', 'hk_gem', 'hk_blue', 'hk_red', 'hk_h',
] as const;

export type NodeKey = (typeof VALID_NODES)[number];

export const VALID_NODE_SET: ReadonlySet<string> = new Set(VALID_NODES);

export const HK_NODES = ['hk_all', 'hk_main', 'hk_gem', 'hk_blue', 'hk_red', 'hk_h'] as const;
export const HK_NODE_SET: ReadonlySet<string> = new Set(HK_NODES);
