import { NextRequest } from 'next/server';
import { safeFetch, fetchGbkText, toUpstreamError } from '@/lib/upstream';

// =============================================================================
// /api/market/overview — 大盘资金流概览
//
// 三块数据：
//   1) 核心指数（上证/深证/创业板/科创50/恒生）
//   2) 板块热度（通过代表板块 ETF 的涨跌幅+成交额近似资金流向）
//   3) 资金流风向（涨幅最大 / 跌幅最大板块排行）
//
// 数据源：
//   新浪 hq.sinajs.cn — 批量拉指数 + 板块 ETF（已有 stmt 可用）
//   东方财富 push2his — 备选 K 线取最近一根
//
// 板块 ETF 选用市面上最大的 30+ 只主流 ETF，涵盖各行业和概念，
// 按当日涨跌幅排序、成交额排序，就是市场资金的"热力图"。
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// -------- 指数列表 --------
const INDICES: Array<{ code: string; label: string; market: string }> = [
  { code: 'sh000001', label: '上证指数', market: 'SH' },
  { code: 'sz399001', label: '深证成指', market: 'SZ' },
  { code: 'sz399006', label: '创业板指', market: 'SZ' },
  { code: 'sh000688', label: '科创50', market: 'SH' },
  { code: 'sh000300', label: '沪深300', market: 'SH' },
  { code: 'sh000016', label: '上证50', market: 'SH' },
];

// -------- 板块代表 ETF（30 只，覆盖主流行业 + 热门概念）--------
// 每只代表1个板块，涨跌幅 = 资金态度，成交额 = 资金强度
const SECTOR_ETFS: Array<{ sym: string; label: string; bucket: string }> = [
  // 大金融
  { sym: 'sh512880', label: '券商', bucket: '金融' },
  { sym: 'sh512800', label: '银行', bucket: '金融' },
  { sym: 'sh512070', label: '非银金融', bucket: '金融' },
  { sym: 'sz159940', label: '金融', bucket: '金融' },
  // 科技
  { sym: 'sh512480', label: '半导体', bucket: '科技' },
  { sym: 'sz159869', label: '游戏传媒', bucket: '科技' },
  { sym: 'sh515050', label: '5G通信', bucket: '科技' },
  { sym: 'sh588050', label: '科创芯片', bucket: '科技' },
  { sym: 'sh588200', label: '科创AI', bucket: '科技' },
  { sym: 'sh516510', label: '云计算', bucket: '科技' },
  { sym: 'sh159732', label: '消费电子', bucket: '科技' },
  // 消费
  { sym: 'sh512690', label: '白酒', bucket: '消费' },
  { sym: 'sz159825', label: '食品饮料', bucket: '消费' },
  { sym: 'sh159766', label: '旅游', bucket: '消费' },
  { sym: 'sh159708', label: '家电', bucket: '消费' },
  // 新能源+车
  { sym: 'sh516160', label: '光伏', bucket: '新能源' },
  { sym: 'sh159859', label: '新能源车', bucket: '新能源' },
  { sym: 'sh560080', label: '电池', bucket: '新能源' },
  { sym: 'sh516390', label: '智能汽车', bucket: '新能源' },
  // 医药
  { sym: 'sh512170', label: '医疗', bucket: '医药' },
  { sym: 'sh512010', label: '医药', bucket: '医药' },
  { sym: 'sz159883', label: '创新药', bucket: '医药' },
  // 周期+基建
  { sym: 'sh510880', label: '红利', bucket: '周期' },
  { sym: 'sh510410', label: '资源', bucket: '周期' },
  { sym: 'sh159745', label: '建材', bucket: '周期' },
  { sym: 'sh516970', label: '电力', bucket: '周期' },
  // 军工+国防
  { sym: 'sh512660', label: '军工', bucket: '军工' },
  // 地产
  { sym: 'sh512200', label: '地产', bucket: '地产' },
  // 信创
  { sym: 'sh562030', label: '信创', bucket: '科技' },
  // 机器人
  { sym: 'sh562500', label: '机器人', bucket: '科技' },
];

// -------- 新浪行情格式解析 --------
// A 股/ETF: 名称,今开,昨收,现价,最高,最低,成交量,成交额,......
//   现价 = parts[3]
// 港股指数 (rt_ 前缀): 名称,今开,昨收,买价,卖价,最高,现价,最低,涨跌幅%,涨跌额,......
//   现价 = parts[6], 涨跌幅 = parts[8]（已含 %）
function parseSinaQuote(line: string): { name: string; price: number; change: number; changePct: number; open: number; prevClose: number; volume: number; turnover: number } | null {
  const m = line.match(/"([^"]+)"/);
  if (!m) return null;
  const parts = m[1].split(',');
  if (parts.length < 7) return null;
  const name = parts[0];
  const isHK = line.startsWith('var hq_str_rt_');

  let price: number, prevClose: number, changePct: number;
  if (isHK) {
    // rt_ 格式: index 6=现价, index 2=昨收, index 8=涨跌幅(已含%)
    price = parseFloat(parts[6]) || 0;
    prevClose = parseFloat(parts[2]) || 0;
    changePct = parseFloat(parts[8]) || 0;
  } else {
    price = parseFloat(parts[3]) || 0;
    prevClose = parseFloat(parts[2]) || 0;
    changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
  }
  const change = price - prevClose;
  // A 股/ETF: volume=parts[7], turnover=parts[8]
  // HK rt_: volume 取 amount(parts[12]) 或为 0
  const volume = isHK ? 0 : (parseFloat(parts[7]) || 0);
  const turnover = isHK ? 0 : (parseFloat(parts[8]) || 0);

  return { name, price, change, changePct, open: parseFloat(parts[1]) || 0, prevClose, volume, turnover };
}

async function fetchSinaQuotes(symbols: string[]): Promise<Map<string, ReturnType<typeof parseSinaQuote>>> {
  const map = new Map<string, ReturnType<typeof parseSinaQuote>>();

  // 新浪单次最多 ~15 只，拆成每批 10 只
  const BATCH = 10;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const list = batch.join(',');
    // 注意：新浪 API 不能 encode 逗号，必须用原始逗号
    const url = `https://hq.sinajs.cn/list=${list}`;
    try {
      const text = await fetchGbkText(url, {
        headers: { Referer: 'https://finance.sina.com.cn/' },
      }, 8000);
      const lines = text.split('\n');
      for (let j = 0; j < batch.length; j++) {
        if (j < lines.length) {
          const parsed = parseSinaQuote(lines[j]);
          if (parsed && parsed.price > 0) map.set(batch[j], parsed);
        }
      }
    } catch {
      // 单批失败不影响其他批次
    }
  }
  return map;
}

// -------- 东财 K 线取最近一根（用于没有新浪行情的 symbol）--------
async function fetchEmLatest(symbol: string): Promise<{ name: string; price: number; changePct: number; volume: number; turnover: number } | null> {
  try {
    const url = `https://push2his.eastmoney.com/api/qt/kline/get?secid=${symbol}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f59&klt=101&fqt=1&end=20500101&lmt=2`;
    const res = await safeFetch(
      url,
      {
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          Accept: 'application/json,text/plain,*/*',
        },
      },
      6000,
    );
    if (!res.ok) return null;
    const json = await res.json() as { data?: { name?: string; klines?: string[] } };
    const klines = json?.data?.klines;
    if (!Array.isArray(klines) || klines.length === 0) return null;
    const last = klines[klines.length - 1].split(',');
    if (last.length < 7) return null;
    return {
      name: json.data?.name ?? '',
      price: parseFloat(last[2]) || 0,
      changePct: parseFloat(last[8] ?? '0') || 0,
      volume: parseFloat(last[5]) || 0,
      turnover: parseFloat(last[6]) || 0,
    };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// 入口
// -----------------------------------------------------------------------------

export async function GET(_req: NextRequest) {
  try {
    // 1) 拉指数
    const indexSymbols = INDICES.map((i) => i.code);
    const indexMap = await fetchSinaQuotes(indexSymbols);

    const indices = INDICES.map((i) => {
      const q = indexMap.get(i.code);
      return {
        code: i.code,
        label: i.label,
        market: i.market,
        price: q?.price ?? 0,
        change: q?.change ?? 0,
        changePct: q?.changePct ?? 0,
        volume: q?.volume ?? 0,
        turnover: q?.turnover ?? 0,
      };
    });

    // 2) 拉板块 ETF（把所有 sym 拼到一起一次批量拉）
    const etfSymbols = SECTOR_ETFS.map((e) => e.sym);
    const etfMap = await fetchSinaQuotes(etfSymbols);

    const sectors = SECTOR_ETFS.map((e) => {
      const q = etfMap.get(e.sym);
      return {
        sym: e.sym,
        label: e.label,
        bucket: e.bucket,
        price: q?.price ?? 0,
        changePct: q?.changePct ?? 0,
        volume: q?.volume ?? 0,
        turnover: q?.turnover ?? 0,
      };
    });

    // 3) 排行：资金流入 Top（涨跌幅最大）、资金流出 Top（跌幅最大）、成交最活跃
    const byUp = [...sectors].filter((s) => s.price > 0).sort((a, b) => b.changePct - a.changePct);
    const byDown = [...sectors].filter((s) => s.price > 0).sort((a, b) => a.changePct - b.changePct);
    const byVolume = [...sectors].filter((s) => s.price > 0).sort((a, b) => b.turnover - a.turnover);

    // 4) 港股指数走新浪 rt_ 前缀
    const hkIndexMap = await fetchSinaQuotes(['rt_hkHSI', 'rt_hkHSCEI', 'rt_hkHSTECH']);

    return Response.json({
      updatedAt: Date.now(),
      indices,
      hkIndices: {
        hsi: hkIndexMap.get('rt_hkHSI') ? { name: '恒生指数', price: hkIndexMap.get('rt_hkHSI')!.price, changePct: hkIndexMap.get('rt_hkHSI')!.changePct, volume: 0, turnover: 0 } : null,
        hscei: hkIndexMap.get('rt_hkHSCEI') ? { name: '国企指数', price: hkIndexMap.get('rt_hkHSCEI')!.price, changePct: hkIndexMap.get('rt_hkHSCEI')!.changePct, volume: 0, turnover: 0 } : null,
        hstech: hkIndexMap.get('rt_hkHSTECH') ? { name: '恒生科技', price: hkIndexMap.get('rt_hkHSTECH')!.price, changePct: hkIndexMap.get('rt_hkHSTECH')!.changePct, volume: 0, turnover: 0 } : null,
      },
      moneyIn: byUp.slice(0, 10),
      moneyOut: byDown.slice(0, 10),
      mostActive: byVolume.filter((s) => s.turnover > 0).slice(0, 10),
    });
  } catch (e) {
    const { error, status } = toUpstreamError(e);
    return Response.json({ error }, { status });
  }
}
