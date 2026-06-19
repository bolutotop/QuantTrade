import { NextRequest } from 'next/server';
import { fetchGbkText, toUpstreamError } from '@/lib/upstream';

// =============================================================================
// /api/basic — 个股基本面（公司是干什么的）
//
// 数据源：新浪财经 公司概况页（HTML, GBK）
//   http://vip.stock.finance.sina.com.cn/corp/go.php/vCI_CorpInfo/stockid/{code}.phtml
//
// 这个页面是 <table> 一对一的"标签：值"结构，相对稳定，
// 我们解析出常见字段：
//   公司名称 / 英文名称 / 所属行业 / 主营业务 / 经营范围 /
//   公司简介 / 上市日期 / 发行价 / 主承销商 / 注册地址 / 办公地址 / 公司网址 / 董事长 / 总经理 ……
//
// 用法：GET /api/basic?code=600519
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 想抓的字段 -> 输出 key
// 注：label 来自 vCI_CorpInfo 页面真实标签（去掉尾部冒号）
const FIELD_MAP: Record<string, string> = {
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


interface BasicInfo {
  code: string;
  [k: string]: string;
}

// 把 HTML 转成纯文本（去标签、解 &nbsp; / &amp; 等）
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

function parseCorpInfo(html: string): Record<string, string> {
  const out: Record<string, string> = {};

  // 公司概况页结构：
  //   <td class="ccd">标签：</td>  <td class="cc">值</td>
  // 但 .phtml 模板有时是 <strong>标签:</strong> + <td>值
  // 我们用通用方式：把所有 <td>...</td> 抓出来，看是不是带"："收尾的标签格式
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tdRegex.exec(html)) !== null) {
    cells.push(stripTags(m[1]));
  }

  // 相邻两格 [label:, value]
  for (let i = 0; i < cells.length - 1; i++) {
    const label = cells[i].replace(/[：:]\s*$/, '').trim();
    const value = cells[i + 1].trim();
    if (!label || !value) continue;
    if (FIELD_MAP[label] && !out[FIELD_MAP[label]]) {
      out[FIELD_MAP[label]] = value;
    }
  }

  return out;
}

// 决定 stockid 前缀（sh / sz / bj）
function resolveSinaStockId(code: string): string {
  const c = code.replace(/[^0-9]/g, '');
  if (!c) return code;
  // 6 开头 = 沪市；8 / 4 开头 = 北交所；其它（0/3）= 深市
  if (c.startsWith('6') || c.startsWith('9')) return 'sh' + c;
  if (c.startsWith('8') || c.startsWith('4')) return 'bj' + c;
  return 'sz' + c;
}

// A 股 6 位、北交所 6 位、港股 5 位、美股字母+数字（保守起见暂只放数字）
// 现阶段只支持 A 股，4-6 位纯数字
const CODE_RE = /^[0-9]{4,6}$/;

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get('code') ?? '').trim();
  if (!code) {
    return Response.json({ error: 'code is required' }, { status: 400 });
  }
  if (!CODE_RE.test(code)) {
    return Response.json({ error: 'invalid code format, expect 4-6 digits' }, { status: 400 });
  }

  const stockid = resolveSinaStockId(code);
  const url = `http://vip.stock.finance.sina.com.cn/corp/go.php/vCI_CorpInfo/stockid/${stockid}.phtml`;

  try {
    const html = await fetchGbkText(url, undefined, 6000);

    const info: BasicInfo = { code, ...parseCorpInfo(html) };

    // 没解析到任何字段 = 大概率 code 不对或页面变了
    if (Object.keys(info).length <= 1) {
      return Response.json({
        error: '解析公司概况页失败：未匹配到任何字段',
        code,
        stockid,
      }, { status: 502 });
    }

    return new Response(JSON.stringify(info), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // 公司基本面变化慢，缓存 1 小时（CDN 友好），但保证开发期一直新鲜
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    const { error, status } = toUpstreamError(e);
    return Response.json({ error, code }, { status });
  }
}
