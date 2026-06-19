import { NextRequest } from 'next/server';
import { fetchGbkText, safeFetch, toUpstreamError } from '@/lib/upstream';
import { parseSymbol, type Market } from '@/lib/markets';

// =============================================================================
// /api/basic — 个股基本面（公司是干什么的）
//
// 多市场兼容：
//   • A 股 (sh/sz/bj)  : 新浪财经 vCI_CorpInfo phtml (HTML, GBK)
//   • 港股 (hk)        : 东方财富 RPT_HKF10_INFO_ORGPROFILE (JSON)
//   • 美股 (us)        : 暂未实现，返回 501
//
// 入参支持：
//   /api/basic?code=600519        旧 A 股调用（4-6 位数字）
//   /api/basic?code=hk09626       港股带前缀
//   /api/basic?code=09626&market=HK  显式指定市场
//   /api/basic?symbol=hk09626     新规范字段
//
// 输出统一为：{ code, market, ...字段, _source }
// 字段名沿用 A 股那一套（companyName / industry / mainBusiness ...），
// 港股映射时尽量对齐，缺失字段不写 key（前端 Row 自动隐藏）。
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type BasicInfo = {
  code: string;
  market: Market;
  _source?: string;
  [k: string]: string | number | undefined;
};

// -----------------------------------------------------------------------------
// A 股：新浪 vCI_CorpInfo
// -----------------------------------------------------------------------------

const A_FIELD_MAP: Record<string, string> = {
  '公司名称': 'companyName',
  '公司英文名称': 'englishName',
  '英文名称': 'englishName',
  '注册地址': 'registerAddress',
  '办公地址': 'officeAddress',
  '所属行业': 'industry',
  '公司网址': 'website',
  '主营业务': 'mainBusiness',
  '经营范围': 'businessScope',
  '公司简介': 'profile',
  '董事会秘书': 'secretary',
  '上市日期': 'ipoDate',
  '上市市场': 'exchange',
  '发行价格': 'ipoPrice',
  '主承销商': 'underwriter',
  '上市推荐人': 'recommender',
  '成立日期': 'foundDate',
  '注册资本': 'registerCapital',
  '机构类型': 'orgType',
  '组织形式': 'orgForm',
  '公司电话': 'phone',
  '公司传真': 'fax',
  '公司电子邮箱': 'email',
  '邮政编码': 'zipCode',
  '信息披露网址': 'discloseUrl',
};

function stripTags(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseSinaCorpInfo(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tdRegex.exec(html)) !== null) {
    cells.push(stripTags(m[1]));
  }
  for (let i = 0; i < cells.length - 1; i++) {
    const label = cells[i].replace(/[：:]\s*$/, '').trim();
    const value = cells[i + 1].trim();
    if (!label || !value) continue;
    if (A_FIELD_MAP[label] && !out[A_FIELD_MAP[label]]) {
      out[A_FIELD_MAP[label]] = value;
    }
  }
  return out;
}

async function fetchABasic(code: string, market: Market): Promise<BasicInfo> {
  // 沪市 sh / 深市 sz / 北交所 bj
  const prefix = market === 'SH' ? 'sh' : market === 'BJ' ? 'bj' : 'sz';
  const stockid = prefix + code;
  const url = `http://vip.stock.finance.sina.com.cn/corp/go.php/vCI_CorpInfo/stockid/${stockid}.phtml`;
  const html = await fetchGbkText(url, undefined, 6000);
  const parsed = parseSinaCorpInfo(html);
  if (Object.keys(parsed).length === 0) {
    throw new Error('解析公司概况页失败：未匹配到任何字段');
  }
  return { code, market, _source: '新浪财经 vCI_CorpInfo', ...parsed };
}

// -----------------------------------------------------------------------------
// 港股：东方财富 F10 公司资料
// -----------------------------------------------------------------------------

type EmHKRow = {
  SECUCODE?: string;
  SECURITY_CODE?: string;
  SECURITY_NAME_ABBR?: string;
  ORG_NAME?: string;
  ORG_EN_ABBR?: string;
  BELONG_INDUSTRY?: string;
  INDUSTRY_TYPE?: string;
  ISIN_CODE?: string;
  LISTING_DATE?: string;
  FOUND_DATE?: string;
  HK_SHARES?: number | string;
  REG_CAPITAL?: string;
  REG_PLACE?: string;
  CHAIRMAN?: string;
  SECRETARY?: string;
  ACCOUNT_FIRM?: string;
  REG_ADDRESS?: string;
  ADDRESS?: string;
  YEAR_SETTLE_DAY?: string;
  EMP_NUM?: number | string;
  BELONG_MARKET?: string;
  ORG_TEL?: string | null;
  ORG_FAX?: string | null;
  ORG_EMAIL?: string | null;
  ORG_WEB?: string;
  LEGAL_ADVISER?: string;
  MAIN_RELATED_BANK?: string;
  SHARES_REG_ADDRESS?: string;
  ORG_PROFILE?: string;
  MAIN_BUSINESS?: string;
  ORG_TYPE?: string;
  CURRENCY?: string;
  TRADE_UNIT?: number | string;
};

type EmHKResp = {
  result?: { data?: EmHKRow[] } | null;
  success?: boolean;
  message?: string;
};

function pickFirstWebsite(s?: string): string | undefined {
  if (!s) return undefined;
  // 东财 ORG_WEB 可能是 "www.bilibili.com,ir.bilibili.com"
  return s.split(/[,，;；\s]+/).map((x) => x.trim()).filter(Boolean)[0];
}

function trimDateOnly(s?: string): string | undefined {
  if (!s) return undefined;
  // "2021-03-29 00:00:00" -> "2021-03-29"
  return s.replace(/\s+\d{2}:\d{2}:\d{2}$/, '').trim() || undefined;
}

async function fetchHKBasic(code5: string): Promise<BasicInfo> {
  const secucode = `${code5}.HK`;
  const url =
    'https://datacenter.eastmoney.com/securities/api/data/v1/get?' +
    new URLSearchParams({
      reportName: 'RPT_HKF10_INFO_ORGPROFILE',
      columns: 'ALL',
      filter: `(SECUCODE="${secucode}")`,
      pageNumber: '1',
      pageSize: '1',
      source: 'F10',
      client: 'PC',
    }).toString();

  const res = await safeFetch(
    url,
    {
      headers: {
        'Referer': 'https://emweb.securities.eastmoney.com/',
        'Accept': 'application/json,text/plain,*/*',
      },
    },
    6000,
  );
  if (!res.ok) throw new Error(`upstream ${res.status} ${res.statusText}`);
  const json = (await res.json()) as EmHKResp;

  const row = json?.result?.data?.[0];
  if (!row) {
    throw new Error('东财港股 F10 未返回数据，可能是代码不对或暂未收录');
  }

  const out: BasicInfo = {
    code: code5,
    market: 'HK',
    _source: '东方财富 港股 F10',
  };

  const set = (k: string, v: string | number | null | undefined) => {
    if (v === null || v === undefined) return;
    const s = typeof v === 'number' ? String(v) : v.trim();
    if (s) out[k] = s;
  };

  set('companyName', row.ORG_NAME);
  set('shortName', row.SECURITY_NAME_ABBR);
  set('englishName', row.ORG_EN_ABBR);
  set('industry', row.BELONG_INDUSTRY || row.INDUSTRY_TYPE);
  set('exchange', row.BELONG_MARKET);
  set('isinCode', row.ISIN_CODE);
  set('ipoDate', trimDateOnly(row.LISTING_DATE));
  set('foundDate', trimDateOnly(row.FOUND_DATE));
  set('hkShares', typeof row.HK_SHARES === 'number' ? row.HK_SHARES.toLocaleString('en-US') : row.HK_SHARES);
  set('registerCapital', row.REG_CAPITAL);
  set('registerPlace', row.REG_PLACE);
  set('chairman', row.CHAIRMAN);
  set('secretary', row.SECRETARY);
  set('accountFirm', row.ACCOUNT_FIRM);
  set('legalAdviser', row.LEGAL_ADVISER);
  set('mainBank', row.MAIN_RELATED_BANK);
  set('sharesRegAddress', row.SHARES_REG_ADDRESS);
  set('registerAddress', row.REG_ADDRESS);
  set('officeAddress', row.ADDRESS);
  set('yearSettleDay', row.YEAR_SETTLE_DAY);
  set('empNum', typeof row.EMP_NUM === 'number' ? row.EMP_NUM.toLocaleString('en-US') : row.EMP_NUM);
  set('phone', row.ORG_TEL ?? undefined);
  set('fax', row.ORG_FAX ?? undefined);
  set('email', row.ORG_EMAIL ?? undefined);
  set('website', pickFirstWebsite(row.ORG_WEB));
  set('profile', row.ORG_PROFILE);
  set('mainBusiness', row.MAIN_BUSINESS);
  set('orgType', row.ORG_TYPE);
  set('currency', row.CURRENCY);
  set(
    'tradeUnit',
    typeof row.TRADE_UNIT === 'number' || typeof row.TRADE_UNIT === 'string' ? String(row.TRADE_UNIT) : undefined,
  );

  return out;
}

// -----------------------------------------------------------------------------
// 入口
// -----------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const raw = (sp.get('symbol') || sp.get('code') || '').trim();
  const explicitMarket = sp.get('market')?.toUpperCase();

  if (!raw) {
    return Response.json({ error: 'code/symbol is required' }, { status: 400 });
  }

  // 优先用 parseSymbol 识别（兼容前缀和纯数字）
  const info = parseSymbol(raw);
  if (!info) {
    return Response.json(
      { error: 'invalid code format, expect e.g. 600519 / hk09626 / 09626 / sh600519' },
      { status: 400 },
    );
  }

  // 显式 market 覆盖（防止 5 位被误判为 HK 等极端情况）
  const market = (explicitMarket as Market) || info.market;

  try {
    let basic: BasicInfo;
    switch (market) {
      case 'SH':
      case 'SZ':
      case 'BJ':
        basic = await fetchABasic(info.code, market);
        break;
      case 'HK':
        basic = await fetchHKBasic(info.code);
        break;
      case 'US':
      default:
        return Response.json(
          { error: '美股基本面尚未实现', code: info.code, market },
          { status: 501 },
        );
    }

    return new Response(JSON.stringify(basic), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    const { error, status } = toUpstreamError(e);
    return Response.json({ error, code: info.code, market }, { status });
  }
}
